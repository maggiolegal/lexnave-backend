import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { pipeline } from '@xenova/transformers';

const app = express();
app.use(cors());
app.use(express.json());

// ========== INICIALIZACIÓN DE SERVICIOS ==========
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { realtime: { transport: WebSocket } }
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ========== MAPEO DE LEYES ==========
const LEY_MAP = {
    1: "Constitución de la República Bolivariana de Venezuela",
    2: "Ley de Propiedad Horizontal",
    3: "Código Civil",
    4: "Código de Comercio",
    5: "Código Orgánico Procesal Penal",
    6: "Código Penal",
    7: "Código de Procedimiento Civil",
    8: "Ley de Arrendamientos Inmobiliarios",
    9: "Ley Orgánica sobre el Derecho de las Mujeres a una Vida Libre de Violencia",
    10: "Ley de regulación del arrendamiento inmobiliario para el uso comercial",
    11: "Ley de Registros y Notarías"
};

// ========== MODELO DE EMBEDDING LOCAL ==========
let embedder = null;

async function initEmbedder() {
    if (!embedder) {
        console.log('🔄 Cargando modelo de embeddings...');
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ Modelo de embeddings cargado');
    }
    return embedder;
}

// ========== UTILIDADES ==========
function safeJsonParse(rawText) {
    try {
        return JSON.parse(rawText.trim());
    } catch (e) {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0].trim());
            } catch (innerError) {
                throw new Error(`Imposible parsear JSON: ${innerError.message}`);
            }
        }
        throw e;
    }
}

// ========== GENERAR EMBEDDING DE LA PREGUNTA ==========
async function generarEmbedding(texto) {
    try {
        const model = await initEmbedder();
        const textoTruncado = texto.length > 500 ? texto.substring(0, 500) : texto;
        const result = await model(textoTruncado, { pooling: 'mean', normalize: true });
        const embedding = Array.from(result.data);
        console.log(`✅ Embedding generado: ${embedding.length} dimensiones`);
        return embedding;
    } catch (error) {
        console.error('❌ Error generando embedding:', error.message);
        return null;
    }
}

// ========== ETAPA 1: BÚSQUEDA SEMÁNTICA (REDUCCIÓN) ==========
async function buscarCandidatos(pregunta, leyId = null, limite = 20) {
    try {
        const embedding = await generarEmbedding(pregunta);
        
        if (!embedding) {
            console.log('📝 Embedding no disponible, usando búsqueda por texto');
            return buscarPorTexto(pregunta, leyId, limite);
        }
        
        const { data, error } = await supabase.rpc('match_articles', {
            query_embedding: embedding,
            match_ley_id: leyId || 0,
            match_threshold: 0.25,
            match_count: limite
        });
        
        if (error) {
            console.error('❌ Error en búsqueda semántica:', error);
            return buscarPorTexto(pregunta, leyId, limite);
        }
        
        console.log(`🔍 ETAPA 1 - Candidatos encontrados: ${data?.length || 0}`);
        
        return (data || []).map(art => ({
            id: art.id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido,
            ley_id: art.ley_id,
            ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
            similitud: art.similarity || 0
        }));
        
    } catch (e) {
        console.error('❌ Error en búsqueda semántica:', e.message);
        return buscarPorTexto(pregunta, leyId, limite);
    }
}

// ========== BÚSQUEDA POR TEXTO (FALLBACK) ==========
async function buscarPorTexto(pregunta, leyId = null, limite = 20) {
    try {
        const query = supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id');
        
        if (leyId) {
            query.eq('ley_id', parseInt(leyId));
        }
        
        query.limit(limite);
        
        const { data, error } = await query.execute();
        
        if (error) {
            console.error('❌ Error en búsqueda por texto:', error);
            return [];
        }
        
        console.log(`📝 Búsqueda por texto: ${data?.length || 0} resultados`);
        
        return (data || []).map(art => ({
            id: art.id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido,
            ley_id: art.ley_id,
            ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
            similitud: 0
        }));
        
    } catch (e) {
        console.error('❌ Error en búsqueda por texto:', e.message);
        return [];
    }
}

