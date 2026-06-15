import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import ws from 'ws'; 

env.allowLocalModels = false; 
env.useBrowserCache = false;

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    realtime: { autoReconnect: false, transport: ws }
  }
);

async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: "Token requerido." });
  try {
    const { data: { user }, error } = await supabase.auth.getUser(authHeader.split(' ')[1]);
    if (error || !user) return res.status(401).json({ error: "Token inválido." });
    req.user = user;
    next();
  } catch (err) { res.status(500).json({ error: "Error auth." }); }
}

let extractor = null;
async function getExtractor() {
  if (!extractor) {
    console.log("🧠 Cargando modelo semántico...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("✅ Modelo listo.");
  }
  return extractor;
}

// ✅ CLASIFICADOR DE MATERIA LEGAL (Sin palabras clave manuales)
async function clasificarMateriaLegal(preguntaColoquial) {
  const prompt = `Eres un experto en derecho venezolano. Identifica la MATERIA JURÍDICA principal de la pregunta y devuelve SOLO un objeto JSON:
{
  "ley_id": (1=CRBV, 2=LPH, 3=Civil, 4=Comercio, 5=COPPP, 6=Penal, 7=CPC, 8=LOTTT),
  "articulo_num": (Número si se menciona explícitamente, sino null)
}

REGLAS:
- Analiza el contexto: "letra de cambio" = Comercio(4); "choque/daños" = Civil(3); "despido" = Laboral(8); "herida/golpe" = Penal(6).
- No agregues texto fuera del JSON.

INPUT: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    let content = data.choices[0].message.content.trim();
    if (content.startsWith('```json')) content = content.replace(/```json|```/g, '');
    return JSON.parse(content);
  } catch (error) {
    console.error("Error clasificando materia:", error);
    return { ley_id: 3, articulo_num: null }; // Fallback a Civil
  }
}

async function obtenerMemoria(sessionId) {
  if (!sessionId) return [];
  const { data: historial } = await supabase.from('chat_history').select('role, content').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(5);
  return historial?.reverse() || [];
}

async function guardarMensaje(sessionId, role, content) {
  if (!sessionId) return;
  await supabase.from('chat_history').insert({ session_id: sessionId, role, content });
}

app.post('/api/consultar', verifyAuth, async (req, res) => {
  try {
    const { pregunta, sessionId: clientSessionId } = req.body;
    const userId = req.user.id;
    const safeSessionId = clientSessionId && clientSessionId.startsWith(`${userId}_`) ? clientSessionId : `${userId}_${crypto.randomUUID().split('-')[0]}`;

    console.log(`📨 [${userId.substring(0,8)}...] Pregunta:`, pregunta);
    await guardarMensaje(safeSessionId, 'user', pregunta);
    const historial = await obtenerMemoria(safeSessionId);

    // 1. Clasificación de Materia y Artículo
    const clasificacion = await clasificarMateriaLegal(pregunta);
    console.log("⚖️ Materia detectada:", clasificacion);

    let articulos = [];
    const { ley_id, articulo_num } = clasificacion;

    // 2. Búsqueda Exacta si hay artículo específico
    if (articulo_num && ley_id) {
      const { data } = await supabase.from('articulos')
        .select('*, leyes(nombre)')
        .eq('numero_articulo', articulo_num.toString())
        .eq('ley_id', ley_id)
        .limit(1);
      
      if (data && data.length > 0) {
        articulos = data;
        console.log(`🎯 Artículo exacto encontrado: Art. ${articulo_num} Ley ID ${ley_id}`);
      }
    }

    // 3. Búsqueda Semántica Filtrada por Materia
    if (articulos.length === 0) {
      console.log("🔍 Búsqueda semántica pura...");
      const currentExtractor = await getExtractor();
      const output = await currentExtractor(pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      // Traemos 15 candidatos para asegurar que haya suficientes de la materia correcta
      const { data, error } = await supabase.rpc('match_articulos', { 
        query_embedding: queryEmbedding, 
        match_threshold: 0.15, 
        match_count: 15 
      });
      
      if (!error && data) {
        // FILTRO DE MATERIA EN MEMORIA: La clave del éxito
        const resultadosFiltrados = data.filter(a => a.ley_id === ley_id);
        
        if (resultadosFiltrados.length > 0) {
          articulos = resultadosFiltrados.slice(0, 3);
          console.log(`✅ Semántica encontró ${articulos.length} artículos en Materia ID ${ley_id}.`);
        } else {
          // Si no hay nada de esa materia específica, mostramos los generales
          articulos = data.slice(0, 3);
          console.log(`⚠️ Sin resultados específicos en Materia ID ${ley_id}. Mostrando generales.`);
        }
      }
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática.

ARTÍCULOS RECUPERADOS (Filtrados por materia legal relevante):
${contextoArticulos}

PREGUNTA: "${pregunta}"

INSTRUCCIONES:
1. EMPATÍA: Inicia reconociendo el sentimiento del usuario.
2. CITACIÓN: Cita textualmente al menos un artículo relevante: "El artículo [NUM] del [LEY] establece que [TEXTO]".
3. EXPLICACIÓN: Explica cómo aplica al caso en lenguaje simple.
4. CIERRE: "⚖️ Esto es orientación general. Consulta con un abogado."

Si no hay artículos relevantes, dilo con empatía y da orientación general.`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.2 })
    });

    const data = await groqRes.json();
    const respuesta = data.choices[0].message.content;
    await guardarMensaje(safeSessionId, 'assistant', respuesta);
    res.json({ respuesta, sessionId: safeSessionId });

  } catch (error) {
    console.error(error);
    res.status(500).json({ respuesta: "Error técnico." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v23.0 (Materia Filter) activo en puerto ${PORT}`));
