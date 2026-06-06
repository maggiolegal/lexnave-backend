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

// Mapeo de nombres de leyes a IDs
const MAPEO_LEYES = {
  'codigo civil': 3, 'civil': 3, 'código civil': 3,
  'codigo de comercio': 4, 'comercio': 4, 'código de comercio': 4,
  'copp': 5, 'codigo organico procesal penal': 5, 'código orgánico procesal penal': 5,
  'codigo penal': 6, 'penal': 6, 'código penal': 6,
  'cpc': 7, 'codigo de procedimiento civil': 7, 'procedimiento civil': 7, 'código de procedimiento civil': 7,
  'constitucion': 1, 'constitución': 1, 'crbv': 1,
  'propiedad horizontal': 2, 'ph': 2
};

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend v14.0 - Con detección de artículos', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // 1. Detectar si es un artículo específico (ej: "artículo 640", "artículo 640 del CPC")
    const regexArt = /art[íi]culo\s+(\d+)(?:\s+(?:del|de la|de)\s+([a-záéíóúñ\s]+))?/i;
    const matchArt = pregunta.match(regexArt);
    
    if (matchArt) {
      const numArt = matchArt[1];
      let leyId = null;
      
      // Si especificó una ley
      if (matchArt[2]) {
        const leyNombre = matchArt[2].toLowerCase().trim();
        for (const [key, id] of Object.entries(MAPEO_LEYES)) {
          if (leyNombre.includes(key)) {
            leyId = id;
            break;
          }
        }
      }
      
      // Buscar el artículo
      let query = supabase
        .from("articulos")
        .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`)
        .eq("numero_articulo", numArt);
      
      if (leyId) {
        query = query.eq("ley_id", leyId);
      }
      
      const { data } = await query.limit(3);
      
      if (data && data.length > 0) {
        const art = data[0];
        const nombreLey = art.leyes?.nombre || "Ley venezolana";
        
        const respuestaPrompt = `Eres LexnaVe, abogada venezolana. Responde basándote ÚNICAMENTE en este artículo.

ARTÍCULO:
${nombreLey}
Artículo ${art.numero_articulo}: ${art.contenido}

PREGUNTA: "${pregunta}"

RESPUESTA: Explica qué dice el artículo, aplícalo al caso, da pasos prácticos.`;

        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: respuestaPrompt }], temperature: 0.2 })
        });
        
        const groqData = await groqRes.json();
        let respuesta = groqData.choices?.[0]?.message?.content || "Error al generar respuesta.";
        respuesta += `\n\n📚 **Normas consultadas:**\n• ${nombreLey} Art. ${art.numero_articulo}`;
        respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta con un abogado.";
        
        return res.json({ respuesta });
      }
    }
    
    // 2. Si no es artículo específico, traducir y buscar por palabras clave
    const traductorPrompt = `Eres un traductor legal venezolano. Convierte la pregunta a términos jurídicos.

PREGUNTA: "${pregunta}"

INSTRUCCIONES:
- Analiza el SIGNIFICADO.
- Traduce palabras cotidianas a su equivalente legal.
- No uses reglas fijas. Interpreta libremente.
- Devuelve SOLO la frase traducida.

RESPUESTA:`;

    const groqTraductor = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: traductorPrompt }], temperature: 0.1 })
    });
    
    const traductorData = await groqTraductor.json();
    let preguntaTraducida = traductorData.choices?.[0]?.message?.content || pregunta;
    console.log("📝 Traducida:", preguntaTraducida);
    
    // Extraer palabras clave
    const stopWords = ["que", "como", "para", "por", "con", "sin", "una", "me", "te", "le", "lo", "la", "el", "los", "las", "mi", "tu", "su", "y", "o", "pero", "mas", "a", "ante", "bajo", "cabe", "contra", "de", "desde", "durante", "en", "entre", "hacia", "hasta", "mediante", "segun", "so", "sobre", "tras", "versus", "via", "dice", "dijo", "hace", "hizo", "puede", "debe", "hago", "hacen", "hacer", "quiere", "quiero", "tiene", "tener", "sea", "ser", "esta", "este", "esto", "estos", "estas", "esa", "ese", "eso", "esos", "esas"];
    
    let palabras = preguntaTraducida.toLowerCase()
      .replace(/[¿?¡!.,;:()]/g, '')
      .split(/\s+/)
      .filter(p => p.length > 3 && !stopWords.includes(p))
      .slice(0, 10);
    
    if (palabras.length === 0) {
      palabras = ["ley", "derecho"];
    }
    
    console.log("🔑 Palabras:", palabras);
    
    // Buscar en Supabase
    let query = supabase.from("articulos").select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
    for (const p of palabras) {
      query = query.or(`contenido.ilike.%${p}%`);
    }
    
    const { data: articulosEncontrados } = await query.limit(10);
    
    if (!articulosEncontrados || articulosEncontrados.length === 0) {
      return res.json({ respuesta: "No encontré artículos relacionados. Intenta con otras palabras o pregunta por un artículo específico (ej: 'artículo 640 del CPC')." });
    }
    
    // Generar respuesta
    const articulos = articulosEncontrados.slice(0, 6).map(a => ({ ...a, nombre_ley: a.leyes?.nombre || "Ley" }));
    let contexto = "";
    articulos.forEach((art, idx) => {
      contexto += `\n[${idx + 1}] ${art.nombre_ley}\nArtículo ${art.numero_articulo}: ${art.contenido.substring(0, 800)}\n`;
    });
    
    const promptRespuesta = `Eres LexnaVe, abogada venezolana. Responde basándote en estos artículos.

PREGUNTA: "${pregunta}"
TRADUCIDA: "${preguntaTraducida}"

ARTÍCULOS:
${contexto}

RESPUESTA: Responde directamente, cita los artículos, da pasos prácticos, lenguaje claro.`;

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptRespuesta }], temperature: 0.2 })
    });
    
    const respData = await groqResp.json();
    let respuesta = respData.choices?.[0]?.message?.content || "Error.";
    
    const fuentes = [...new Set(articulos.map(a => `${a.nombre_ley} Art. ${a.numero_articulo}`))];
    respuesta += "\n\n📚 **Normas consultadas:**\n" + fuentes.map(f => `• ${f}`).join("\n");
    respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta con un abogado.";
    
    res.json({ respuesta });
    
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v14.0 activo en puerto ${PORT}`));
