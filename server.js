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

// ========== GENERAR EMBEDDING ==========
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

// ========== BÚSQUEDA POR SIMILITUD ==========
async function buscarPorSimilitud(pregunta, leyId = null, limite = 50) {
    try {
        const embedding = await generarEmbedding(pregunta);
        
        if (!embedding) {
            console.log('📝 Embedding no disponible, usando búsqueda por texto (fallback)');
            return buscarPorTexto(pregunta, leyId, limite);
        }
        
        const { data, error } = await supabase.rpc('match_articles', {
            query_embedding: embedding,
            match_ley_id: leyId || 0,
            match_threshold: 0.15,
            match_count: limite
        });
        
        if (error) {
            console.error('❌ Error en búsqueda vectorial:', error);
            return buscarPorTexto(pregunta, leyId, limite);
        }
        
        console.log(`🔍 Búsqueda vectorial (ley ${leyId || 'todas'}): ${data?.length || 0} resultados`);
        
        return (data || []).map(art => ({
            id: art.id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido,
            ley_id: art.ley_id,
            ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
            similitud: art.similarity || 0
        }));
        
    } catch (e) {
        console.error('❌ Error en búsqueda vectorial:', e.message);
        return buscarPorTexto(pregunta, leyId, limite);
    }
}

// ========== BÚSQUEDA POR TEXTO (FALLBACK) ==========
async function buscarPorTexto(pregunta, leyId = null, limite = 50) {
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
    - "Prescripción", "plazo", "daños", "perjuicios", "responsabilidad civil", "accidente" → Código Civil (Ley 3)
    - "Servidumbre", "luz natural", "muro", "pared medianera" → Código Civil (Ley 3)
    - "Matrimonio", "divorcio", "separacion", "alimentos" → Código Civil (Ley 3)
    - "Herencia", "testamento", "sucesion" → Código Civil (Ley 3)
    - "Contrato", "obligaciones" → Código Civil (Ley 3)
    - "Hurto", "robo", "pena", "prisión", "delito" → Código Penal (Ley 6)
    - "Detención", "flagrancia", "fiscal", "juez" → COPP (Ley 5)
    - "Letra de cambio", "comercio", "sociedad", "empresa" → Código de Comercio (Ley 4)
    - "Propiedad horizontal", "condominio", "vecino", "cuotas" → LPH (Ley 2)
    - "Constitución", "amparo", "derechos humanos" → CRBV (Ley 1)
    - "Procedimiento", "juicio", "demanda", "intimación" → CPC (Ley 7)
    - "Arrendamiento vivienda" → Ley 8
    - "Violencia mujer" → Ley 9

    Leyes disponibles:
    1: CRBV, 2: LPH, 3: Código Civil, 4: Código de Comercio, 5: COPP, 6: Código Penal, 7: CPC, 8: Arrendamiento Vivienda, 9: Violencia Mujer, 10: Arrendamiento Comercial, 11: Registros

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {"ley_id": número, "tema": "descripción breve", "confianza": "alta/media/baja"}
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id} (${LEY_MAP[result.ley_id] || 'Desconocida'}), Confianza: ${result.confianza}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, tema: null, confianza: 'baja' };
    }
}

