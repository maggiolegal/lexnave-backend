import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import ws from 'ws'; 

env.allowLocalModels = false; 
env.useBrowserCache = false;

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
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
    console.log("🧠 Cargando modelo semántico...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("✅ Modelo listo.");
  }
  return extractor;
}

// ✅ TRADUCTOR SEMÁNTICO: Solo extrae artículos específicos si existen
async function extraerReferenciasLegales(preguntaColoquial) {
  const prompt = `Analiza la siguiente pregunta legal. 
1. Si el usuario menciona un ARTÍCULO ESPECÍFICO (ej: art 410, artículo 1167), devuélvelo en formato: articulo_NUMERO_ley (ej: articulo_410_codigo_comercio).
2. Si NO menciona artículos, devuelve simplemente: CONSULTA_GENERAL.
3. No añadas nada más.

EJEMPLOS:
Input: "me chocaron" → Output: CONSULTA_GENERAL
Input: "que dice el art 1167 civil" → Output: articulo_1167_codigo_civil
Input: "compré un carro y no me lo dan" → Output: CONSULTA_GENERAL

INPUT: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (error) { return "CONSULTA_GENERAL"; }
}

async function obtenerMemoria(sessionId) {
  if (!sessionId) return [];
  const { data: historial } = await supabase.from('chat_history').select('role, content').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(5);
  return historial?.reverse() || [];
}

async function guardarMensaje(sessionId, role, content) {
  if (!sessionId) return;
  await supabase.from('chat_history').insert({ session_id: sessionId, role, content });
}

app.post('/api/consultar', verifyAuth, async (req, res) => {
  try {
    const { pregunta, sessionId: clientSessionId } = req.body;
    const userId = req.user.id;
    const safeSessionId = clientSessionId && clientSessionId.startsWith(`${userId}_`) ? clientSessionId : `${userId}_${crypto.randomUUID().split('-')[0]}`;

    console.log(`📨 [${userId.substring(0,8)}...] Pregunta:`, pregunta);
    await guardarMensaje(safeSessionId, 'user', pregunta);
    const historial = await obtenerMemoria(safeSessionId);

    let articulos = [];
    const referencia = await extraerReferenciasLegales(pregunta);

    // 1. Búsqueda Exacta si se menciona un artículo
    if (referencia !== "CONSULTA_GENERAL") {
      console.log("🎯 Referencia exacta detectada:", referencia);
      const partes = referencia.split('_'); 
      const numArt = partes[1];
      const leyRef = partes.slice(2).join('_').toLowerCase();
      
      const mapLeyes = { 'constitucion': 1, 'propiedad_horizontal': 2, 'codigo_civil': 3, 'codigo_comercio': 4, 'coppp': 5, 'codigo_penal': 6, 'codigo_procedimiento_civil': 7, 'lottt': 8 };
      const leyKey = Object.keys(mapLeyes).find(k => leyRef.includes(k));
      const leyId = leyKey ? mapLeyes[leyKey] : null;

      if (leyId) {
        const { data } = await supabase.from('articulos').select('*, leyes(nombre)').eq('numero_articulo', numArt).eq('ley_id', leyId).limit(1);
        if (data && data.length > 0) articulos = data;
      }
    }

    // 2. Búsqueda Semántica Pura (La magia de la traducción conceptual)
    if (articulos.length === 0) {
      console.log("🔍 Búsqueda semántica pura...");
      const currentExtractor = await getExtractor();
      // El modelo transforma "no me entregan el carro" en un vector cercano a "obligación de entregar"
      const output = await currentExtractor(pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      const { data, error } = await supabase.rpc('match_articulos', { 
        query_embedding: queryEmbedding, 
        match_threshold: 0.15, 
        match_count: 5 
      });
      
      if (!error && data && data.length > 0) {
        articulos = data;
        console.log(`✅ Semántica encontró ${data.length} artículos.`);
      } else {
        // 3. Fallback Textual por Raíces (Sin diccionarios)
        console.log("⚠️ Fallback textual activado...");
        // Tomamos las palabras significativas de la pregunta (más de 3 letras)
        const palabrasClave = pregunta.split(' ')
          .filter(p => p.length > 3)
          .map(p => `contenido_enriquecido.ilike.%${p}%`)
          .join(',');
        
        if (palabrasClave) {
          const { data: textData } = await supabase.from('articulos').select('*, leyes(nombre)').or(palabrasClave).limit(3);
          if (textData) articulos = textData;
        }
      }
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática.

ARTÍCULOS RECUPERADOS:
${contextoArticulos}

PREGUNTA: "${pregunta}"

INSTRUCCIONES:
1. EMPATÍA: Inicia reconociendo el sentimiento del usuario.
2. CITACIÓN: Cita textualmente al menos un artículo relevante: "El artículo [NUM] del [LEY] establece que [TEXTO]".
3. EXPLICACIÓN: Explica cómo aplica al caso en lenguaje simple.
4. CIERRE: "⚖️ Esto es orientación general. Consulta con un abogado."

Si no hay artículos relevantes, dilo con empatía y da orientación general.`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.2 })
    });

    const data = await groqRes.json();
    const respuesta = data.choices[0].message.content;
    await guardarMensaje(safeSessionId, 'assistant', respuesta);
    res.json({ respuesta, sessionId: safeSessionId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ respuesta: "Error técnico." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v22.0 (Semantic Pure) activo en puerto ${PORT}`));
