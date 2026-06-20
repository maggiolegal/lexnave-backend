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

// Cargar datos de aprendizaje
function cargarAprendizaje() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            const data = fs.readFileSync(LEARNING_FILE, 'utf8');
            learningData = JSON.parse(data);
            console.log(`📚 Aprendizaje cargado: ${Object.keys(learningData).length} patrones`);
        } else {
            // Datos iniciales de aprendizaje
            learningData = {
                patrones: {
                    // Palabras clave y su relación con artículos
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
                // Correcciones de clasificación
                correcciones: {
                    'prescripción daños': { ley: 3 },
                    'detención juez': { ley: 5 },
                    'muro vecino': { ley: 3 }
                }
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
        console.log('💾 Aprendizaje guardado');
    } catch (e) {
        console.error('Error guardando aprendizaje:', e);
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

function aplicarAprendizaje(pregunta) {
    const preguntaLower = pregunta.toLowerCase();
    
    // Buscar patrón exacto
    for (const [clave, valor] of Object.entries(learningData.patrones)) {
        if (preguntaLower.includes(clave)) {
            console.log(`🧠 Aprendizaje aplicado: "${clave}" → Ley ${valor.ley}, Artículos ${valor.articulos.join(', ')}`);
            return valor;
        }
    }
    
    // Buscar correcciones
    for (const [clave, valor] of Object.entries(learningData.correcciones)) {
        if (preguntaLower.includes(clave)) {
            console.log(`🧠 Corrección aplicada: "${clave}" → Ley ${valor.ley}`);
            return { ley: valor.ley, articulos: [] };
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

// ========== BÚSQUEDA SEMÁNTICA CON GROQ ==========
async function buscarCandidatos(pregunta, leyId = null, limite = 100) {
    try {
        const embedding = await generarEmbedding(pregunta);
        
        if (!embedding) {
            console.log('📝 Embedding no disponible, usando búsqueda por texto');
            return [];
        }
        
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

// ========== CLASIFICACIÓN MEJORADA CON APRENDIZAJE ==========
async function clasificarConsulta(pregunta) {
    // 1. Verificar aprendizaje primero
    const aprendizaje = aplicarAprendizaje(pregunta);
    if (aprendizaje && aprendizaje.ley) {
        return {
            ley_id: aprendizaje.ley,
            articulo_num: null,
            tema: `Detectado por aprendizaje: ${Object.keys(learningData.patrones).find(k => pregunta.includes(k))}`,
            confianza: 'alta',
            aprendizaje: true
        };
    }
    
    // 2. Si no hay aprendizaje, usar Groq
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
    CRITERIOS DE CLASIFICACIÓN:
    - "Servidumbre", "luz natural", "muro" → Código Civil (Ley 3) - Artículos 571-577
    - "Prescripción", "daños", "perjuicios" → Código Civil (Ley 3)
    - "Detención", "flagrancia" → COPP (Ley 5) - Artículo 373
    - "Propiedad horizontal", "condominio", "vecino" → LPH (Ley 2)
    - "Constitución", "amparo", "estado de excepción" → CRBV (Ley 1)
    - "Comercio", "sociedad" → Código de Comercio (Ley 4)
    - "Procedimiento", "juicio" → CPC (Ley 7)

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {
        "ley_id": número de la ley principal,
        "articulo_num": número de artículo si se menciona específicamente (o null),
        "tema": "descripción breve",
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
        console.log(`📋 Clasificación: Ley ${result.ley_id}, Confianza: ${result.confianza}, Tema: ${result.tema}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, articulo_num: null, tema: null, confianza: 'baja' };
    }
}

// ========== SELECCIÓN EXACTA CON GROQ ==========
async function seleccionarArticuloExacto(pregunta, candidatos, leyId) {
    if (!candidatos || candidatos.length === 0) return [];

    // Verificar aprendizaje para artículos específicos
    const aprendizaje = aplicarAprendizaje(pregunta);
    if (aprendizaje && aprendizaje.articulos && aprendizaje.articulos.length > 0) {
        const articulosAprendidos = candidatos.filter(a => 
            aprendizaje.articulos.includes(a.numero_articulo.toString())
        );
        if (articulosAprendidos.length > 0) {
            console.log(`🧠 Usando artículos del aprendizaje: ${articulosAprendidos.map(a => a.numero_articulo).join(', ')}`);
            return articulosAprendidos;
        }
    }

    const leyNombre = LEY_MAP[leyId] || 'Ley';
    console.log(`📚 Analizando ${candidatos.length} candidatos con Groq...`);

    let listaCandidatos = "";
    for (let i = 0; i < Math.min(candidatos.length, 25); i++) {
        const a = candidatos[i];
        const texto = a.contenido.substring(0, 400);
        listaCandidatos += `${i+1}. Artículo ${a.numero_articulo} (similitud: ${(a.similitud || 0).toFixed(2)}): ${texto}...\n`;
    }

    const prompt = `
    Eres un Juez experto en derecho venezolano. De la siguiente lista de artículos candidatos de la ${leyNombre}, selecciona el ARTÍCULO EXACTO que responde a la pregunta.

    Pregunta: "${pregunta}"

    Artículos candidatos:
    ${listaCandidatos}

    Instrucciones:
    1. Analiza CADA artículo.
    2. Selecciona el que responde DIRECTAMENTE a la pregunta.
    3. Si es sobre servidumbres de luces, busca artículos que hablen de distancias o muros.
    4. Si es sobre detención, busca artículos con plazos de horas.
    5. Responde SOLO con un arreglo JSON de números de artículos. Ejemplo: [571] o [373] o []

    Responde SOLO con JSON. No agregues texto adicional.
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
            console.log('⚠️ Groq no seleccionó artículos');
            return [];
        }

        const articulosSeleccionados = [];
        for (const numArt of seleccionados) {
            const numStr = numArt.toString();
            const encontrado = candidatos.find(a => 
                a.numero_articulo.toString() === numStr ||
                a.numero_articulo.toString().replace(/\D/g, '') === numStr
            );
            if (encontrado) {
                articulosSeleccionados.push(encontrado);
                console.log(`✅ Artículo seleccionado: ${encontrado.numero_articulo}`);
            }
        }

        // Aprender de la selección
        if (articulosSeleccionados.length > 0) {
            const articulosNum = articulosSeleccionados.map(a => a.numero_articulo.toString());
            aprenderPatron(pregunta, leyId, articulosNum);
        }

        return articulosSeleccionados;

    } catch (error) {
        console.error("❌ Error en selección:", error.message);
        return [];
    }
}

// ========== GENERAR RESPUESTA FINAL ==========
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
1. SOLO puedes citar artículos que estén en el CONTEXTO LEGAL.
2. Cada afirmación debe ir acompañada de: "Según el Artículo X de la Ley Y: [texto literal]"
3. NO puedes inventar, interpretar ni dar opiniones personales.

ESTRUCTURA DE RESPUESTA:
1. INTRODUCCIÓN: Resumen de 2-3 líneas
2. FUNDAMENTOS LEGALES: Artículos con texto literal
3. ACCIONES RECOMENDADAS: Pasos prácticos
4. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
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

        if (!leyId) {
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable. Reformula tu pregunta o consulta con un abogado."
            });
        }

        // 2. BÚSQUEDA SEMÁNTICA
        console.log(`🔍 Buscando candidatos...`);
        let candidatos = await buscarCandidatos(pregunta, leyId, 100);

        if (candidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes. Reformula tu pregunta o consulta con un abogado."
            });
        }

        console.log(`📊 ${candidatos.length} candidatos encontrados`);

        // 3. SELECCIÓN EXACTA
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

        console.log(`📊 Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);

        // 4. GENERAR RESPUESTA
        let respuesta = await generarRespuesta(
            pregunta,
            articulosSeleccionados,
            leyId
        );

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosSeleccionados);

        if (!citasValidas) {
            console.log('⚠️ Artículos alucinados detectados. Regenerando...');
            respuesta = await generarRespuesta(
                pregunta,
                articulosSeleccionados,
                leyId
            );
            
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta, articulosSeleccionados);
            if (!citasValidas2) {
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

// Cargar aprendizaje al iniciar
cargarAprendizaje();

app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
    console.log(`🧠 Sistema de aprendizaje activo con ${Object.keys(learningData.patrones || {}).length} patrones`);
});
