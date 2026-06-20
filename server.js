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
                patrones: {},
                correcciones: {},
                estadisticas: {}
            };
            guardarAprendizaje();
        }
    } catch (e) {
        console.error('Error cargando aprendizaje:', e);
        learningData = { patrones: {}, correcciones: {}, estadisticas: {} };
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
            const puntaje = clave.length; // Priorizar palabras clave más largas
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
            // Actualizar frecuencia
            learningData.patrones[palabra].frecuencia = (learningData.patrones[palabra].frecuencia || 0) + 1;
            learningData.patrones[palabra].ultimo_uso = new Date().toISOString();
        }
    }
    
    if (aprendidos > 0) {
        guardarAprendizaje();
    }
}

// ========== VALIDAR RELEVANCIA ANTES DE APRENDER ==========
async function esArticuloRelevante(pregunta, articuloNumero, contenido, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    const prompt = `
    Eres un Juez experto en derecho venezolano. Evalúa si el siguiente artículo responde DIRECTAMENTE a la pregunta del usuario.

    Pregunta del usuario: "${pregunta}"

    Artículo ${articuloNumero} de la ${leyNombre}:
    "${contenido.substring(0, 800)}"

    Responde SOLO con "SI" si el artículo responde directamente a la pregunta, o "NO" si no es relevante.
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
            max_tokens: 5
        });

        const resultado = response.choices[0].message.content.trim().toUpperCase();
        return resultado === 'SI';
    } catch (error) {
        console.error("Error validando relevancia:", error);
        return false;
    }
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

// ========== CLASIFICACIÓN MEJORADA ==========
async function clasificarConsulta(pregunta) {
    // Verificar aprendizaje primero
    const aprendizaje = aplicarAprendizaje(pregunta);
    if (aprendizaje && aprendizaje.ley) {
        return {
            ley_id: aprendizaje.ley,
            tema: 'Detectado por aprendizaje',
            confianza: 'alta',
            aprendizaje: aprendizaje
        };
    }
    
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
    REGLAS DE CLASIFICACIÓN:
    - Si menciona "accidente", "choque", "daños", "perjuicios" → Código Civil (Ley 3)
    - Si menciona "prescripción", "plazo" → Código Civil (Ley 3)
    - Si menciona "detención", "flagrancia", "arresto" → COPP (Ley 5)
    - Si menciona "letra de cambio", "pagare", "cheque" → Código de Comercio (Ley 4)
    - Si menciona "vecino", "condominio", "propiedad horizontal" → LPH (Ley 2)
    - Si menciona "amparo", "constitución" → CRBV (Ley 1)
    - Si menciona "procedimiento", "juicio", "demanda" → CPC (Ley 7)
    - Si menciona "arrendamiento", "alquiler" → Ley 8 o 10

    Leyes disponibles:
    1: CRBV, 2: LPH, 3: Código Civil, 4: Código de Comercio, 5: COPP, 6: Código Penal, 7: CPC, 8: Arrendamiento Vivienda, 9: Violencia Mujer, 10: Arrendamiento Comercial, 11: Registros

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {"ley_id": número, "tema": "descripción", "confianza": "alta/media/baja"}
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

// ========== GENERAR RESPUESTA DIRECTA ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId, articuloAprendido = null) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    let contextoLegal = "";
    const articulosMostrar = candidatos.slice(0, 30);
    
    for (let i = 0; i < articulosMostrar.length; i++) {
        const a = articulosMostrar[i];
        contextoLegal += `\n--- Artículo ${a.numero_articulo} (similitud: ${(a.similitud || 0).toFixed(2)}) ---\n${a.contenido}\n`;
    }
    
    let instruccionPrioritaria = "";
    if (articuloAprendido && articuloAprendido.length > 0) {
        instruccionPrioritaria = `
⚠️ INSTRUCCIÓN PRIORITARIA:
El sistema de aprendizaje ha identificado que el(los) artículo(s) ${articuloAprendido.join(', ')} es(son) el(los) más relevante(s) para esta consulta.
DEBES priorizar estos artículos al generar la respuesta.
`;
    }
    
    const systemPrompt = `
    Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

    ⚠️ INSTRUCCIONES ESTRICTAS:
    1. Lee la PREGUNTA del usuario y extrae las PALABRAS CLAVE.
    2. Lee TODOS los artículos del contexto legal proporcionado.
    3. ${articuloAprendido && articuloAprendido.length > 0 ? `**PRIORIZA LOS ARTÍCULOS ${articuloAprendido.join(', ')}** que el sistema de aprendizaje ha identificado como los más relevantes.` : 'Analiza cada artículo y selecciona el que mejor responda la pregunta.'}
    4. Si no hay artículo prioritario, selecciona el artículo que contenga MÁS coincidencias con las palabras clave.
    5. Cita el artículo TEXTUALMENTE entre comillas.
    6. NO inventes artículos que no estén en el contexto.
    7. Si no encuentras un artículo que responda, di: "No tengo información suficiente."

    ${instruccionPrioritaria}

    ESTRUCTURA DE RESPUESTA:
    1. INTRODUCCIÓN (2-3 líneas)
    2. "Según el Artículo X de la Ley Y: [texto literal entre comillas]"
    3. Explicación breve de cómo aplica al caso
    4. ACCIONES RECOMENDADAS (pasos prácticos)
    5. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
    `;

    const promptFinal = `
    CONTEXTO LEGAL:
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
            temperature: 0.1,
            max_tokens: 3000
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return "⚠️ Se produjo un error al generar la respuesta. Por favor, intenta de nuevo.";
    }
}

