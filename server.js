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

// ✅ CLASIFICADOR CON REGLAS DE CLARIFICACIÓN CORREGIDAS
async function clasificarMateriaLegal(preguntaColoquial, historialReciente) {
  const contextoHistorial = historialReciente.length > 0 
    ? `CONTEXTO PREVIO:\n${historialReciente.map(h => `${h.role}: ${h.content}`).join('\n')}\n`
    : '';

  const prompt = `Eres un experto en derecho venezolano. Clasifica y devuelve SOLO JSON:
{
  "needs_clarification": boolean,
  "clarification_question": string,
  "ley_id": (1=CRBV, 2=LPH, 3=Civil, 4=Comercio, 5=COPPP, 6=Penal, 7=CPC, 8=LOTTT),
  "legal_intent": string,
  "articulo_num": (Número si se menciona, sino null),
  "text_keywords": ["palabra_legal_1", "palabra_legal_2"]
}

REGLAS DE CLARIFICACIÓN ESTRICTAS (SOLO ACTIVAR SI NO HAY CONTEXTO PREVIO QUE LO ACLARE):
1. Si la pregunta es MUY AMBIGUA entre materias (ej: "me deben dinero" sin más contexto) -> Pregunta: "¿Es por préstamo, factura o salario?".
2. Si menciona "choque" sin especificar daños -> Pregunta: "¿Lesiones o daños materiales?".
3. NO preguntar si la pregunta ya tiene términos procesales claros (ej: "juicio breve", "divorcio", "paternidad"). En esos casos, asigna la ley y sigue.

REGLAS DE INTENCIÓN:
- Juicios/Procedimientos -> "procesal_civil" (Ley 7).
- Familia/Paternidad/Divorcio -> "familia" (Ley 3).
- Constitucional/Presidente/Referendo -> "constitucional" (Ley 1).

${contextoHistorial}
PREGUNTA ACTUAL: "${preguntaColoquial}"
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
    return { needs_clarification: false, ley_id: null, legal_intent: 'general', articulo_num: null, text_keywords: [] }; 
  }
}

// ✅ RE-RANKER TRANSVERSAL (El Juez Supremo)
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (articulosCandidatos.length === 0) return [];
  
  const listaParaIA = articulosCandidatos.map((a, i) => `[${i+1}] ${a.leyes?.nombre} Art. ${a.numero_articulo}: "${a.contenido.substring(0, 150)}..."`).join('\n');
  
  const prompt = `Eres la Corte Suprema de Justicia. Selecciona SOLO los artículos estrictamente aplicables a: "${pregunta}".
  CANDIDATOS:
  ${listaParaIA}
  
  TAREA: Devuelve SOLO un array JSON con los índices (ej: [1, 3]). Descarta artículos de leyes incorrectas (ej: Civil para temas Penales). Si ninguno sirve, [].
  OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    let content = data.choices[0].message.content.trim();
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    
    if (start !== -1 && end !== -1) {
      const indices = JSON.parse(content.substring(start, end + 1));
      return indices.map(i => articulosCandidatos[i-1]).filter(a => a !== undefined);
    }
    return [];
  } catch (e) {
    console.error("Error en Re-ranking:", e.message);
    return articulosCandidatos.slice(0, 1); 
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

    const clasificacion = await clasificarMateriaLegal(pregunta, historial);
    console.log("⚖️ Clasificación:", clasificacion);

    if (clasificacion.needs_clarification) {
      const respuestaClarificacion = clasificacion.clarification_question || "¿Podrías especificar un poco más tu consulta legal?";
      await guardarMensaje(safeSessionId, 'assistant', respuestaClarificacion);
      return res.json({ respuesta: respuestaClarificacion, sessionId: safeSessionId, needs_clarification: true });
    }

    let articulosCandidatos = [];
    const { ley_id, articulo_num, text_keywords = [] } = clasificacion;

    // 1. Búsqueda Exacta
    if (articulo_num && ley_id) {
      const { data } = await supabase.from('articulos').select('*, leyes(nombre)').eq('numero_articulo', articulo_num.toString()).eq('ley_id', ley_id).limit(1);
      if (data && data.length > 0) articulosCandidatos = data;
    }

    // 2. Búsqueda Semántica TRANSVERSAL
    if (articulosCandidatos.length === 0) {
      try {
        const currentExtractor = await getExtractor();
        const output = await currentExtractor(pregunta, { pooling: 'mean', normalize: true });
        const queryEmbedding = Array.from(output.data);
        const { data, error } = await supabase.rpc('match_articulos', { query_embedding: queryEmbedding, match_threshold: 0.15, match_count: 10 });
        if (!error && data && data.length > 0) articulosCandidatos = data;
      } catch (e) { console.error("Error semántico:", e); }
    }

    // 3. Búsqueda Textual Agresiva TRANSVERSAL
    if (articulosCandidatos.length === 0 && text_keywords.length > 0) {
      console.log(`⚠️ Semántica falló. Activando Búsqueda Textual Agresiva Transversal...`);
      const orConditions = text_keywords.flatMap(k => [`contenido.ilike.%${k}%`, `contenido_enriquecido.ilike.%${k}%`]);
      const { data: textData } = await supabase.from('articulos').select('*, leyes(nombre)').or(orConditions.join(',')).limit(10);
      if (textData && textData.length > 0) articulosCandidatos = textData;
    }

    // ✅ APLICAR RE-RANKING SUPREMO
    console.log(`🔍 Filtrando ${articulosCandidatos.length} candidatos transversales con IA...`);
    const articulosFinales = await filtrarArticulosRelevantes(pregunta, articulosCandidatos);
    console.log(`✅ Después del filtro supremo quedaron ${articulosFinales.length} artículos.`);

    const contextoArticulos = articulosFinales.length > 0
      ? articulosFinales.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n\n')
      : "NO_HAY_ARTICULOS_ENCONTRADOS";

    const promptFinal = `Eres LexnaVe, abogada litigante venezolana experta.

ARTÍCULOS LEGALES VÁLIDOS Y FILTRADOS:
${contextoArticulos}

CASO DEL CLIENTE: "${pregunta}"

INSTRUCCIONES:
1. SI HAY ARTÍCULOS: ÚSALOS COMO FUNDAMENTO PRINCIPAL. EXPLICA CÓMO APLICAN AL CASO.
2. SI NO HAY ARTÍCULOS: RESPONDE CON ORIENTACIÓN GENERAL BASADA EN TU CONOCIMIENTO LEGAL VENEZOLANO.
3. CIERRE ÉTICO: Termina siempre con "⚖️ Esto es orientación general. Consulta con un abogado."`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.2 })
    });

    const data = await groqRes.json();
    const respuesta = data.choices[0].message.content;
    await guardarMensaje(safeSessionId, 'assistant', respuesta);
    res.json({ respuesta, sessionId: safeSessionId, needs_clarification: false });

  } catch (error) {
    console.error(error);
    res.status(500).json({ respuesta: "Error técnico." });
  }
});

app.get('/api/admin/update-embeddings', async (req, res) => {
  console.log("🚀 Iniciando lote de actualización...");
  try {
    const { data: articulos, error } = await supabase.from('articulos').select('id, contenido_enriquecido').not('contenido_enriquecido', 'is', null).is('embedding', null).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    if (!articulos || articulos.length === 0) return res.json({ msg: "✅ ¡TODO LISTO! No quedan artículos sin vector." });

    const currentExtractor = await getExtractor();
    let countActualizados = 0;
    for (const art of articulos) {
      try {
        const output = await currentExtractor(art.contenido_enriquecido, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data);
        await supabase.from('articulos').update({ embedding: embedding }).eq('id', art.id);
        countActualizados++;
      } catch (err) { console.error(`Error con art ${art.id}:`, err.message); }
    }
    res.json({ msg: `✅ Lote de ${countActualizados} actualizado.`, instruction: "Recarga para continuar." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v48.0 (Strict Clarification Fix) activo en puerto ${PORT}`));
