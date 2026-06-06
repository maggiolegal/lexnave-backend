import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;

    // 1. Obtener leyes dinámicas
    const { data: leyes } = await supabase.from("leyes").select("id, nombre");
    const listaLeyesTexto = leyes.map(l => `${l.id}: ${l.nombre}`).join("\n");

    // 2. Clasificación Inteligente (Intención + Concepto)
    const clasificacionPrompt = `Eres experto legal. Analiza la pregunta: "${pregunta}".
    Leyes disponibles: ${listaLeyesTexto}.
    Responde SOLO JSON: {"ley_id": número, "articulo": "número o null", "concepto": "concepto clave para buscar"}`;

    const groqClasif = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: clasificacionPrompt }], temperature: 0.1 })
    });
    const clasifData = await groqClasif.json();
    const cls = JSON.parse(clasifData.choices[0].message.content);

    // 3. Búsqueda inteligente en Supabase
    let query = supabase.from("articulos").select(`*, leyes (nombre)`).eq("ley_id", cls.ley_id);
    
    if (cls.articulo && cls.articulo !== "null") {
      query = query.eq("numero_articulo", cls.articulo);
    } else {
      query = query.textSearch("contenido", cls.concepto);
    }
    const { data: articulos } = await query.limit(1);

    // 4. Respuesta con Subsunción
    if (articulos && articulos.length > 0) {
        const art = articulos[0];
        const respuestaPrompt = `Eres abogada experta en Venezuela. 
        Analiza: Ley ${art.leyes.nombre}, Art ${art.numero_articulo}: ${art.contenido}. 
        Caso: "${pregunta}". 
        ESTRUCTURA: 1. Empatía. 2. Subsunción (aplica la ley al caso). 3. Tres pasos prácticos legales. 4. Aviso legal.`;
        
        // ... (código para llamar a Groq con este prompt y retornar respuesta)
    }
  } catch (e) { res.status(500).json({ error: "Error técnico" }); }
});