// ========== GROQ: CLASIFICAR CONSULTA ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
    CRITERIOS DE CLASIFICACIÓN:
    - "Prescripción", "daños", "perjuicios", "responsabilidad civil", "accidente" → Código Civil (Ley 3)
    - "Contrato", "arrendamiento", "alquiler" → Código Civil (Ley 3)
    - "Propiedad horizontal", "condominio", "vecino" → LPH (Ley 2)
    - "Constitución", "derechos humanos", "amparo", "estado de excepción" → CRBV (Ley 1)
    - "Comercio", "sociedad", "empresa" → Código de Comercio (Ley 4)
    - "Procesal", "procedimiento", "juicio" → CPC (Ley 7)
    - "Detención", "flagrancia", "penal", "delito" → COPP (Ley 5)
    - "Arrendamiento vivienda" → Ley 8
    - "Violencia mujer" → Ley 9

    Leyes disponibles:
    1: CRBV (Constitución)
    2: LPH (Ley de Propiedad Horizontal)
    3: CCV (Código Civil)
    4: CCom (Código de Comercio)
    5: COPP (Código Orgánico Procesal Penal)
    6: CP (Código Penal)
    7: CPC (Código de Procedimiento Civil)
    8: Arrendamiento Vivienda
    9: Violencia Mujer
    10: Arrendamiento Comercial
    11: Registros

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {
        "ley_id": número de la ley principal,
        "articulo_num": número de artículo si se menciona específicamente (o null),
        "tema": "descripción breve del tema legal",
        "confianza": "alta/media/baja"
    }
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id} (${LEY_MAP[result.ley_id] || 'Desconocida'}), Confianza: ${result.confianza}, Tema: ${result.tema}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, articulo_num: null, tema: null, confianza: 'baja' };
    }
}

// ========== ETAPA 2: GROQ SELECCIONA EL ARTÍCULO EXACTO ==========
async function seleccionarArticuloExacto(pregunta, candidatos, leyId) {
    if (!candidatos || candidatos.length === 0) return [];

    const leyNombre = LEY_MAP[leyId] || 'Ley';
    console.log(`📚 ETAPA 2 - Analizando ${candidatos.length} candidatos con Groq...`);

    // Construir lista de candidatos
    let listaCandidatos = "";
    for (let i = 0; i < candidatos.length; i++) {
        const a = candidatos[i];
        const texto = a.contenido.substring(0, 400);
        listaCandidatos += `${i+1}. Artículo ${a.numero_articulo} (similitud: ${(a.similitud || 0).toFixed(2)}): ${texto}...\n`;
    }

    const prompt = `
    Eres un Juez experto en derecho venezolano. De la siguiente lista de artículos candidatos de la ${leyNombre}, selecciona el ARTÍCULO EXACTO que responde a la pregunta del ciudadano.

    Pregunta del ciudadano: "${pregunta}"

    Artículos candidatos (ya preseleccionados por relevancia semántica):
    ${listaCandidatos}

    Instrucciones:
    1. Analiza cada artículo.
    2. Selecciona el que responde DIRECTAMENTE a la pregunta.
    3. Si hay varios, selecciona el MÁS IMPORTANTE (máximo 3).

    Responde SOLO con un arreglo JSON de los números de los artículos seleccionados.
    Ejemplo: [373] o [337, 338]
    Si ningún artículo responde la pregunta, responde: []
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        const seleccionados = Array.isArray(result) ? result : (result.ids || result.articulos || []);

        if (seleccionados.length === 0) {
            console.log('⚠️ Groq no seleccionó ningún artículo');
            return [];
        }

        // Mapear números seleccionados a artículos completos
        const articulosSeleccionados = [];
        for (const numArt of seleccionados) {
            const encontrado = candidatos.find(a => 
                a.numero_articulo.toString() === numArt.toString() ||
                a.numero_articulo.toString().replace(/\D/g, '') === numArt.toString()
            );
            if (encontrado) {
                articulosSeleccionados.push(encontrado);
            }
        }

        console.log(`📊 ETAPA 2 - Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);
        return articulosSeleccionados;

    } catch (error) {
        console.error("Error en selección de artículos:", error);
        return [];
    }
}

