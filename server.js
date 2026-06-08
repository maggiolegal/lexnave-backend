import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import ws from 'ws';

// Configuración para entorno servidor
env.allowLocalModels = false; 
env.useBrowserCache = false;

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_KEY || !GROQ_API_KEY) {
  console.error("❌ Faltan variables de entorno");
  process.exit(1);
}

// Configuración de Supabase con soporte WebSocket para Node 20
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch: (...args) => fetch(...args) },
  realtime: { transport: ws }
});

let extractor = null;

async function getExtractor() {
  if (!extractor) {
    console.log("🧠 Cargando modelo semántico (solo la primera vez)...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("✅ Modelo listo.");
  }
  return extractor;
}

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe v20.0 - Semantic Search Active' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);

    // 1. Generar Embedding (Vector de significado)
    const currentExtractor = await getExtractor();
    const output = await currentExtractor(pregunta, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(output.data);

    // 2. Búsqueda Semántica en Supabase
    const { data: articulos, error } = await supabase.rpc('match_articulos', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: 5
    });

    if (error) throw error;

    if (!articulos || articulos.length === 0) {
      return res.json({ respuesta: "No encontré normas relacionadas en la base de datos cargada." });
    }

    // 3. Construir Contexto
    let contexto = "";
    articulos.forEach((art, idx) => {
      contexto += `\n[${idx + 1}] ${art.leyes?.nombre || 'Ley'} - Art. ${art.numero_articulo}\n"${art.contenido}"\n`;
    });

    // 4. Generar Respuesta con Groq
    const prompt = `Eres LexnaVe, experta en derecho venezolano.
    
    PREGUNTA: "${pregunta}"
    
    ARTÍCULOS ENCONTRADOS:
    ${contexto}

    INSTRUCCIONES:
    1. Responde basándote ÚNICAMENTE en los artículos de arriba.
    2. Explica el concepto legal de forma sencilla.
    3. Cita la ley y el artículo.
    
    RESPUESTA:`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    const groqData = await groqRes.json();
    const respuestaIA = groqData.choices?.[0]?.message?.content;

    res.json({ respuesta: respuestaIA, articulos });

  } catch (error) {
    console.error("❌ Error Crítico:", error);
    res.status(500).json({ respuesta: "Error técnico en el servidor." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe v20.0 en puerto ${PORT}`));
