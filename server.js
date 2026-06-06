import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Validación estricta de variables de entorno
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GROQ_API_KEY) {
  console.error("❌ ERROR: Faltan variables de entorno críticas. Revisa el panel de Render.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Obtención dinámica de leyes
async function obtenerLeyes() {
  const { data } = await supabase.from("leyes").select("id, nombre");
  return data || [];
}

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend v10.0 - Agente Inteligente', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    
    // 1. Clasificación con Razonamiento Semántico
    const leyes = await obtenerLeyes();
    const listaLeyesTexto = leyes.map(l => `${l.id}: ${l.nombre}`).join("\n");

    const clasificacionPrompt = `Eres un experto legal en Venezuela. Analiza: "${pregunta}".
    Leyes disponibles: ${listaLeyesTexto}.
    Responde SOLO JSON: {"ley_id": número, "articulo": "número o null", "concepto": "breve concepto legal"}
    Regla: Si no aplica, ley_id: 0.`;

    const groqClasif = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: clasificacionPrompt }], temperature: 0.1 })
    });
    
    const cls = JSON.parse((await groqClasif.json()).choices[0].message.content);
    
    // 2. Búsqueda inteligente en Supabase
    let query = supabase.from("articulos").select(`*, leyes (nombre)`).eq("ley_id", cls.ley_id);
    if (cls.articulo && cls.articulo !== "null") {
      query = query.eq("numero_articulo", cls.articulo);
    } else {
      query = query.textSearch("contenido", cls.concepto);
    }
    const { data: articulos } = await query.limit(1);

    // 3. Respuesta con Subsunción
    if (articulos && articulos.length > 0) {
      const art = articulos[0];
      const respuestaPrompt = `Eres LexnaVe, abogada venezolana experta.
      Analiza la Ley ${art.leyes.nombre}, Art ${art.numero_articulo}: "${art.contenido}".
      Caso del usuario: "${pregunta}".
      ESTRUCTURA: 1. Empatía. 2. Subsunción (aplica la ley al caso). 3. Tres pasos prácticos legales. 4. Aviso legal.`;

      const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: respuestaPrompt }], temperature: 0.2 })
      });
      
      let respuesta = (await groqResp.json()).choices[0].message.content;
      respuesta += `\n\n📚 **Norma:** ${art.leyes.nombre} Art. ${art.numero_articulo}`;
      return res.json({ respuesta });
    }
    
    res.json({ respuesta: "No encontré una base legal clara para tu consulta. Intenta ser más específico." });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe v10.0 activo en puerto ${PORT}`));
