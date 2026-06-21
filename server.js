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

// ========== BÚSQUEDA POR SIMILITUD (OPTIMIZADA) ==========
async function buscarPorSimilitud(pregunta, leyId = null, limite = 30) {
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
async function buscarPorTexto(pregunta, leyId = null, limite = 30) {
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
            response_format: { type: "json_object" },
            max_tokens: 100
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id} (${LEY_MAP[result.ley_id] || 'Desconocida'}), Confianza: ${result.confianza}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, tema: null, confianza: 'baja' };
    }
}

// ========== GROQ: GENERAR RESPUESTA DIRECTA (OPTIMIZADA) ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    // Tomar los 12 mejores candidatos (reducido de 20)
    const mejores = candidatos.slice(0, 12);
    
    // Construir contexto con 350 caracteres (reducido de 500)
    let contextoLegal = "";
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        const texto = a.contenido.substring(0, 350);
        contextoLegal += `\nArt. ${a.numero_articulo} (${(a.similitud || 0).toFixed(2)}): ${texto}...\n`;
    }
    
    const systemPrompt = `
Eres "LexnaVe", asistente jurídico experto en leyes venezolanas.

⚠️ INSTRUCCIONES:
1. Extrae palabras clave de la pregunta.
2. Lee todos los artículos del contexto.
3. Selecciona el artículo con MÁS coincidencias con las palabras clave.
4. Cita el artículo TEXTUALMENTE.
5. NO inventes artículos.

ESTRUCTURA DE RESPUESTA:
1. INTRODUCCIÓN (2 líneas)
2. "Según el Artículo X de la Ley Y: [texto literal]"
3. Explicación breve
4. ACCIONES RECOMENDADAS (3 pasos)
5. ⚖️ Esto es orientación general. Consulta con un abogado.
`;

    const promptFinal = `
CONTEXTO (${leyNombre}):
${contextoLegal}

PREGUNTA: "${pregunta}"

INSTRUCCIÓN: Responde con la estructura indicada.
`;

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 1500
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return "⚠️ Error al generar la respuesta. Intenta de nuevo.";
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
        console.log('⚠️ No se encontraron citas de artículos');
        return false;
    }
    
    const idsContexto = [];
    for (const art of candidatos) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }
    
    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));
    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados: ${invalidos.join(', ')}`);
        return false;
    }
    
    console.log(`✅ Artículos citados existen en el contexto`);
    return true;
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. CLASIFICAR
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id;

        if (!leyId) {
            console.log('⚠️ No se detectó ley. Buscando en todas...');
            const candidatosGlobales = await buscarPorSimilitud(pregunta, null, 30);
            if (candidatosGlobales.length > 0) {
                leyId = candidatosGlobales[0].ley_id;
                const respuesta = await generarRespuestaDirecta(pregunta, candidatosGlobales, leyId);
                const citasValidas = await verificarCitasEnRespuesta(respuesta, candidatosGlobales);
                if (citasValidas) {
                    return res.json({ respuesta });
                }
            }
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable. Consulta con un abogado."
            });
        }

        console.log(`🔍 Buscando en ${LEY_MAP[leyId]}`);
        
        // 2. BÚSQUEDA VECTORIAL (30 artículos)
        let articulosEncontrados = await buscarPorSimilitud(pregunta, leyId, 30);

        // 3. SI NO HAY, BUSCAR EN TODAS
        if (articulosEncontrados.length === 0) {
            console.log('🔄 Buscando en todas las leyes...');
            articulosEncontrados = await buscarPorSimilitud(pregunta, null, 30);
            if (articulosEncontrados.length > 0) {
                leyId = articulosEncontrados[0].ley_id;
            }
        }

        if (articulosEncontrados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes. Consulta con un abogado."
            });
        }

        console.log(`📚 ${articulosEncontrados.length} artículos encontrados`);

        // 4. GENERAR RESPUESTA
        let respuesta = await generarRespuestaDirecta(pregunta, articulosEncontrados, leyId);

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosEncontrados);

        if (!citasValidas) {
            console.log('⚠️ Regenerando...');
            const masCandidatos = await buscarPorSimilitud(pregunta, leyId, 50);
            if (masCandidatos.length > articulosEncontrados.length) {
                respuesta = await generarRespuestaDirecta(pregunta, masCandidatos, leyId);
                const citasValidas2 = await verificarCitasEnRespuesta(respuesta, masCandidatos);
                if (!citasValidas2) {
                    return res.json({
                        respuesta: "⚠️ No tengo información suficiente. Consulta con un abogado."
                    });
                }
            } else {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente. Consulta con un abogado."
                });
            }
        }

        res.json({ respuesta });

    } catch (error) {
        console.error(`❌ Error:`, error);
        res.status(500).json({
            respuesta: "⚠️ Error en el servidor. Intenta de nuevo."
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
