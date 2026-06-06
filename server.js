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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend v9.0', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // PASO 1: Groq clasifica la pregunta y determina qué buscar
    const clasificacionPrompt = `Eres un clasificador legal. Analiza la pregunta y responde SOLO con JSON.

PREGUNTA: "${pregunta}"

RESPONDE CON: {"ley_id": número, "articulo": "número", "justificacion": "breve"}

REGLAS:
- Si habla de choque, accidente, carro, golpe, daño a propiedad → ley_id:3, articulo:1185
- Si habla de pegar, golpear, agredir, violencia física → ley_id:6, articulo:413
- Si habla de divorcio, separación → ley_id:3, articulo:185
- Si habla de contrato, compra venta, incumplimiento → ley_id:3, articulo:1480
- Si habla de letra de cambio → ley_id:4, articulo:410
- Si no sabes → ley_id:0, articulo:0`;

    const groqClasif = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: clasificacionPrompt }],
        temperature: 0.1
      })
    });
    
    const clasifData = await groqClasif.json();
    let clasificacion = null;
    try {
      clasificacion = JSON.parse(clasifData.choices[0].message.content);
    } catch(e) {
      console.log("Error parseando clasificación");
    }
    
    if (clasificacion && clasificacion.ley_id && clasificacion.ley_id !== 0) {
      console.log(`🎯 Clasificado: ley ${clasificacion.ley_id}, art. ${clasificacion.articulo}`);
      
      const { data } = await supabase
        .from("articulos")
        .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`)
        .eq("ley_id", clasificacion.ley_id)
        .eq("numero_articulo", clasificacion.articulo)
        .limit(1);
      
      if (data && data.length > 0) {
        const art = data[0];
        const nombreLey = art.leyes?.nombre || "Ley venezolana";
        
        const respuestaPrompt = `Eres LexnaVe, abogada venezolana experta. Responde basándote ÚNICAMENTE en este artículo.

ARTÍCULO:
${nombreLey}
Artículo ${art.numero_articulo}: ${art.contenido}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES:
1. Explica qué dice el artículo de forma clara y sencilla.
2. Aplica el artículo al caso concreto del usuario.
3. Da pasos prácticos que pueda seguir.
4. Usa lenguaje sencillo, como si le hablaras a un amigo.
5. Incluye al final: "⚖️ Esto es una guía informativa. Consulta con un abogado."

RESPUESTA:`;

        const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: respuestaPrompt }],
            temperature: 0.2
          })
        });
        
        const respData = await groqResp.json();
        let respuesta = respData.choices?.[0]?.message?.content || "Error al generar respuesta.";
        respuesta += `\n\n📚 **Normas consultadas:**\n• ${nombreLey} Art. ${art.numero_articulo}`;
        respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta con un abogado.";
        
        return res.json({ respuesta });
      }
    }
    
    // Si no se pudo clasificar
    res.json({ respuesta: "No entendí bien tu consulta. Puedes preguntar por un artículo específico (ej: 'artículo 1185 del código civil') o describir tu caso con palabras como 'accidente', 'divorcio', 'contrato'." });
    
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v9.0 activo en puerto ${PORT}`));