// ========== GROQ: GENERAR RESPUESTA DIRECTA CON PROMPT MEJORADO ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    // Tomar los mejores 20 candidatos
    const mejores = candidatos.slice(0, 20);
    
    // Construir contexto con los artículos completos
    let contextoLegal = "";
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        const texto = a.contenido.substring(0, 500);
        contextoLegal += `\nArtículo ${a.numero_articulo} (similitud: ${(a.similitud || 0).toFixed(2)}):\n${texto}...\n`;
    }
    
    const systemPrompt = `
Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

⚠️ INSTRUCCIONES ESTRICTAS:
1. Lee la PREGUNTA del usuario y extrae las PALABRAS CLAVE (ej: "divorcio", "mutuo acuerdo", "separación").
2. Lee TODOS los artículos del contexto legal proporcionado.
3. Para CADA artículo, cuenta cuántas de esas PALABRAS CLAVE aparecen en su contenido.
4. Selecciona el artículo que CONTENGA MÁS coincidencias con las palabras clave de la pregunta.
5. Si varios artículos tienen coincidencias, elige el que mejor responda la pregunta.
6. Cita el artículo TEXTUALMENTE entre comillas.
7. NO inventes artículos que no estén en el contexto.
8. Si no encuentras un artículo que responda, di: "No tengo información suficiente."

ESTRUCTURA DE RESPUESTA:
1. INTRODUCCIÓN (2-3 líneas que respondan directamente a la pregunta)
2. "Según el Artículo X de la Ley Y: [texto literal entre comillas]"
3. Explicación breve de cómo aplica al caso
4. ACCIONES RECOMENDADAS (pasos prácticos basados en la ley)
5. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
`;

    const promptFinal = `
CONTEXTO LEGAL (${leyNombre}):
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

// ========== EXTRAER Y VALIDAR CITAS ==========
function extraerArticulosCitados(respuesta) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    return [...new Set([...matches].map(m => m[1]))];
}

async function verificarCitasEnRespuesta(respuesta, candidatos) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulosMencionados = [...new Set([...matches].map(m => parseInt(m[1])))];
    
    if (articulosMencionados.length === 0) {
        console.log('⚠️ No se encontraron citas de artículos en la respuesta');
        return false;
    }
    
    const idsContexto = [];
    for (const art of candidatos) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }
    
    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));
    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados detectados: ${invalidos.join(', ')}`);
        return false;
    }
    
    console.log(`✅ Todos los artículos citados existen en el contexto`);
    return true;
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. CLASIFICAR CONSULTA
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id;

        // Si no se detectó ley, buscar en todas
        if (!leyId) {
            console.log('⚠️ No se detectó ley. Buscando en todas las leyes...');
            const candidatosGlobales = await buscarPorSimilitud(pregunta, null, 50);
            if (candidatosGlobales.length > 0) {
                leyId = candidatosGlobales[0].ley_id;
                console.log(`✅ Ley encontrada: ${LEY_MAP[leyId]}`);
                const respuesta = await generarRespuestaDirecta(pregunta, candidatosGlobales, leyId);
                const citasValidas = await verificarCitasEnRespuesta(respuesta, candidatosGlobales);
                if (citasValidas) {
                    return res.json({ respuesta });
                }
            }
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable. Reformula tu pregunta o consulta con un abogado."
            });
        }

        console.log(`🔍 Buscando en ley ${leyId} (${LEY_MAP[leyId]})`);
        
        // 2. BÚSQUEDA VECTORIAL
        let articulosEncontrados = await buscarPorSimilitud(pregunta, leyId, 50);

        // 3. SI NO ENCUENTRA RESULTADOS, BUSCAR EN TODAS LAS LEYES
        if (articulosEncontrados.length === 0) {
            console.log('🔄 No se encontraron resultados en la ley detectada. Buscando en todas las leyes...');
            articulosEncontrados = await buscarPorSimilitud(pregunta, null, 50);
            
            if (articulosEncontrados.length > 0) {
                leyId = articulosEncontrados[0].ley_id;
                console.log(`✅ Artículos encontrados en ${LEY_MAP[leyId]}`);
            }
        }

        if (articulosEncontrados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes en mi base de datos. Reformula tu pregunta o consulta con un abogado."
            });
        }

        console.log(`📚 Total artículos encontrados: ${articulosEncontrados.length}`);

        // 4. GENERAR RESPUESTA CON GROQ (con prompt mejorado)
        let respuesta = await generarRespuestaDirecta(pregunta, articulosEncontrados, leyId);

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosEncontrados);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Regenerando con más contexto...');
            const masCandidatos = await buscarPorSimilitud(pregunta, leyId, 80);
            if (masCandidatos.length > articulosEncontrados.length) {
                respuesta = await generarRespuestaDirecta(pregunta, masCandidatos, leyId);
                const citasValidas2 = await verificarCitasEnRespuesta(respuesta, masCandidatos);
                if (!citasValidas2) {
                    return res.json({
                        respuesta: "⚠️ No tengo información suficiente. Te recomiendo consultar con un abogado."
                    });
                }
            } else {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente. Te recomiendo consultar con un abogado."
                });
            }
        }

        res.json({ respuesta });

    } catch (error) {
        console.error(`❌ Error crítico:`, error);
        res.status(500).json({
            respuesta: "⚠️ Se produjo un error en el servidor. Por favor, reintente su consulta."
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