// ========== EXTRAER ARTÍCULOS CITADOS ==========
function extraerArticulosCitados(respuesta) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulos = [...new Set([...matches].map(m => m[1]))];
    return articulos;
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

// ========== OBTENER TODAS LAS LEYES ==========
async function obtenerTodasLasLeyes() {
    try {
        const { data, error } = await supabase
            .from('leyes')
            .select('id, nombre')
            .order('id');
        
        if (error) {
            console.error('Error obteniendo leyes:', error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.error('Error en obtenerTodasLasLeyes:', e);
        return [];
    }
}

// ========== ENDPOINT PRINCIPAL - VERSIÓN UNIVERSAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. VERIFICAR APRENDIZAJE
        const aprendizaje = aplicarAprendizaje(pregunta);
        let leyId = null;
        let articuloAprendido = null;
        let respuestaFinal = null;
        
        if (aprendizaje) {
            leyId = aprendizaje.ley;
            articuloAprendido = aprendizaje.articulos || [];
            console.log(`🧠 Usando aprendizaje: Ley ${leyId}, Artículos ${articuloAprendido.join(', ')}`);
        }

        // 2. CLASIFICAR (si no hay aprendizaje)
        if (!leyId) {
            const clasificacion = await clasificarConsulta(pregunta);
            leyId = clasificacion.ley_id;
            console.log(`📋 Clasificación: Ley ${leyId}`);
        }

        // 3. FUNCIÓN PARA PROCESAR UNA LEY
        async function procesarLey(idLey) {
            console.log(`🔍 Buscando en ${LEY_MAP[idLey] || 'Ley ' + idLey}...`);
            const candidatos = await buscarCandidatos(pregunta, idLey, 100);
            
            if (candidatos.length === 0) return null;
            
            console.log(`📊 ${candidatos.length} candidatos encontrados`);
            
            // Generar respuesta con prioridad de aprendizaje
            const respuesta = await generarRespuestaDirecta(pregunta, candidatos, idLey, articuloAprendido);
            
            // Validar citas
            const citasValidas = await verificarCitasEnRespuesta(respuesta, candidatos);
            if (!citasValidas) return null;
            
            // Validar relevancia del artículo citado
            const articulosCitados = extraerArticulosCitados(respuesta);
            if (articulosCitados.length > 0) {
                const primerArticulo = articulosCitados[0];
                const articuloEncontrado = candidatos.find(a => 
                    a.numero_articulo.toString() === primerArticulo
                );
                if (articuloEncontrado) {
                    const esRelevante = await esArticuloRelevante(
                        pregunta, 
                        primerArticulo, 
                        articuloEncontrado.contenido,
                        idLey
                    );
                    if (!esRelevante) {
                        console.log(`⚠️ El artículo ${primerArticulo} no es relevante para esta pregunta`);
                        return null;
                    }
                    
                    // Aprender si es relevante
                    if (!aprendizaje) {
                        aprenderPatron(pregunta, idLey, articulosCitados, true);
                        console.log(`✅ Aprendizaje guardado: "${pregunta}" → Artículo ${primerArticulo}`);
                    }
                }
            }
            
            return respuesta;
        }

        // 4. PROCESAR LEY DETECTADA
        if (leyId) {
            respuestaFinal = await procesarLey(leyId);
        }

        // 5. SI FALLA O NO HAY LEY, BUSCAR EN TODAS
        if (!respuestaFinal) {
            console.log('🔄 Buscando en todas las leyes...');
            const todasLasLeyes = await obtenerTodasLasLeyes();
            
            for (const ley of todasLasLeyes) {
                if (ley.id === leyId) continue; // Saltar la ya probada
                respuestaFinal = await procesarLey(ley.id);
                if (respuestaFinal) break;
            }
        }

        // 6. SI AÚN NO HAY RESPUESTA
        if (!respuestaFinal) {
            return res.json({
                respuesta: "⚠️ No encontré información suficiente en mi base de datos para responder tu consulta. Te recomiendo consultar con un abogado especializado."
            });
        }

        res.json({ respuesta: respuestaFinal });

    } catch (error) {
        console.error(`❌ Error crítico:`, error);
        res.status(500).json({
            respuesta: "⚠️ Se produjo un error en el servidor. Por favor, reintente su consulta."
        });
    }
});

// ========== ENDPOINT DE ESTADÍSTICAS ==========
app.get('/api/aprendizaje', (req, res) => {
    res.json({
        total_patrones: Object.keys(learningData.patrones || {}).length,
        patrones: learningData.patrones || {},
        estadisticas: learningData.estadisticas || {}
    });
});

// ========== INICIO DEL SERVIDOR ==========
const PORT = process.env.PORT || 10000;

cargarAprendizaje();

app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
    console.log(`🧠 Sistema de aprendizaje activo con ${Object.keys(learningData.patrones || {}).length} patrones`);
    console.log(`📚 Mapeo de ${Object.keys(LEY_MAP).length} leyes disponible`);
});