// ========== GROQ: GENERAR RESPUESTA FINAL ==========
async function generarRespuesta(pregunta, articulosSeleccionados, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';

    let contextoLegal = "";
    if (articulosSeleccionados.length > 0) {
        contextoLegal = articulosSeleccionados.map(a => 
            `Artículo ${a.numero_articulo} de ${a.ley_nombre || leyNombre}: "${a.contenido}"`
        ).join('\n\n');
    } else {
        contextoLegal = "No se encontraron artículos relevantes para esta consulta.";
    }

    const systemPrompt = `
Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

⚠️ REGLAS ABSOLUTAS:
1. SOLO puedes citar artículos que estén en el CONTEXTO LEGAL que se te proporciona.
2. Cada afirmación debe ir acompañada de: "Según el Artículo X de la Ley Y: [texto literal entre comillas]"
3. NO puedes inventar, interpretar ni dar opiniones personales.
4. Si el contexto no contiene información suficiente, responde: "No tengo información suficiente en mi base de datos para responder esta consulta."

ESTRUCTURA DE RESPUESTA:
1. INTRODUCCIÓN: Resumen de 2-3 líneas
2. FUNDAMENTOS LEGALES: Artículos con texto literal
3. ACCIONES RECOMENDADAS: Pasos prácticos (basados en la ley)
4. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
`;

    const promptFinal = `
CONTEXTO LEGAL:
${contextoLegal}

CONSULTA DEL USUARIO:
"${pregunta}"

INSTRUCCIÓN: Genera una respuesta siguiendo ESTRICTAMENTE la estructura y reglas indicadas.
`;

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 3000
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return "⚠️ Se produjo un error al generar la respuesta. Por favor, intenta de nuevo.";
    }
}

// ========== VALIDACIÓN DE CITAS ==========
async function verificarCitasEnRespuesta(respuesta, articulosContexto) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulosMencionados = [...new Set([...matches].map(m => parseInt(m[1])))];

    if (articulosMencionados.length === 0) {
        console.log('⚠️ No se encontraron citas de artículos en la respuesta');
        return false;
    }

    const idsContexto = [];
    for (const art of articulosContexto) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }

    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));

    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados detectados: ${invalidos.join(', ')}`);
        return false;
    }

    console.log(`✅ Todos los artículos citados (${articulosMencionados.join(', ')}) existen en el contexto`);
    return true;
}

// ========== ENDPOINT PRINCIPAL (RAG EN DOS ETAPAS) ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. CLASIFICAR CONSULTA
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id;

        if (!leyId) {
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable a tu consulta. Por favor, reformula tu pregunta o consulta con un abogado."
            });
        }

        console.log(`🔍 ETAPA 1 - Buscando candidatos en ${LEY_MAP[leyId]}...`);
        
        // 2. ETAPA 1: BÚSQUEDA SEMÁNTICA (reduce 500+ artículos a ~20 candidatos)
        let candidatos = await buscarCandidatos(pregunta, leyId, 25);
        
        // Si no hay candidatos, buscar en todas las leyes
        if (candidatos.length === 0) {
            console.log('🔄 No se encontraron candidatos en la ley detectada. Buscando en todas las leyes...');
            candidatos = await buscarCandidatos(pregunta, null, 30);
            if (candidatos.length > 0) {
                leyId = candidatos[0].ley_id;
                console.log(`✅ Candidatos encontrados en ${LEY_MAP[leyId]}`);
            }
        }

        if (candidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes en mi base de datos para tu consulta. Te recomiendo reformular la pregunta o consultar con un abogado."
            });
        }

        console.log(`📊 ETAPA 1 - ${candidatos.length} candidatos encontrados`);

        // 3. ETAPA 2: GROQ SELECCIONA EL ARTÍCULO EXACTO
        const articulosSeleccionados = await seleccionarArticuloExacto(
            pregunta, 
            candidatos, 
            leyId
        );

        if (articulosSeleccionados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes para tu consulta. Te recomiendo consultar con un abogado especializado."
            });
        }

        console.log(`📊 ETAPA 2 - Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);

        // 4. GENERAR RESPUESTA FINAL
        let respuesta = await generarRespuesta(
            pregunta, 
            articulosSeleccionados, 
            leyId
        );

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosSeleccionados);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Regenerando respuesta...');
            respuesta = await generarRespuesta(
                pregunta, 
                articulosSeleccionados, 
                leyId
            );
            
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta, articulosSeleccionados);
            if (!citasValidas2) {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
                });
            }
        }

        res.json({ respuesta });

    } catch (error) {
        console.error(`❌ Error crítico:`, error);
        res.status(500).json({
            respuesta: "⚠️ Se produjo un error procesal en el servidor de LexnaVe. Por favor, reintente su consulta."
        });
    }
});

// ========== INICIO DEL SERVIDOR ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
});
