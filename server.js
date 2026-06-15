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
    console.log("🧠 Cargando modelo...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("✅ Modelo listo.");
  }
  return extractor;
}

// ✅ CLASIFICADOR LEGAL POR JSON (Estándar Profesional)
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un clasificador legal venezolano. Analiza la pregunta y devuelve SOLO un objeto JSON válido con esta estructura:
{
  "ley_id": (Número: 1=Constitución, 2=Propiedad Horizontal, 3=Código Civil, 4=Código Comercio, 5=COPPP, 6=Código Penal, 7=CPC, 8=LOTTT),
  "articulo_num": (Número si se menciona uno específico, sino null),
  "keywords": ["palabra1", "palabra2"] (Términos simples para búsqueda textual)
}

REGLAS:
- Si es un tema general (ej: divorcio, choque), usa la ley principal de ese tema (Civil=3, Penal=6).
- Si se menciona un artículo específico, pon su número en "articulo_num" y la ley correcta en "ley_id".
- NO incluyas texto fuera del JSON.

EJEMPLOS:
Input: "me chocaron" → Output: {"ley_id": 3, "articulo_num": null, "keywords": ["daño", "culpa", "reparar"]}
Input: "articulo 410 comercio" → Output: {"ley_id": 4, "articulo_num": 410, "keywords": ["letra", "cambio"]}
Input: "me quieren despedir" → Output: {"ley_id": 8, "articulo_num": null, "keywords": ["despido", "prestaciones"]}
Input: "me dieron una patada" → Output: {"ley_id": 6, "articulo_num": null, "keywords": ["lesiones", "pena", "dolo"]}

INPUT: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    // Limpieza básica por si Groq añade markdown
    let content = data.choices[0].message.content.trim();
    if (content.startsWith('```json')) content = content.replace(/```json|```/g, '');
    return JSON.parse(content);
  } catch (error) {
    console.error("Error parseando JSON:", error);
    // Fallback seguro a Código Civil
    return { ley_id: 3, articulo_num: null, keywords: [preguntaColoquial] }; 
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

    // Obtener clasificación estructurada
    const clasificacion = await traducirATerminosJuridicos(pregunta);
    console.log("⚖️ Clasificación JSON:", clasificacion);

    let articulos = [];
    const { ley_id, articulo_num, keywords } = clasificacion;

    // 1. Búsqueda Exacta por Artículo (Si aplica)
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

    // 2. Búsqueda Semántica Filtrada por Ley (Metadata Filtering)
    if (articulos.length === 0) {
      const currentExtractor = await getExtractor();
      // Usamos las keywords para generar el embedding, es más preciso que la pregunta completa
      const queryText = keywords.join(' ') || pregunta;
      const output = await currentExtractor(queryText, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      // Llamada RPC estándar (Supabase no permite filtrar por ley dentro de match_articulos fácilmente sin modificar la función SQL)
      // Así que traemos 10 resultados y filtramos en JS para asegurar precisión
      const { data, error } = await supabase.rpc('match_articulos', { 
        query_embedding: queryEmbedding, 
        match_threshold: 0.15, 
        match_count: 15 
      });
      
      if (!error && data) {
        // FILTRO DE METADATOS EN MEMORIA (Precisión Quirúrgica)
        const resultadosFiltrados = data.filter(a => a.ley_id === ley_id);
        
        if (resultadosFiltrados.length > 0) {
          articulos = resultadosFiltrados.slice(0, 3);
          console.log(`✅ Semántica filtrada por Ley ID ${ley_id}: ${articulos.length} artículos.`);
        } else {
          // Si no hay nada de esa ley específica, mostramos los top 3 generales pero avisamos
          articulos = data.slice(0, 3);
          console.log(`⚠️ No se encontraron resultados en Ley ID ${ley_id}. Mostrando generales.`);
        }
      }

      // 3. Fallback Textual con Keywords (Solo dentro de la ley correcta)
      if (articulos.length === 0 && keywords.length > 0) {
        const terminosBusqueda = keywords.map(t => `contenido_enriquecido.ilike.%${t}%`).join(',');
        const { data: textData } = await supabase.from('articulos')
          .select('*, leyes(nombre)')
          .eq('ley_id', ley_id) // Forzamos la ley aquí también
          .or(terminosBusqueda)
          .limit(3);
        
        if (textData && textData.length > 0) {
          articulos = textData;
          console.log(`✅ Fallback textual encontró artículos en Ley ID ${ley_id}.`);
        }
      }
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática.

ARTÍCULOS RECUPERADOS (Filtrados por relevancia legal):
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
app.listen(PORT, () => console.log(`🚀 LexnaVe v21.0 (JSON Classifier) activo en puerto ${PORT}`));
