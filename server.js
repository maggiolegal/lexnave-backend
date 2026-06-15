import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import ws from 'ws';
import crypto from 'crypto';

env.allowLocalModels = false;
env.useBrowserCache = false;

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    realtime: { autoReconnect: false, transport: ws }
  }
);

async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: "Token requerido." });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(authHeader.split(' ')[1]);
    if (error || !user) return res.status(401).json({ error: "Token inválido." });
    req.user = user;
    next();
  } catch (err) { res.status(500).json({ error: "Error auth." }); }
}

let extractor = null;
async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return extractor;
}

async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Actúa como clasificador jurídico. Tu salida debe ser EXACTAMENTE: CATEGORIA | palabra1, palabra2
Ejemplos:
"choque" -> responsabilidad_civil | accidente, daño, reparación, negligencia
"compra casa" -> derecho_inmobiliario | compraventa, entrega, tradición, inmueble
"articulo 1185" -> articulo_1185_codigo_civil | hecho_ilicito

INPUT: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0 })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (e) { return preguntaColoquial; }
}

app.post('/api/consultar', verifyAuth, async (req, res) => {
  try {
    const { pregunta, sessionId: clientSessionId } = req.body;
    const userId = req.user.id;
    const safeSessionId = clientSessionId || `${userId}_${crypto.randomUUID().split('-')[0]}`;

    const terminosTecnicos = await traducirATerminosJuridicos(pregunta);
    const [categoria, keywordsRaw] = terminosTecnicos.split('|');
    
    let articulos = [];
    
    // 1. Búsqueda Vectorial estricta
    const currentExtractor = await getExtractor();
    const queryEmbedding = Array.from((await currentExtractor(keywordsRaw || pregunta, { pooling: 'mean', normalize: true })).data);
    const { data: searchResults } = await supabase.rpc('match_articulos', { 
        query_embedding: queryEmbedding, 
        match_threshold: 0.70, 
        match_count: 3 
    });

    if (searchResults && searchResults.length > 0) articulos = searchResults;

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos en nuestra base legal.";

    const promptFinal = `Eres LexnaVe, una asistente legal experta en Venezuela.
CONTEXTO LEGAL RECUPERADO:
${contextoArticulos}

REGLAS DE ORO:
1. Si el contexto dice "No se encontraron...", admite que no tienes el artículo exacto, pero orienta al usuario hacia el área del derecho (ej: civil, mercantil) y sugiere consultar un abogado.
2. NUNCA inventes artículos ni cites números que no aparecen en el CONTEXTO.
3. Si el contexto es irrelevante para la pregunta, no fuerces una respuesta legal falsa.
4. Responde con empatía profesional.

PREGUNTA: "${pregunta}"
`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.1 })
    });

    const respuesta = (await groqRes.json()).choices[0].message.content;
    res.json({ respuesta, sessionId: safeSessionId });

  } catch (error) {
    res.status(500).json({ respuesta: "Lo siento, hubo un error procesando tu consulta." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v21.0 en puerto ${PORT}`));
