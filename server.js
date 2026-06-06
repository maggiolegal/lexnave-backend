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
  res.json({ message: 'LexnaVe Backend v13.0 - Traductor sin reglas', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta original:", pregunta);
    
    // PASO 1: Groq traduce CUALQUIER pregunta a términos jurídicos (sin reglas fijas)
    const traductorPrompt = `Eres un traductor legal venezolano. Convierte la pregunta cotidiana del usuario a términos jurídicos precisos.

PREGUNTA: "${pregunta}"

INSTRUCCIONES:
- Analiza el SIGNIFICADO de la pregunta.
- Traduce CADA palabra cotidiana a su equivalente legal.
- No uses reglas fijas. Interpreta libremente.
- Devuelve SOLO la frase traducida, sin explicaciones.

RESPUESTA:`;

    const groqTraductor = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: traductorPrompt }],
        temperature: 0.1
      })
    });
    
    const traductorData = await groqTraductor.json();
    let preguntaTraducida = traductorData.choices?.[0]?.message?.content || pregunta;
    console.log("📝 Pregunta traducida:", preguntaTraducida);
    
    // PASO 2: Extraer palabras clave
    const stopWords = ["que", "como", "para", "por", "con", "sin", "una", "me", "te", "le", "lo", "la", "el", "los", "las", "mi", "tu", "su", "y", "o", "pero", "mas", "a", "ante", "bajo", "cabe", "contra", "de", "desde", "durante", "en", "entre", "hacia", "hasta", "mediante", "segun", "so", "sobre", "tras", "versus", "via", "dice", "dijo", "hace", "hizo", "puede", "debe", "hago", "hacen", "hacer", "quiere", "quiero", "tiene", "tener", "sea", "ser", "esta", "este", "esto", "estos", "estas", "esa", "ese", "eso", "esos", "esas"];
    
    let palabras = preguntaTraducida.toLowerCase()
      .replace(/[¿?¡!.,;:()]/g, '')
      .split(/\s+/)
      .filter(p => p.length > 3 && !stopWords.includes(p))
      .slice(0, 10);
    
    if (palabras.length === 0) {
      palabras = ["ley", "derecho", "norma"];
    }
    
    console.log("🔑 Palabras clave:", palabras);
    
    // PASO 3: Buscar en Supabase
    let query = supabase
      .from("articulos")
      .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
    
    for (const p of palabras) {
      query = query.or(`contenido.ilike.%${p}%`);
    }
    
    const { data: articulosEncontrados, error } = await query.limit(10);
    
    if (error || !articulosEncontrados || articulosEncontrados.length === 0) {
      return res.json({ respuesta: "No encontré artículos relacionados. Intenta con otras palabras o consulta a un abogado." });
    }
    
    // PASO 4: Generar respuesta
    const articulos = articulosEncontrados.slice(0, 6).map(a => ({
      ...a,
      nombre_ley: a.leyes?.nombre || "Ley venezolana"
    }));
    
    let contexto = "";
    articulos.forEach((art, idx) => {
      contexto += `\n[${idx + 1}] ${art.nombre_ley}\nArtículo ${art.numero_articulo}: ${art.contenido.substring(0, 800)}\n`;
    });
    
    const promptRespuesta = `Eres LexnaVe, abogada venezolana. Responde basándote ESTRICTAMENTE en estos artículos.

PREGUNTA ORIGINAL: "${pregunta}"
(Pregunta traducida: "${preguntaTraducida}")

ARTÍCULOS ENCONTRADOS:
${contexto}

INSTRUCCIONES:
1. Responde directamente a la pregunta del usuario.
2. Usa lenguaje claro y amigable.
3. Cita los artículos que uses.
4. Da pasos prácticos.
5. Incluye aviso legal.

RESPUESTA:`;

    const groqRespuesta = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: promptRespuesta }],
        temperature: 0.2,
        max_tokens: 1000
      })
    });
    
    const respuestaData = await groqRespuesta.json();
    let respuesta = respuestaData.choices?.[0]?.message?.content || "Error al generar respuesta.";
    
    const fuentes = [...new Set(articulos.map(a => `${a.nombre_ley} Art. ${a.numero_articulo}`))];
    respuesta += "\n\n📚 **Normas consultadas:**\n" + fuentes.map(f => `• ${f}`).join("\n");
    respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta con un abogado.";
    
    res.json({ respuesta });
    
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v13.0 activo en puerto ${PORT}`));
