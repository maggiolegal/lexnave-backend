import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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
    
    // 1. Limpieza de palabras irrelevantes (stop words) para mejorar la búsqueda
    const stopWords = ["me", "quiero", "tengo", "la", "el", "los", "las", "un", "una", "de", "del", "como", "en", "qué", "que"];
    const palabras = pregunta.toLowerCase().split(" ").filter(p => !stopWords.includes(p) && p.length > 2);
    
    // 2. Formatear para búsqueda flexible (usando OR '|')
    const queryBusqueda = palabras.join(" | ");
    
    // Búsqueda flexible en Supabase
    const { data: articulos, error } = await supabase
      .from("articulos")
      .select("id, numero_articulo, contenido, ley_id")
      .textSearch("contenido", queryBusqueda, {
        type: "websearch",
        config: "spanish"
      })
      .limit(5);
    
    if (error) {
      console.error("❌ Error específico de Supabase:", error);
      return res.json({ respuesta: "Error en base de datos: " + error.message, articulos: [] });
    }
    
    console.log("📊 Artículos devueltos por Supabase:", articulos ? articulos.length : "null");
    
    // Obtener nombres de leyes
    const leyIds = [...new Set((articulos || []).map(a => a.ley_id).filter(id => id))];
    let leyesMap = new Map();
    
    if (leyIds.length > 0) {
      const { data: leyes, error: errorLeyes } = await supabase
        .from("leyes")
        .select("id, nombre")
        .in("id", leyIds);
      
      if (errorLeyes) console.error("❌ Error al obtener leyes:", errorLeyes);
      if (leyes) {
        leyes.forEach(ley => leyesMap.set(ley.id, ley.nombre));
      }
    }
    
    // Formatear resultados
    const resultados = (articulos || []).map(art => ({
      id: art.id,
      numero_articulo: art.numero_articulo,
      contenido: art.contenido,
      ley_id: art.ley_id,
      nombre_ley: leyesMap.get(art.ley_id) || "Ley venezolana"
    }));
    
    console.log(`✅ Procesados ${resultados.length} artículos para enviar a Groq`);
    
    // Generar respuesta con Groq
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
      if (groqData.choices && groqData.choices[0]) {
        respuesta = groqData.choices[0].message.content;
      } else {
        console.error("❌ Error en respuesta de Groq:", groqData);
        respuesta = "⚠️ Hubo un error al generar la respuesta con IA.";
      }
      
      respuesta += "\n\n📖 **Fuentes consultadas:**";
      resultados.slice(0, 3).forEach(art => {
        respuesta += `\n• ${art.nombre_ley} - Art. ${art.numero_articulo}`;
      });
      respuesta += "\n\n---\n⚠️ **LexnaVe es una orientadora legal con IA.** Para tu caso específico, consulta con un profesional del Derecho.";
      
    } else {
      respuesta = "❌ No encontré artículos relacionados en mi base de datos para esa consulta. Intenta con palabras clave más específicas (ej. 'divorcio', 'daño', 'custodia').";
    }
    
    res.json({ respuesta, articulos: resultados });
    
  } catch (error) {
    console.error("❌ Error crítico en backend:", error.message);
    res.status(500).json({ respuesta: `Error interno: ${error.message}`, articulos: [] });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend en puerto ${PORT}`);
});
