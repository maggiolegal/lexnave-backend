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

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v9.0 activo en puerto ${PORT}`)); modificalo completo con la propuesta que haces
Backend definitivo: Búsqueda libre en Supabase (sin reglas)
bash
cd /media/adminiso/LexnaVeDisk/lexnave-backend && \
cat > server.js << 'EOF'
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
  res.json({ message: 'LexnaVe Backend v16.0 - Búsqueda libre', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // ============================================================
    // PASO 1: Extraer TODAS las palabras de la pregunta (sin reglas)
    // ============================================================
    const palabras = pregunta.toLowerCase()
      .replace(/[¿?¡!.,;:()]/g, '')
      .split(/\s+/)
      .filter(p => p.length > 2);  // Solo palabras con más de 2 letras
    
    if (palabras.length === 0) {
      return res.json({ respuesta: "No entendí tu consulta. Intenta con más palabras." });
    }
    
    console.log("🔑 Palabras a buscar:", palabras);
    
    // ============================================================
    // PASO 2: Buscar TODAS las palabras en TODOS los artículos
    // ============================================================
    let query = supabase
      .from("articulos")
      .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
    
    // Buscar cada palabra en el contenido
    for (const palabra of palabras) {
      query = query.or(`contenido.ilike.%${palabra}%`);
    }
    
    const { data: articulosEncontrados, error } = await query.limit(15);
    
    if (error) {
      console.error("Error en búsqueda:", error);
      return res.json({ respuesta: "Error en la búsqueda. Intenta nuevamente." });
    }
    
    console.log(`📊 Artículos encontrados: ${articulosEncontrados?.length || 0}`);
    
    if (!articulosEncontrados || articulosEncontrados.length === 0) {
      return res.json({ respuesta: "No encontré artículos relacionados con tu consulta. Intenta con otras palabras." });
    }
    
    // ============================================================
    // PASO 3: Calcular relevancia (cuántas palabras coinciden)
    // ============================================================
    const articulosConScore = articulosEncontrados.map(art => {
      let score = 0;
      const contenidoLower = art.contenido.toLowerCase();
      for (const palabra of palabras) {
        if (contenidoLower.includes(palabra)) {
          score++;
        }
      }
      return { ...art, score };
    });
    
    // Ordenar por relevancia (mayor score primero)
    articulosConScore.sort((a, b) => b.score - a.score);
    
    // Tomar los 6 más relevantes
    const articulos = articulosConScore.slice(0, 6).map(a => ({
      ...a,
      nombre_ley: a.leyes?.nombre || "Ley venezolana"
    }));
    
    // ============================================================
    // PASO 4: Groq redacta respuesta basada en los artículos
    // ============================================================
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

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v16.0 activo en puerto ${PORT}`));
