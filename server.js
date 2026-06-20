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

function aprenderPatron(pregunta, leyId, articulos) {
    const palabras = pregunta.toLowerCase().split(' ');
    const palabrasClave = palabras.filter(p => p.length > 4);
    
    for (const palabra of palabrasClave) {
        if (!learningData.patrones[palabra]) {
            learningData.patrones[palabra] = { ley: leyId, articulos: articulos };
            console.log(`🧠 Nuevo patrón aprendido: "${palabra}" → Ley ${leyId}, Artículos ${articulos.join(', ')}`);
        }
    }
    guardarAprendizaje();
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
            confianza: 'alta',
            aprendizaje: aprendizaje
        };
    }
    
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
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
    let articulosPrioridad = [];
    if (articuloAprendido && articuloAprendido.length > 0) {
        articulosPrioridad = articuloAprendido;
        instruccionPrioritaria = `
⚠️ INSTRUCCIÓN PRIORITARIA:
El sistema de aprendizaje ha identificado que el(los) artículo(s) ${articulosPrioridad.join(', ')} es(son) el(los) más relevante(s) para esta consulta.
DEBES priorizar estos artículos al generar la respuesta.
`;
    }
    
    const systemPrompt = `
    Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

    ⚠️ INSTRUCCIONES ESTRICTAS:
    1. Lee la PREGUNTA del usuario y extrae las PALABRAS CLAVE.
    2. Lee TODOS los artículos del contexto legal proporcionado.
    3. ${articulosPrioridad.length > 0 ? `**PRIORIZA LOS ARTÍCULOS ${articulosPrioridad.join(', ')}** que el sistema de aprendizaje ha identificado como los más relevantes.` : 'Analiza cada artículo y selecciona el que mejor responda la pregunta.'}
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

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. VERIFICAR APRENDIZAJE
        const aprendizaje = aplicarAprendizaje(pregunta);
        let leyId = null;
        let articuloAprendido = null;
        
        if (aprendizaje) {
            leyId = aprendizaje.ley;
            articuloAprendido = aprendizaje.articulos || [];
        }

        // 2. CLASIFICAR (si no hay aprendizaje)
        if (!leyId) {
            const clasificacion = await clasificarConsulta(pregunta);
            leyId = clasificacion.ley_id;
        }

        if (!leyId) {
            console.log('🔄 Buscando en todas las leyes...');
            const candidatosGlobal = await buscarCandidatos(pregunta, null, 100);
            if (candidatosGlobal.length > 0) {
                leyId = candidatosGlobal[0].ley_id;
                console.log(`✅ Ley encontrada: ${LEY_MAP[leyId]}`);
                let respuestaGlobal = await generarRespuestaDirecta(pregunta, candidatosGlobal, leyId, articuloAprendido);
                const citasValidasGlobal = await verificarCitasEnRespuesta(respuestaGlobal, candidatosGlobal);
                if (citasValidasGlobal) {
                    const articulosCitados = extraerArticulosCitados(respuestaGlobal);
                    if (articulosCitados.length > 0) {
                        // VALIDAR RELEVANCIA ANTES DE APRENDER
                        const primerArticulo = articulosCitados[0];
                        const articuloEncontrado = candidatosGlobal.find(a => 
                            a.numero_articulo.toString() === primerArticulo
                        );
                        if (articuloEncontrado) {
                            const esRelevante = await esArticuloRelevante(
                                pregunta, 
                                primerArticulo, 
                                articuloEncontrado.contenido,
                                leyId
                            );
                            if (esRelevante) {
                                aprenderPatron(pregunta, leyId, articulosCitados);
                                console.log(`✅ Aprendizaje guardado: "${pregunta}" → Artículo ${primerArticulo}`);
                            } else {
                                console.log(`⚠️ No se aprendió: El artículo ${primerArticulo} no es relevante para la pregunta`);
                            }
                        }
                    }
                    return res.json({ respuesta: respuestaGlobal });
                }
            }
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable. Reformula tu pregunta o consulta con un abogado."
            });
        }

        // 3. BUSCAR CANDIDATOS
        console.log(`🔍 Buscando candidatos en ${LEY_MAP[leyId]}...`);
        let candidatos = await buscarCandidatos(pregunta, leyId, 100);

        if (candidatos.length === 0) {
            console.log('🔄 No se encontraron candidatos. Buscando en todas las leyes...');
            candidatos = await buscarCandidatos(pregunta, null, 100);
            if (candidatos.length > 0) {
                leyId = candidatos[0].ley_id;
                console.log(`✅ Candidatos encontrados en ${LEY_MAP[leyId]}`);
            }
        }

        if (candidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes. Reformula tu pregunta o consulta con un abogado."
            });
        }

        console.log(`📊 ${candidatos.length} candidatos encontrados`);

        // 4. GENERAR RESPUESTA
        let respuesta = await generarRespuestaDirecta(pregunta, candidatos, leyId, articuloAprendido);

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, candidatos);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Regenerando...');
            respuesta = await generarRespuestaDirecta(pregunta, candidatos, leyId, articuloAprendido);
            
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta, candidatos);
            if (!citasValidas2) {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente. Te recomiendo consultar con un abogado."
                });
            }
        }

        // 6. APRENDER SOLO SI ES RELEVANTE
        const articulosCitados = extraerArticulosCitados(respuesta);
        if (articulosCitados.length > 0 && !aprendizaje) {
            const primerArticulo = articulosCitados[0];
            const articuloEncontrado = candidatos.find(a => 
                a.numero_articulo.toString() === primerArticulo
            );
            if (articuloEncontrado) {
                const esRelevante = await esArticuloRelevante(
                    pregunta, 
                    primerArticulo, 
                    articuloEncontrado.contenido,
                    leyId
                );
                if (esRelevante) {
                    aprenderPatron(pregunta, leyId, articulosCitados);
                    console.log(`✅ Aprendizaje guardado: "${pregunta}" → Artículo ${primerArticulo}`);
                } else {
                    console.log(`⚠️ No se aprendió: El artículo ${primerArticulo} no es relevante para la pregunta`);
                }
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

cargarAprendizaje();

app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
    console.log(`🧠 Sistema de aprendizaje activo con ${Object.keys(learningData.patrones || {}).length} patrones`);
});
