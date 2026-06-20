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

// ========== PATRONES INICIALES (FORZADOS) ==========
const PATRONES_INICIALES = {
    'accidente': { ley: 3, articulos: ['1185'] },
    'choque': { ley: 3, articulos: ['1185'] },
    'daños': { ley: 3, articulos: ['1185'] },
    'perjuicios': { ley: 3, articulos: ['1185'] },
    'responsabilidad civil': { ley: 3, articulos: ['1185'] },
    'letra de cambio': { ley: 4, articulos: ['410'] },
    'requisitos letra': { ley: 4, articulos: ['410'] },
    'detención': { ley: 5, articulos: ['373'] },
    'flagrancia': { ley: 5, articulos: ['373'] },
    'presentación juez': { ley: 5, articulos: ['373'] },
    'luz natural': { ley: 3, articulos: ['571', '572', '573', '574'] },
    'muro': { ley: 3, articulos: ['571', '572', '573'] },
    'servidumbre': { ley: 3, articulos: ['571', '572', '573', '574', '575', '576', '577'] },
    'prescripción': { ley: 3, articulos: ['1969'] },
    'plazo prescripción': { ley: 3, articulos: ['1969'] },
    'estado de excepción': { ley: 1, articulos: ['337', '338', '339'] },
    'amparo': { ley: 1, articulos: ['26', '27'] },
    'propiedad horizontal': { ley: 2, articulos: ['5', '7', '8', '9', '14'] },
    'condominio': { ley: 2, articulos: ['5', '7', '8', '9', '14'] },
    'vecino': { ley: 2, articulos: ['3', '5', '8'] },
    'ruido': { ley: 2, articulos: ['3', '8'] }
};

function cargarAprendizaje() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            learningData = JSON.parse(data);
            console.log(`📚 Aprendizaje cargado: ${Object.keys(learningData.patrones || {}).length} patrones`);
        } else {
            // Inicializar con patrones forzados
            learningData = {
                patrones: { ...PATRONES_INICIALES },
                correcciones: {},
                estadisticas: {}
            };
            guardarAprendizaje();
            console.log(`✅ Patrones iniciales forzados: ${Object.keys(PATRONES_INICIALES).length}`);
        }
    } catch (e) {
        console.error('Error cargando aprendizaje:', e);
        learningData = { patrones: { ...PATRONES_INICIALES }, correcciones: {}, estadisticas: {} };
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
    let mejorMatch = null;
    let mejorPuntaje = 0;
    
    for (const [clave, valor] of Object.entries(learningData.patrones || {})) {
        if (preguntaLower.includes(clave)) {
            const puntaje = clave.length;
            if (puntaje > mejorPuntaje) {
                mejorPuntaje = puntaje;
                mejorMatch = valor;
            }
        }
    }
    
    if (mejorMatch) {
        console.log(`🧠 Aprendizaje aplicado: patrón con puntaje ${mejorPuntaje}`);
        return mejorMatch;
    }
    return null;
}

function aprenderPatron(pregunta, leyId, articulos, esCorrecto = true) {
    if (!esCorrecto) return;
    
    const palabras = pregunta.toLowerCase().replace(/[¿?,.!]/g, '').split(' ');
    const palabrasClave = palabras.filter(p => p.length > 4);
    
    let aprendidos = 0;
    for (const palabra of palabrasClave) {
        if (!learningData.patrones[palabra]) {
            learningData.patrones[palabra] = { 
                ley: leyId, 
                articulos: articulos,
                frecuencia: 1,
                ultimo_uso: new Date().toISOString()
            };
            aprendidos++;
            console.log(`🧠 Nuevo patrón aprendido: "${palabra}" → Ley ${leyId}, Artículos ${articulos.join(', ')}`);
        } else {
            learningData.patrones[palabra].frecuencia = (learningData.patrones[palabra].frecuencia || 0) + 1;
            learningData.patrones[palabra].ultimo_uso = new Date().toISOString();
        }
    }
    
    if (aprendidos > 0) {
        guardarAprendizaje();
    }
}

// ========== VALIDAR RELEVANCIA ==========
async function esArticuloRelevante(pregunta, articuloNumero, contenido, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    const prompt = `
    Evalúa si el siguiente artículo responde DIRECTAMENTE a la pregunta.
    Responde SOLO "SI" o "NO".

    Pregunta: "${pregunta}"
    Artículo ${articuloNumero} (${leyNombre}): "${contenido.substring(0, 300)}"

    Respuesta:`;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
            max_tokens: 5
        });
        return response.choices[0].message.content.trim().toUpperCase() === 'SI';
    } catch (error) {
        console.error("Error validando:", error);
        return false;
    }
}

// ========== MODELO DE EMBEDDING ==========
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
                throw new Error(`Error parseando JSON: ${innerError.message}`);
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
        return Array.from(result.data);
    } catch (error) {
        console.error('❌ Error generando embedding:', error.message);
        return null;
    }
}

