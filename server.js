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
  res.json({ message: 'LexnaVe Backend v15.0 - Traductor + buscador exacto', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // ============================================================
    // PASO 1: Groq traduce y sugiere artículos exactos
    // ============================================================
    const traductorPrompt = `Eres un traductor legal venezolano. Analiza la pregunta y devuelve SOLO JSON.

PREGUNTA: "${pregunta}"

RESPONDE CON ESTE FORMATO JSON:
{
  "terminos_busqueda": "palabras clave para buscar en leyes",
  "ley_sugerida": "nombre de la ley (vacío si no sabes)",
  "articulo_sugerido": "número de artículo (vacío si no sabes)"
}

REGLAS:
- Si la pregunta habla de compra/venta de casa → ley_sugerida: "codigo civil", articulo_sugerido: "1480"
- Si habla de choque/accidente de carro → ley_sugerida: "codigo civil", articulo_sugerido: "1185"
- Si habla de divorcio → ley_sugerida: "codigo civil", articulo_sugerido: "185"
- Si habla de letra de cambio → ley_sugerida: "codigo de comercio", articulo_sugerido: "410"
- Si habla de citación/juicio → ley_sugerida: "codigo de procedimiento civil", articulo_sugerido: ""
- Traduce palabras comunes a términos jurídicos en "terminos_busqueda"

RESPUESTA (SOLO JSON):`;

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
    let traduccion = null;
    try {
      traduccion = JSON.parse(traductorData.choices[0].message.content);
      console.log("📝 Traducción:", traduccion);
    } catch(e) {
      console.log("Error parseando traducción");
      traduccion = { terminos_busqueda: pregunta, ley_sugerida: "", articulo_sugerido: "" };
    }
    
    // ============================================================
    // PASO 2: Buscar artículos en Supabase
    // ============================================================
    let articulosEncontrados = [];
    
    // 2a. Si sugirió un artículo exacto, buscarlo primero
    if (traduccion.articulo_sugerido && traduccion.articulo_sugerido !== "") {
      let leyId = null;
      if (traduccion.ley_sugerida && traduccion.ley_sugerida !== "") {
        for (const [key, id] of Object.entries(MAPEO_LEYES)) {
          if (traduccion.ley_sugerida.toLowerCase().includes(key)) {
            leyId = id;
            break;
          }
        }
      }
      
      let query = supabase
        .from("articulos")
        .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`)
        .eq("numero_articulo", traduccion.articulo_sugerido);
      
      if (leyId) {
        query = query.eq("ley_id", leyId);
      }
      
      const { data } = await query.limit(5);
      if (data && data.length > 0) {
        articulosEncontrados = data;
        console.log(`✅ Artículo exacto encontrado: ${traduccion.articulo_sugerido}`);
      }
    }
    
    // 2b. Si no se encontró artículo exacto, buscar por términos
    if (articulosEncontrados.length === 0 && traduccion.terminos_busqueda) {
      const terminos = traduccion.terminos_busqueda.toLowerCase().split(/\s+/).filter(p => p.length > 3).slice(0, 8);
      console.log("🔑 Buscando por términos:", terminos);
      
      let query = supabase.from("articulos").select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
      for (const term of terminos) {
        query = query.or(`contenido.ilike.%${term}%`);
      }
      
      const { data } = await query.limit(10);
      if (data && data.length > 0) {
        articulosEncontrados = data;
        console.log(`📚 Encontrados ${data.length} artículos por términos`);
      }
    }
    
    if (articulosEncontrados.length === 0) {
      return res.json({ respuesta: "No encontré artículos relacionados con tu consulta. Intenta con otras palabras o pregunta por un artículo específico (ej: 'artículo 1480 del código civil')." });
    }
    
    // ============================================================
    // PASO 3: Groq redacta respuesta basada en los artículos
    // ============================================================
    const articulos = articulosEncontrados.slice(0, 6).map(a => ({
      ...a,
      nombre_ley: a.leyes?.nombre || "Ley venezolana"
    }));
    
    let contexto = "";
    articulos.forEach((art, idx) => {
      contexto += `\n[${idx + 1}] ${art.nombre_ley}\nArtículo ${art.numero_articulo}: ${art.contenido.substring(0, 800)}\n`;
    });
    
    const promptRespuesta = `Eres LexnaVe, una abogada venezolana experta. Responde basándote ESTRICTAMENTE en los artículos proporcionados.

PREGUNTA DEL USUARIO: "${pregunta}"

ARTÍCULOS ENCONTRADOS (ÚNICA FUENTE VÁLIDA):
${contexto}

INSTRUCCIONES:
1. Responde directamente a la pregunta del usuario.
2. Cita los artículos que uses (número y ley).
3. Da pasos prácticos que el usuario pueda seguir.
4. Usa lenguaje claro y amigable (como si hablaras con un amigo).
5. Incluye al final: "⚖️ Esto es una guía informativa. Consulta con un abogado."

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

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v15.0 activo en puerto ${PORT}`));
