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

// ========== GROQ: IDENTIFICAR EL ARTÍCULO EXACTO ==========
async function identificarArticulo(pregunta) {
    const prompt = `
    Eres un experto en derecho venezolano. Analiza la pregunta y determina el artículo exacto que la responde.

    REGLAS:
    - Si pregunta sobre "prescripción", "plazo", "daños", "perjuicios", "accidente" → Artículo 1969 del Código Civil
    - Si pregunta sobre "detención", "flagrancia" → Artículo 373 del COPP
    - Si pregunta sobre "letra de cambio", "requisitos" → Artículo 410 del Código de Comercio
    - Si pregunta sobre "luz natural", "muro", "servidumbre" → Artículos 571-577 del Código Civil
    - Si pregunta sobre "propiedad horizontal", "condominio", "vecino" → Ley de Propiedad Horizontal

    Pregunta: "${pregunta}"

    Responde SOLO con JSON:
    {
        "ley_id": número de la ley (1-11),
        "articulo_num": número del artículo (o null si no está seguro),
        "tema": "descripción breve del tema",
        "confianza": "alta/media/baja"
    }
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" },
            max_tokens: 150
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`🎯 Artículo identificado: Ley ${result.ley_id}, Artículo ${result.articulo_num}`);
        return result;
    } catch (error) {
        console.error("Error identificando artículo:", error);
        return { ley_id: null, articulo_num: null, tema: null, confianza: 'baja' };
    }
}

// ========== BUSCAR ARTÍCULO POR NÚMERO ==========
async function buscarArticuloPorNumero(leyId, articuloNum) {
    try {
        // Buscar el artículo específico
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .eq('numero_articulo', articuloNum.toString())
            .maybeSingle();

        if (error || !data) {
            console.log(`❌ Artículo ${articuloNum} no encontrado en ley ${leyId}`);
            return null;
        }

        console.log(`✅ Artículo ${articuloNum} encontrado`);
        return {
            id: data.id,
            numero_articulo: data.numero_articulo,
            contenido: data.contenido,
            ley_id: data.ley_id,
            ley_nombre: LEY_MAP[data.ley_id] || 'Ley'
        };
    } catch (e) {
        console.error('Error buscando artículo:', e);
        return null;
    }
}

// ========== GENERAR RESPUESTA FINAL ==========
async function generarRespuesta(pregunta, articulo, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';

    if (!articulo) {
        return "⚠️ No encontré el artículo que responde a tu consulta. Te recomiendo consultar con un abogado.";
    }

    const systemPrompt = `
Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

⚠️ REGLAS ABSOLUTAS:
1. SOLO puedes citar el artículo que está en el CONTEXTO.
2. Cada afirmación debe ir acompañada de: "Según el Artículo X de la Ley Y: [texto literal]"
3. NO puedes inventar, interpretar ni dar opiniones personales.

ESTRUCTURA DE RESPUESTA:
1. INTRODUCCIÓN (2 líneas)
2. "Según el Artículo ${articulo.numero_articulo} de la ${leyNombre}: [texto literal]"
3. ACCIONES RECOMENDADAS (3 pasos prácticos)
4. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
`;

    const promptFinal = `
CONTEXTO LEGAL:
Artículo ${articulo.numero_articulo} de la ${leyNombre}: "${articulo.contenido}"

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
            max_tokens: 1000
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return "⚠️ Se produjo un error al generar la respuesta. Por favor, intenta de nuevo.";
    }
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. GROQ IDENTIFICA EL ARTÍCULO EXACTO
        const identificacion = await identificarArticulo(pregunta);
        
        if (!identificacion.ley_id || !identificacion.articulo_num) {
            return res.json({
                respuesta: "⚠️ No pude identificar la ley o artículo que responde a tu consulta. Te recomiendo consultar con un abogado."
            });
        }

        // 2. BUSCAR EL ARTÍCULO EN SUPABASE
        const articulo = await buscarArticuloPorNumero(identificacion.ley_id, identificacion.articulo_num);

        if (!articulo) {
            return res.json({
                respuesta: `⚠️ No encontré el Artículo ${identificacion.articulo_num} en la base de datos. Te recomiendo consultar con un abogado.`
            });
        }

        // 3. GENERAR RESPUESTA
        const respuesta = await generarRespuesta(pregunta, articulo, identificacion.ley_id);

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