// ========== BÚSQUEDA HÍBRIDA ==========
async function buscarCandidatos(pregunta, leyId = null, limite = 50) {
    let resultados = [];
    
    // 1. BÚSQUEDA POR PALABRAS CLAVE (artículos exactos)
    const numerosMencionados = pregunta.match(/\b\d{1,4}\b/g) || [];
    for (const num of numerosMencionados) {
        const { data } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', leyId || 0)
            .eq('numero_articulo', num)
            .maybeSingle();
        if (data) {
            resultados.push({
                id: data.id,
                numero_articulo: data.numero_articulo,
                contenido: data.contenido,
                ley_id: data.ley_id,
                ley_nombre: LEY_MAP[data.ley_id] || 'Ley',
                similitud: 1.0
            });
        }
    }
    
    // 2. BÚSQUEDA SEMÁNTICA (embeddings)
    const embedding = await generarEmbedding(pregunta);
    if (embedding) {
        const { data } = await supabase.rpc('match_articles', {
            query_embedding: embedding,
            match_ley_id: leyId || 0,
            match_threshold: 0.1,
            match_count: limite
        });
        
        if (data) {
            const idsExistentes = new Set(resultados.map(r => r.id));
            for (const art of data) {
                if (!idsExistentes.has(art.id)) {
                    resultados.push({
                        id: art.id,
                        numero_articulo: art.numero_articulo,
                        contenido: art.contenido,
                        ley_id: art.ley_id,
                        ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
                        similitud: art.similarity || 0
                    });
                    idsExistentes.add(art.id);
                }
            }
        }
    }
    
    console.log(`🔍 Candidatos encontrados: ${resultados.length}`);
    return resultados.slice(0, limite);
}

// ========== CLASIFICACIÓN ==========
async function clasificarConsulta(pregunta) {
    const aprendizaje = aplicarAprendizaje(pregunta);
    if (aprendizaje && aprendizaje.ley) {
        return { ley_id: aprendizaje.ley, confianza: 'alta', aprendizaje: aprendizaje };
    }
    
    const prompt = `
    Clasifica la siguiente consulta legal.
    Responde SOLO con JSON: {"ley_id": número}

    Leyes: 1=CRBV, 2=LPH, 3=Código Civil, 4=Código Comercio, 5=COPP, 6=Código Penal, 7=CPC, 8=Arrendamiento Vivienda, 9=Violencia Mujer, 10=Arrendamiento Comercial, 11=Registros

    Consulta: "${pregunta}"
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" },
            max_tokens: 50
        });
        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null };
    }
}

// ========== GENERAR RESPUESTA (OPTIMIZADA) ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId, articuloAprendido = null) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    // Seleccionar los 10 mejores candidatos y truncar contenido
    const mejores = candidatos
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, 10);
    
    let contextoLegal = "";
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        const texto = a.contenido.substring(0, 400);
        contextoLegal += `\nArt. ${a.numero_articulo} (${(a.similitud || 0).toFixed(2)}): ${texto}...\n`;
    }
    
    let instruccion = "";
    if (articuloAprendido && articuloAprendido.length > 0) {
        instruccion = `\n⚠️ PRIORIZA los artículos ${articuloAprendido.join(', ')}.`;
    }
    
    const prompt = `
    Eres LexnaVe, asistente legal venezolano.

    Responde a la pregunta usando SOLO los artículos del contexto.
    Cita el artículo exacto con su texto literal.

    Pregunta: "${pregunta}"
    Ley: ${leyNombre}
    Contexto:${contextoLegal}
    ${instruccion}

    Estructura:
    1. INTRODUCCIÓN (2 líneas)
    2. "Según el Artículo X: [texto literal]"
    3. ACCIONES RECOMENDADAS (3 pasos)
    4. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."`;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 1000
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return null;
    }
}

// ========== EXTRAER ARTÍCULOS CITADOS ==========
function extraerArticulosCitados(respuesta) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    return [...new Set([...matches].map(m => m[1]))];
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. APLICAR APRENDIZAJE
        const aprendizaje = aplicarAprendizaje(pregunta);
        let leyId = aprendizaje?.ley || null;
        let articuloAprendido = aprendizaje?.articulos || null;
        
        // 2. CLASIFICAR SI NO HAY APRENDIZAJE
        if (!leyId) {
            const clasificacion = await clasificarConsulta(pregunta);
            leyId = clasificacion.ley_id;
        }

        // 3. BUSCAR EN LA LEY DETECTADA
        let candidatos = [];
        if (leyId) {
            candidatos = await buscarCandidatos(pregunta, leyId, 50);
        }
        
        // 4. SI NO HAY, BUSCAR EN TODAS
        if (candidatos.length === 0) {
            console.log('🔄 Buscando en todas las leyes...');
            for (let id = 1; id <= 11; id++) {
                if (id === leyId) continue;
                const temp = await buscarCandidatos(pregunta, id, 30);
                if (temp.length > 0) {
                    candidatos = temp;
                    leyId = id;
                    console.log(`✅ Encontrados en ${LEY_MAP[id]}`);
                    break;
                }
            }
        }

        if (candidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré información suficiente. Consulta con un abogado."
            });
        }

        // 5. GENERAR RESPUESTA
        const respuesta = await generarRespuestaDirecta(pregunta, candidatos, leyId, articuloAprendido);
        
        if (!respuesta) {
            return res.json({
                respuesta: "⚠️ Error generando respuesta. Intenta de nuevo."
            });
        }

        // 6. APRENDER SI ES RELEVANTE
        const articulosCitados = extraerArticulosCitados(respuesta);
        if (articulosCitados.length > 0 && !aprendizaje) {
            const primerArt = articulosCitados[0];
            const artEncontrado = candidatos.find(a => a.numero_articulo.toString() === primerArt);
            if (artEncontrado) {
                const esRelevante = await esArticuloRelevante(pregunta, primerArt, artEncontrado.contenido, leyId);
                if (esRelevante) {
                    aprenderPatron(pregunta, leyId, articulosCitados, true);
                }
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

cargarAprendizaje();

app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 Servidor activo en puerto ${PORT}`);
    console.log(`🧠 Patrones de aprendizaje: ${Object.keys(learningData.patrones || {}).length}`);
});
