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

// Usa SERVICE_ROLE KEY aquí para garantizar acceso total
const supabase = createClient(
  process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
  process.env.SUPABASE_KEY,
  { realtime: { transport: ws } }
);

let extractor = null;
async function getExtractor() {
  if (!extractor) {
    console.log("🧠 Cargando modelo semántico...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("✅ Modelo listo.");
  }
  return extractor;
}

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log(" Pregunta:", pregunta);
    
    const currentExtractor = await getExtractor();
    const output = await currentExtractor(pregunta, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(output.data);

    const { data: articulos } = await supabase.rpc('match_articulos', {
      query_embedding: queryEmbedding,
      match_threshold: 0.65,
      match_count: 5
    });

    if (!articulos?.length) {
      return res.json({ respuesta: "No encontré normas relacionadas en la base legal cargada." });
    }

    const contexto = articulos.map((a, i) => 
      `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`
    ).join('\n');

    const prompt = `Eres LexnaVe, abogada venezolana experta. Responde SOLO basándote en estos artículos:

ARTÍCULOS:
${contexto}

PREGUNTA: "${pregunta}"

INSTRUCCIONES:
1. Explica claramente qué dice la ley aplicable.
2. Aplica la ley al caso concreto del usuario.
3. Da pasos prácticos inmediatos.
4. Usa lenguaje sencillo y empático.
5. Incluye siempre: "️ Esto es orientación general. Consulta con un abogado."`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    const data = await groqRes.json();
    res.json({ respuesta: data.choices[0].message.content });

  } catch (error) {
    console.error("❌ Error crítico:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v20.0 activo en puerto ${PORT}`));
