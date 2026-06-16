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

// ✅ CLASIFICADOR MEJORADO CON EJEMPLOS DE CIVIL VS COMERCIO
async function clasificarMateriaLegal(preguntaColoquial) {
  const prompt = `Eres un experto en derecho venezolano. Clasifica la pregunta y devuelve SOLO JSON:
{
  "ley_id": (1=CRBV, 2=LPH, 3=Civil, 4=Comercio, 5=COPPP, 6=Penal, 7=CPC, 8=LOTTT),
  "articulo_num": (Número si se menciona, sino null),
  "text_keywords": ["palabra1", "palabra2"] (Términos legales presentes en la ley)
}

REGLAS CRÍTICAS:
- Compraventa de carros/casas entre particulares = CIVIL (3).
- Letras de cambio, cheques, quiebras = COMERCIO (4).
- Despidos, prestaciones = LABORAL (8).
- Herencias, divorcios, daños civiles = CIVIL (3).

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
    console.error("Error en Groq:", error);
    return { ley_id: 3, articulo_num: null, text_keywords: [] }; 
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

    const clasificacion = await clasificarMateriaLegal(pregunta);
    console.log("⚖️ Clasificación:", clasificacion);

    let articulos = [];
    const { ley_id, articulo_num, text_keywords = [] } = clasificacion;

    // 1. Búsqueda Exacta
    if (articulo_num && ley_id) {
      const { data } = await supabase.from('articulos')
        .select('*, leyes(nombre)')
        .eq('numero_articulo', articulo_num.toString())
        .eq('ley_id', ley_id)
        .limit(1);
      if (data && data.length > 0) articulos = data;
    }

    // 2. Búsqueda Semántica Filtrada
    if (articulos.length === 0) {
      const currentExtractor = await getExtractor();
      const output = await currentExtractor(pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      const { data, error } = await supabase.rpc('match_articulos', { 
        query_embedding: queryEmbedding, 
        match_threshold: 0.15, 
        match_count: 5,
        filter_ley_id: ley_id 
      });
      
      if (!error && data && data.length > 0) {
        articulos = data;
        console.log(`✅ Semántica encontró ${articulos.length} artículos.`);
      } else {
        console.log(`⚠️ Semántica falló. Intentando Fallback Textual en contenido_enriquecido...`);
        
        // 3. Fallback Textual AGRESIVO en contenido_enriquecido
        const allKeywords = [...new Set([...text_keywords, ...pregunta.split(' ').filter(w => w.length > 4)])];
        
        if (allKeywords.length > 0) {
          // Buscamos específicamente en contenido_enriquecido que es donde están las etiquetas
          const orQuery = allKeywords.map(k => `contenido_enriquecido.ilike.%${k}%`).join(',');
          
          const { data: textData } = await supabase.from('articulos')
            .select('*, leyes(nombre)')
            .eq('ley_id', ley_id)
            .or(orQuery)
            .limit(3);
            
          if (textData && textData.length > 0) {
            articulos = textData;
            console.log(`✅ Fallback textual encontró ${articulos.length} artículos.`);
          } else {
             console.log(`❌ Fallback textual falló. Probando emergencia sin filtro de ley...`);
             
             // 4. EMERGENCIA: Buscar en todas las leyes
             const { data: emergencyData } = await supabase.from('articulos')
                .select('*, leyes(nombre)')
                .or(orQuery)
                .limit(3);
                
             if (emergencyData && emergencyData.length > 0) {
                 console.log("🚨 EMERGENCIA: Artículos encontrados en otras leyes:", emergencyData.map(a => `${a.leyes.nombre} Art. ${a.numero_articulo}`));
                 articulos = emergencyData; // Usamos estos aunque sean de otra ley para no dejar vacío
             }
          }
        }
      }
    }

    const contextoArticulos = articulos.length > 0
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n\n')
      : "No se encontraron artículos específicos.";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática.
ARTÍCULOS RECUPERADOS:
${contextoArticulos}
PREGUNTA: "${pregunta}"
INSTRUCCIONES: Cita y explica. Si no hay artículos, dilo con empatía.`;

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
app.listen(PORT, () => console.log(`🚀 LexnaVe v31.0 (Enriched Search) activo en puerto ${PORT}`));
