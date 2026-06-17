import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import ws from 'ws'; 
import crypto from 'crypto';

env.allowLocalModels = false; 
env.useBrowserCache = false;

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL || "[https://dhcacnfuummsgpxujpjz.supabase.co](https://dhcacnfuummsgpxujpjz.supabase.co)",
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

// Lógica de limpieza ultra-segura para blindar el JSON contra copias corruptas
function limpiarRespuestaJson(textoSucio) {
  let textoClaro = textoSucio.trim();
  // Buscamos la apertura y cierre exactos del JSON
  const posicionApertura = textoClaro.indexOf('{');
  const posicionCierre = textoClaro.lastIndexOf('}');
  
  if (posicionApertura !== -1 && posicionCierre !== -1) {
    return textoClaro.substring(posicionApertura, posicionCierre + 1);
  }
  return textoClaro;
}

// ⚖️ CLASIFICACIÓN OPTIMIZADA
async function clasificarMateriaLegal(preguntaColoquial, historialReciente) {
  const contextoHistorial = historialReciente.length > 0 
    ? `CONTEXTO PREVIO:\n${historialReciente.map(h => `${h.role}: ${h.content}`).join('\n')}\n`
    : '';

  const prompt = `Eres un sistema experto en Derecho Venezolano. Tu tarea es clasificar la consulta del usuario.
Devuelve STRICTLY un objeto JSON valido en una sola linea, sin textos adicionales ni bloques de codigo de markdown.

JSON FORMAT:
{
  "needs_clarification": boolean,
  "clarification_question": string,
  "ley_id": (1=CRBV, 2=LPH, 3=Civil, 4=Comercio, 5=COPPP, 6=Penal, 7=CPC, 8=LOTTT, 9=LOPNNA),
  "legal_intent": string,
  "articulo_num": (Numero de articulo si se menciona explicitamente, sino null),
  "text_keywords": ["palabra_clave_1", "palabra_clave_2"]
}

REGLAS CRITICAS:
- Inquisicion de paternidad o Filiacion pertenece al Codigo Civil (3) o LOPNNA (9). NUNCA Penal o COPPP.
- Lapso de pruebas, Contestacion, Fijacion de hechos pertenecen al CPC (7).

${contextoHistorial}
PREGUNTA ACTUAL: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    const content = limpiarRespuestaJson(data.choices[0].message.content);
    return JSON.parse(content);
  } catch (error) { 
    console.error("Error al parsear clasificacion:", error);
    return { needs_clarification: false, ley_id: null, legal_intent: 'general', articulo_num: null, text_keywords: [] }; 
  }
}

// 🔍 FILTRO SUPREMO FLEXIBILIZADO
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (articulosCandidatos.length === 0) return [];
  const listaParaIA = articulosCandidatos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido.substring(0, 200)}..."`).join('\n');
  
  const prompt = `Actuas como un filtro de alta precision juridica para una base de datos de RAG.
Analiza la pregunta del usuario: "${pregunta}"
Evalua los siguientes articulos candidatos y selecciona los indices (empezando en 1) de aquellos que guardan relacion directa, indirecta o analogica con el tema. No seas excesivamente restrictivo.

CANDIDATOS:
${listaParaIA}

Devuelve SOLO un array JSON con los indices seleccionados, por ejemplo: [1, 2]. Si absolutamente ninguno tiene relacion, devuelve [].
OUTPUT:`;

  try {
    const res = await fetch("[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    let content = data.choices[0].message.content.trim();
    
    const start = content.indexOf('[');
    const end = content.lastIndexOf(']');
    if (start !== -1 && end !== -1) {
      const indices = JSON.parse(content.substring(start, end + 1));
      return indices.map(i => articulosCandidatos[i-1]).filter(a => a !== undefined);
    }
    return [];
  } catch (e) {
    console.error("Error en el filtro supremo:", e);
    return articulosCandidatos.slice(0, 3);
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

// 📥 ENDPOINT PRINCIPAL: CONSULTAR
app.post('/api/consultar', verifyAuth, async (req, res) => {
  try {
    const { pregunta, sessionId: clientSessionId } = req.body;
    const userId = req.user.id;
    const safeSessionId = clientSessionId && clientSessionId.startsWith(`${userId}_`) ? clientSessionId : `${userId}_${crypto.randomUUID().split('-')[0]}`;

    console.log(`📨 [${userId.substring(0,8)}...] Pregunta:`, pregunta);
    await guardarMensaje(safeSessionId, 'user', pregunta);
    const historial = await obtenerMemoria(safeSessionId);

    const clasificacion = await clasificarMateriaLegal(pregunta, historial);
    console.log("⚖️ Clasificacion:", clasificacion);

    if (clasificacion.needs_clarification) {
      const respuestaClarificacion = clasificacion.clarification_question || "¿Podrias especificar un poco mas tu consulta legal?";
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
        const { data, error } = await supabase.rpc('match_articulos', { query_embedding: queryEmbedding, match_threshold: 0.15, match_count: 15 });
        if (!error && data && data.length > 0) articulosCandidatos = data;
      } catch (e) { console.error("Error semantico:", e); }
    }

    // 3. Búsqueda Textual Agresiva TRANSVERSAL
    if (articulosCandidatos.length === 0 && text_keywords.length > 0) {
      console.log(`⚠️ Semantica fallo. Activando Busqueda Textual Agresiva Transversal...`);
      const orConditions = text_keywords.flatMap(k => [`contenido.ilike.%${k}%`, `contenido_enriquecido.ilike.%${k}%`]);
      const { data: textData } = await supabase.from('articulos').select('*, leyes(nombre)').or(orConditions.join(',')).limit(15);
      if (textData && textData.length > 0) articulosCandidatos = textData;
    }

    console.log(`🔍 Filtrando ${articulosCandidatos.length} candidatos transversales con IA...`);
    const articulosFinales = await filtrarArticulosRelevantes(pregunta, articulosCandidatos);
    console.log(`✅ Despues del filtro supremo quedaron ${articulosFinales.length} articulos.`);

    const contextoArticulos = articulosFinales.length > 0
      ? articulosFinales.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n\n')
      : "NO_HAY_ARTICULOS_ENCONTRADOS";

    // 👑 PROMPT FINAL DE LEXNAVE (Senior Lawyer Mode)
    const promptFinal = `Eres LexnaVe, una abogada litigante senior, tecnica y profundamente dogmatica del derecho procesal y sustantivo venezolano. Tu tono es el de un jurista experimentado de la practica forense, combinando rigor normativo con analisis estrategico.

ARTICULOS RECUPERADOS DE LA BASE DE DATOS:
${contextoArticulos}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES CRITICAS DE REDACCION Y CONTENIDO:
1. ESTRUCTURA FORENSE: No respondas con parrafos planos e improvisados. Inicia con una breve introduccion conceptual que defina el instituto procesal o sustantivo consultado, explicando por que es crucial en nuestra practica juridica. Organiza el desarrollo usando subtitulos claros e informativos basados en numeros (ej: "1. El Momento Procesal", "2. El Proposito", etc.).
2. USO NORMATIVO Y CONOCIMIENTO INTERNO ESPECIFICO:
   - Apoyate decididamente en los articulos recuperados, pero recuerda que eres una experta senior: si la consulta versa sobre lapsos procesales, dinamicas probatorias, juicios especificos (como inquisicion de paternidad, juicios orales o accion reivindicatoria) y los articulos de la base de datos son parciales o tangenciales, DEBES recurrir a tu vasto conocimiento interno del Codigo de Procedimiento Civil (CPC), Codigo Civil, LOPNNA o jurisprudencia del TSJ (especialmente de las Salas Constitucional y de Casacion Civil).
   - Detalla lapsos temporales exactos de forma matematica (por ejemplo, los 15 dias de promoc, 3 de oposicion, 3 de admision y 30 de evacuacion del procedimiento ordinario civil, haciendo mencion expresa a los articulos 388, 392, 396, 397, 398 y 400 del CPC).
   - Si hablas de lapsos, explica siempre la "Regla de Oro": como opera el computo en base a "dias de despacho" de conformidad con el articulo 197 del CPC.
3. FORMATO VISUAL EXIGIDO (TABLAS MARKDOWN): Cuando la respuesta involucre fases secuenciales, plazos cronologicos estructurados o comparativas complejas (como las fases del lapso probatorio), estas OBLIGADA a diagramar una tabla en formato Markdown con columnas claras (ej: Fase | Duracion / Dias de Despacho | Proposito Procesal | Fundamento Legal).
4. DINAMICA DE CONEXION ENTRE INSTITUTOS: Explica como se interconectan los conceptos. Por ejemplo, vincula como una adecuada "fijacion de los hechos" (Art. 389 CPC) purga el proceso, determinando de manera matematica que es lo que se va a promover y evacuar en el posterior "lapso de pruebas", evitando el desgaste innecesario sobre hechos ya admitidos o pacificos.
5. CIERRE ETICO INVARIABLE: Finaliza tu respuesta en una linea separada, usando estrictamente este formato: "⚖️ Esto es orientacion general. Consulta con un abogado."`;

    const groqRes = await fetch("[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.15 })
    });

    const data = await groqRes.json();
    const respuesta = data.choices[0].message.content;
    await guardarMensaje(safeSessionId, 'assistant', respuesta);
    res.json({ respuesta, sessionId: safeSessionId, needs_clarification: false });

  } catch (error) {
    console.error(error);
    res.status(500).json({ respuesta: "Error tecnico." });
  }
});

// ⏳ ENDPOINT ADMIN: EMBEDDINGS
app.get('/api/admin/update-embeddings', async (req, res) => {
  console.log("🚀 Iniciando lote de actualizacion...");
  try {
    const { data: articulos, error } = await supabase.from('articulos').select('id, contenido_enriquecido').not('contenido_enriquecido', 'is', null).is('embedding', null).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    if (!articulos || articulos.length === 0) return res.json({ msg: "✅ ¡TODO LISTO! No quedan articulos sin vector." });

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
app.listen(PORT, () => console.log(`🚀 LexnaVe v49.0 (Senior Lawyer Mode) activo en puerto ${PORT}`));
