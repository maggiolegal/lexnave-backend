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
  res.json({ message: 'LexnaVe Backend v11.0 - Búsqueda libre', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // PASO 1: Extraer posibles palabras clave de la pregunta
    const stopWords = ["que", "como", "para", "por", "con", "sin", "una", "me", "te", "le", "lo", "la", "el", "los", "las", "mi", "tu", "su", "y", "o", "pero", "mas", "a", "ante", "bajo", "cabe", "contra", "de", "desde", "durante", "en", "entre", "hacia", "hasta", "mediante", "segun", "so", "sobre", "tras", "versus", "via", "dice", "dijo", "hace", "hizo", "puede", "debe", "hago", "hacen", "hacer", "quiere", "quiero", "tiene", "tener", "sea", "ser", "esta", "este", "esto", "estos", "estas", "esa", "ese", "eso", "esos", "esas"];
    
    let palabras = pregunta.toLowerCase()
      .replace(/[¿?¡!.,;:()]/g, '')
      .split(/\s+/)
      .filter(p => p.length > 3 && !stopWords.includes(p))
      .slice(0, 8);
    
    // Si no hay palabras, usar términos genéricos
    if (palabras.length === 0) {
      palabras = ["ley", "derecho", "norma"];
    }
    
    console.log("🔑 Palabras clave:", palabras);
    
    // PASO 2: Buscar en Supabase usando OR con ilike
    let query = supabase
      .from("articulos")
      .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
    
    for (const p of palabras) {
      query = query.or(`contenido.ilike.%${p}%`);
    }
    
    const { data: articulosEncontrados, error } = await query.limit(10);
    
    if (error) {
      console.error("Error en búsqueda:", error);
      return res.json({ respuesta: "Error en la búsqueda. Intenta nuevamente." });
    }
    
    console.log(`📊 Artículos encontrados: ${articulosEncontrados?.length || 0}`);
    
    if (!articulosEncontrados || articulosEncontrados.length === 0) {
      return res.json({ respuesta: "No encontré artículos relacionados con tu consulta. Intenta con otras palabras o pregunta por un artículo específico (ej: 'artículo 1185 del código civil')." });
    }
    
    // PASO 3: Construir contexto para Groq
    const articulos = articulosEncontrados.slice(0, 6).map(a => ({
      ...a,
      nombre_ley: a.leyes?.nombre || "Ley venezolana"
    }));
    
    let contexto = "";
    articulos.forEach((art, idx) => {
      contexto += `\n[${idx + 1}] ${art.nombre_ley}\nArtículo ${art.numero_articulo}: ${art.contenido.substring(0, 800)}\n`;
    });
    
    const prompt = `Eres LexnaVe, una abogada venezolana experta. Responde basándote ESTRICTAMENTE en los artículos proporcionados.

PREGUNTA DEL USUARIO: "${pregunta}"

ARTÍCULOS ENCONTRADOS (ÚNICA FUENTE VÁLIDA):
${contexto}

INSTRUCCIONES:
1. SOLO usa la información de los artículos mostrados.
2. Si la pregunta es clara, responde directamente basado en los artículos.
3. Cita los artículos que uses.
4. Da pasos prácticos si aplica.
5. Usa lenguaje sencillo y claro.
6. Incluye al final: "⚖️ Esto es una guía informativa. Consulta con un abogado."

RESPUESTA:`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1000
      })
    });
    
    const groqData = await groqRes.json();
    let respuesta = groqData.choices?.[0]?.message?.content || "Error al generar respuesta.";
    
    // Agregar fuentes consultadas
    const fuentes = [...new Set(articulos.map(a => `${a.nombre_ley} Art. ${a.numero_articulo}`))];
    respuesta += "\n\n📚 **Normas consultadas:**\n" + fuentes.map(f => `• ${f}`).join("\n");
    respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta con un abogado.";
    
    res.json({ respuesta });
    
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v11.0 activo en puerto ${PORT}`));
