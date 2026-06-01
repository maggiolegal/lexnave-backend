import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Variables de entorno (se configuran en Render)
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_KEY || !GROQ_API_KEY) {
  console.error("❌ Faltan variables de entorno: SUPABASE_KEY y GROQ_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend funcionando' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("🔍 Pregunta recibida:", pregunta);
    
    // 1. Buscar artículos en Supabase
    const { data: articulos, error } = await supabase
      .from("articulos")
      .select("*, leyes!inner(nombre)")
      .ilike("contenido", `%${pregunta}%`)
      .limit(5);
    
    if (error) {
      console.error("Error en Supabase:", error);
      return res.json({ articulos: [] });
    }
    
    // 2. Formatear respuesta
    const resultados = (articulos || []).map(art => ({
      id: art.id,
      numero_articulo: art.numero_articulo,
      contenido: art.contenido,
      ley_id: art.ley_id,
      nombre_ley: art.leyes?.nombre || "Ley venezolana"
    }));
    
    console.log(`✅ Encontrados ${resultados.length} artículos`);
    
    // 3. Generar respuesta con Groq
    let respuesta = "";
    if (resultados.length > 0) {
      let contexto = "";
      for (const art of resultados) {
        contexto += `\n📜 ${art.nombre_ley}\nArtículo ${art.numero_articulo}: ${art.contenido}\n`;
      }
      
      const prompt = `Eres LexnaVe, orientadora legal con IA especializada en derecho venezolano. Responde basándote SOLO en estos artículos:
${contexto}
Pregunta: "${pregunta}"
Instrucciones:
- NO inventes artículos que no estén en el contexto
- Si no hay información, dilo claramente
- Sé clara, directa y útil`;
      
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1
        })
      });
      
      const groqData = await groqRes.json();
      respuesta = groqData.choices[0].message.content;
      
      respuesta += "\n\n📖 **Fuentes consultadas:**";
      resultados.slice(0, 3).forEach(art => {
        respuesta += `\n• ${art.nombre_ley} - Art. ${art.numero_articulo}`;
      });
      respuesta += "\n\n---\n⚠️ **LexnaVe es una orientadora legal con IA.** Para tu caso específico, consulta con un profesional del Derecho.";
      
    } else {
      respuesta = "❌ No encontré artículos relacionados en mi base de datos.";
    }
    
    res.json({ respuesta, articulos: resultados });
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.json({ respuesta: `Error: ${error.message}`, articulos: [] });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend en puerto ${PORT}`);
});
