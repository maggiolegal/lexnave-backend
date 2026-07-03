import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { pipeline } from '@xenova/transformers';

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { transport: WebSocket } });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const LEY_MAP = { 1: "CRBV", 2: "LPH", 3: "Código Civil", 4: "Código de Comercio", 5: "COPP", 6: "Código Penal", 7: "CPC", 8: "Arrendamiento Vivienda", 9: "Violencia Mujer", 10: "Arrendamiento Comercial", 11: "Registros" };

let embedder = null;
async function initEmbedder() {
    if (!embedder) {
        console.log('🔄 Cargando embeddings...');
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ Embeddings cargados');
    }
    return embedder;
}

function safeJsonParse(raw) {
    try { return JSON.parse(raw.trim()); } catch (e) {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0].trim()) : null;
    }
}

async function generarEmbedding(texto) {
    try {
        const model = await initEmbedder();
        const result = await model(texto.length > 500 ? texto.substring(0, 500) : texto, { pooling: 'mean', normalize: true });
        return Array.from(result.data);
    } catch (e) { return null; }
}

async function buscarPorSimilitud(pregunta, leyId = null, limite = 25) {
    try {
        const emb = await generarEmbedding(pregunta);
        if (!emb) return [];
        const { data, error } = await supabase.rpc('match_articles', { query_embedding: emb, match_ley_id: leyId || 0, match_threshold: 0.15, match_count: limite });
        if (error) return [];
        return data.map(a => ({ id: a.id, numero_articulo: a.numero_articulo, contenido: a.contenido, ley_id: a.ley_id, ley_nombre: LEY_MAP[a.ley_id] || 'Ley' }));
    } catch (e) { return []; }
}

async function buscarPorNumero(leyId, numero) {
    try {
        const { data } = await supabase.from('articulos').select('id, numero_articulo, contenido, ley_id').eq('ley_id', parseInt(leyId)).ilike('numero_articulo', `%${numero}%`).maybeSingle();
        return data ? { id: data.id, numero_articulo: data.numero_articulo, contenido: data.contenido, ley_id: data.ley_id, ley_nombre: LEY_MAP[data.ley_id] || 'Ley' } : null;
    } catch (e) { return null; }
}

function detectarNumero(pregunta) {
    const match = pregunta.match(/(?:art[íi]culo\.?\s*)(\d+)/i);
    return match ? match[1] : null;
}

async function clasificar(pregunta) {
    const prompt = `Clasifica esta consulta legal venezolana. Responde SOLO con JSON: {"ley_id": número}

REGLAS: Divorcio, hijos, alimentos, herencia, contrato, daños, accidente, ventana, carro, vecino → Código Civil (3)
Hurto, robo, homicidio, delito, pena → Código Penal (6)
Detención, flagrancia, fiscal, juez → COPP (5)
Demanda, juicio, procedimiento, pruebas → CPC (7)
Condominio, cuotas, edificio → LPH (2)
Constitución, amparo, derechos → CRBV (1)
Comercio, letra, sociedad → Código de Comercio (4)
Violencia mujer → Ley 9
Arrendamiento vivienda → Ley 8
Registro, notaría → Ley 11

Pregunta: "${pregunta}"`;

    try {
        const res = await groq.chat.completions.create({ messages: [{ role: 'user', content: prompt }], model: 'llama-3.3-70b-versatile', temperature: 0.1, response_format: { type: "json_object" }, max_tokens: 50 });
        const result = safeJsonParse(res.choices[0].message.content);
        return result?.ley_id || 3;
    } catch (e) { return 3; }
}

async function responder(pregunta, articulos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    const tops = articulos.slice(0, 4);
    let ctx = "", nums = [];
    for (const a of tops) { nums.push(a.numero_articulo); ctx += `\n--- Art. ${a.numero_articulo} ---\n${a.contenido.substring(0, 300)}...\n`; }
    const inst = nums.length > 0 ? `\n⚠️ SOLO cita: ${nums.join(', ')}.` : '';

    const system = `Eres LexnaVe, asistente legal venezolano. SOLO cita artículos del CONTEXTO.${inst}

Estructura:
1. INTRODUCCIÓN (2 líneas)
2. "Según el Artículo X: [texto literal]"
3. Explicación breve
4. ACCIONES (3 pasos)
5. ⚖️ Consulta con un abogado.`;

    const final = `CONTEXTO (${leyNombre}):\n${ctx}\nPREGUNTA: "${pregunta}"`;

    try {
        const res = await groq.chat.completions.create({ messages: [{ role: 'system', content: system }, { role: 'user', content: final }], model: 'llama-3.3-70b-versatile', temperature: 0.1, max_tokens: 700 });
        return res.choices[0].message.content;
    } catch (e) { return null; }
}

function limpiar(respuesta, articulos) {
    const matches = [...respuesta.matchAll(/Art(?:ículo)?\.?\s*(\d+)/gi)];
    const mencionados = [...new Set(matches.map(m => parseInt(m[1])))];
    if (!mencionados.length) return respuesta;

    const disponibles = articulos.map(a => parseInt(a.numero_articulo.toString().replace(/\D/g, '')));
    const invalidos = mencionados.filter(a => !disponibles.includes(a));

    if (invalidos.length) {
        console.log(`⚠️ Alucinados: ${invalidos.join(', ')}`);
        const nums = articulos.slice(0, 3).map(a => a.numero_articulo).join(', ');
        return `Según el Código, los artículos relevantes son: ${nums}. Consulta con un abogado.`;
    }
    return respuesta;
}

app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    console.log(`📨 ${pregunta}`);

    try {
        let leyId = 3, articulos = [];

        // 1. Buscar por número
        const num = detectarNumero(pregunta);
        if (num) {
            const art = await buscarPorNumero(leyId, num);
            if (art) { articulos = [art]; }
        }

        // 2. Clasificar y buscar
        if (!articulos.length) {
            leyId = await clasificar(pregunta);
            articulos = await buscarPorSimilitud(pregunta, leyId, 25);
        }

        // 3. Fallback
        if (!articulos.length) {
            articulos = await buscarPorSimilitud(pregunta, null, 25);
            if (articulos.length) leyId = articulos[0].ley_id;
        }

        if (!articulos.length) {
            return res.json({ respuesta: "⚠️ No encontré artículos. Consulta con un abogado." });
        }

        let respuesta = await responder(pregunta, articulos, leyId);
        if (respuesta) respuesta = limpiar(respuesta, articulos);

        res.json({ respuesta: respuesta || "⚠️ No tengo información suficiente." });

    } catch (e) {
        console.error(e);
        res.status(500).json({ respuesta: "⚠️ Error en el servidor." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log('🚀 LexnaVe iniciando...');
    await initEmbedder();
    console.log(`🚀 Servidor en puerto ${PORT}`);
});
