import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';

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

// ========== SISTEMA DE APRENDIZAJE ==========
const LEARNING_FILE = path.join(process.cwd(), 'learning_data.json');
let learningData = {};

function cargarAprendizaje() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            learningData = JSON.parse(data);
            console.log(`📚 Aprendizaje cargado: ${Object.keys(learningData.patrones || {}).length} patrones`);
        } else {
            learningData = {
                patrones: {
                    'servidumbre': { ley: 3, articulos: ['571', '572', '573', '574', '575', '576', '577'] },
                    'luz natural': { ley: 3, articulos: ['571', '572', '573', '574'] },
                    'muro': { ley: 3, articulos: ['571', '572', '573'] },
                    'pared medianera': { ley: 3, articulos: ['571', '572'] },
                    'detención': { ley: 5, articulos: ['373', '374', '375'] },
                    'flagrancia': { ley: 5, articulos: ['373'] },
                    'prescripción': { ley: 3, articulos: ['1969', '1950', '1951', '1952'] },
                    'daños': { ley: 3, articulos: ['1185', '1190', '1969'] },
                    'accidente': { ley: 3, articulos: ['1185', '1969'] },
                    'estado de excepción': { ley: 1, articulos: ['337', '338', '339'] },
                    'amparo': { ley: 1, articulos: ['26', '27'] },
                    'propiedad horizontal': { ley: 2, articulos: ['5', '7', '8', '9', '14'] },
                    'condominio': { ley: 2, articulos: ['5', '7', '8', '9', '14'] },
                    'vecino': { ley: 2, articulos: ['3', '5', '8'] },
                    'ruido': { ley: 2, articulos: ['3', '8'] }
                },
                correcciones: {}
            };
            guardarAprendizaje();
        }
    } catch (e) {
        console.error('Error cargando aprendizaje:', e);
        learningData = { patrones: {}, correcciones: {} };
    }
}

function guardarAprendizaje() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch (e) {
        console.error('Error guardando aprendizaje:', e);
    }
}

function aplicarAprendizaje(pregunta) {
    const preguntaLower = pregunta.toLowerCase();
    for (const [clave, valor] of Object.entries(learningData.patrones || {})) {
        if (preguntaLower.includes(clave)) {
            console.log(`🧠 Aprendizaje aplicado: "${clave}" → Ley ${valor.ley}, Artículos ${valor.articulos.join(', ')}`);
            return valor;
        }
    }
    return null;
}

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

// ========== BÚSQUEDA SEMÁNTICA ==========
async function buscarCandidatos(pregunta, leyId = null, limite = 100) {
    try {
        const embedding = await generarEmbedding(pregunta);
        if (!embedding) return [];
        
        const { data, error } = await supabase.rpc('match_articles', {
            query_embedding: embedding,
            match_ley_id: leyId || 0,
            match_threshold: 0.1,
            match_count: limite
        });
        
        if (error) {
            console.error('❌ Error en búsqueda semántica:', error);
            return [];
        }
        
        console.log(`🔍 Candidatos encontrados: ${data?.length || 0}`);
        
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
        return [];
    }
}

// ========== CLASIFICACIÓN ==========
async function clasificarConsulta(pregunta) {
    const aprendizaje = aplicarAprendizaje(pregunta);
    if (aprendizaje && aprendizaje.ley) {
        return {
            ley_id: aprendizaje.ley,
            articulo_num: null,
            tema: 'Detectado por aprendizaje',
            confianza: 'alta'
        };
    }
    
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
    CRITERIOS:
    - "Servidumbre", "luz natural", "muro" → Código Civil (Ley 3)
    - "Prescripción", "daños", "perjuicios" → Código Civil (Ley 3)
    - "Detención", "flagrancia" → COPP (Ley 5)
    - "Propiedad horizontal", "condominio", "vecino" → LPH (Ley 2)
    - "Constitución", "amparo", "estado de excepción" → CRBV (Ley 1)

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {"ley_id": número, "articulo_num": null, "tema": "descripción", "confianza": "alta/media/baja"}
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null };
    }
}

// ========== GENERAR RESPUESTA DIRECTA CON GROQ ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    // Preparar contexto con TODOS los artículos completos
    let contextoLegal = "";
    const articulosMostrar = candidatos.slice(0, 30); // Mostrar hasta 30 artículos completos
    
    for (let i = 0; i < articulosMostrar.length; i++) {
        const a = articulosMostrar[i];
        contextoLegal += `\nArtículo ${a.numero_articulo} (similitud: ${(a.similitud || 0).toFixed(2)}):\n${a.contenido}\n`;
    }
    
    const systemPrompt = `
    Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

    ⚠️ INSTRUCCIONES ESTRICTAS:
    1. Lee TODOS los artículos del contexto legal proporcionado.
    2. Identifica el artículo EXACTO que responde a la pregunta del usuario.
    3. Cita el artículo TEXTUALMENTE entre comillas.
    4. NO inventes artículos que no estén en el contexto.
    5. Si no encuentras un artículo que responda exactamente, di: "No tengo información suficiente."

    ESTRUCTURA DE RESPUESTA:
    1. INTRODUCCIÓN (2-3 líneas)
    2. "Según el Artículo X de la Ley Y: [texto literal entre comillas]"
    3. Explicación breve de cómo aplica al caso
    4. ACCIONES RECOMENDADAS (pasos prácticos)
    5. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
    `;

    const promptFinal = `
    CONTEXTO LEGAL (TODOS los artículos de ${leyNombre} relevantes a la consulta):
    ${contextoLegal}

    CONSULTA DEL USUARIO:
    "${pregunta}"

    INSTRUCCIÓN: Genera una respuesta siguiendo la estructura y reglas indicadas.
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
        // 1. CLASIFICAR
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id;

        if (!leyId) {
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable. Reformula tu pregunta o consulta con un abogado."
            });
        }

        // 2. BUSCAR CANDIDATOS (TODOS LOS RELEVANTES)
        console.log(`🔍 Buscando candidatos en ${LEY_MAP[leyId]}...`);
        const candidatos = await buscarCandidatos(pregunta, leyId, 100);

        if (candidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes. Reformula tu pregunta o consulta con un abogado."
            });
        }

        console.log(`📊 ${candidatos.length} candidatos encontrados`);

        // 3. GENERAR RESPUESTA DIRECTA CON GROQ
        const respuesta = await generarRespuestaDirecta(pregunta, candidatos, leyId);

        // 4. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, candidatos);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Regenerando...');
            const respuesta2 = await generarRespuestaDirecta(pregunta, candidatos, leyId);
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta2, candidatos);
            if (!citasValidas2) {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente. Te recomiendo consultar con un abogado."
                });
            }
            return res.json({ respuesta: respuesta2 });
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

cargarAprendizaje();

app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
    console.log(`🧠 Sistema de aprendizaje activo con ${Object.keys(learningData.patrones || {}).length} patrones`);
});
