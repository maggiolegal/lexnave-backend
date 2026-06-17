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

// 🛠️ OPTIMIZACIÓN 1: Ajustamos el prompt de clasificación para evitar alucinaciones de ley_id
async function clasificarMateriaLegal(preguntaColoquial, historialReciente) {
  const contextoHistorial = historialReciente.length > 0 
    ? `CONTEXTO PREVIO:\n${historialReciente.map(h => `${h.role}: ${h.content}`).join('\n')}\n`
    : '';

  const prompt = `Eres un sistema experto en Derecho Venezolano. Tu tarea es clasificar la consulta del usuario.
Devuelve STRICTLY un objeto JSON válido, sin textos adicionales ni bloques de código.

JSON FORMAT:
{
  "needs_clarification": boolean,
  "clarification_question": string,
  "ley_id": (1=CRBV, 2=LPH, 3=Civil, 4=Comercio, 5=COPPP, 6=Penal, 7=CPC, 8=LOTTT, 9=LOPNNA),
  "legal_intent": string,
  "articulo_num": (Número de artículo si se menciona explícitamente, sino null),
  "text_keywords": ["palabra_clave_1", "palabra_clave_2"]
}

REGLAS CRÍTICAS:
- "Inquisición de paternidad" o "Filiación" pertenece al Código Civil (3) o LOPNNA (9). ¡NUNCA Penal o COPPP!
- "Lapso de pruebas", "Contestación", "Fijación de hechos" pertenecen al CPC (7).

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
    if (content.startsWith('```json')) content = content.replace(/
```json|```/g, '');
    return JSON.parse(content);
  } catch (error) { 
    return { needs_clarification: false, ley_id: null, legal_intent: 'general', articulo_num: null, text_keywords: [] }; 
  }
}

// 🛠️ OPTIMIZACIÓN 2: Flexibilizamos el filtro supremo para evitar que borre candidatos válidos
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (articulosCandidatos.length === 0) return [];
  const listaParaIA = articulosCandidatos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido.substring(0, 200)}..."`).join('\n');
  
  const prompt = `Actúas como un filtro de alta precisión jurídica para una base de datos de RAG.
Analiza la pregunta del usuario: "${pregunta}"
Evalúa los siguientes artículos candidatos y selecciona los índices (empezando en 1) de aquellos que guardan relación directa, indirecta o analógica con el tema. No seas excesivamente restrictivo.

CANDIDATOS:
${listaParaIA}

Devuelve SOLO un array JSON con los índices seleccionados, por ejemplo: [1, 2]. Si absolutamente ninguno tiene relación, devuelve [].
OUTPUT:`;

  try {
    const res = await fetch("[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", {
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
    return articulosCandidatos.slice(0, 3); // Fallback: devolvemos los 3 primeros en lugar de 1
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
        const { data, error } = await supabase.rpc('match_articulos', { query_embedding: queryEmbedding, match_threshold: 0.15, match_count: 15 });
        if (!error && data && data.length > 0) articulosCandidatos = data;
      } catch (e) { console.error("Error semántico:", e); }
    }

    // 3. Búsqueda Textual Agresiva TRANSVERSAL
    if (articulosCandidatos.length === 0 && text_keywords.length > 0) {
      console.log(`⚠️ Semántica falló. Activando Búsqueda Textual Agresiva Transversal...`);
      const orConditions = text_keywords.flatMap(k => [`contenido.ilike.%${k}%`, `contenido_enriquecido.ilike.%${k}%`]);
      const { data: textData } = await supabase.from('articulos').select('*, leyes(nombre)').or(orConditions.join(',')).limit(15);
      if (textData && textData.length > 0) articulosCandidatos = textData;
    }

    console.log(`🔍 Filtrando ${articulosCandidatos.length} candidatos transversales con IA...`);
    const articulosFinales = await filtrarArticulosRelevantes(pregunta, articulosCandidatos);
    console.log(`✅ Después del filtro supremo quedaron ${articulosFinales.length} artículos.`);

    const contextoArticulos = articulosFinales.length > 0
      ? articulosFinales.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n\n')
      : "NO_HAY_ARTICULOS_ENCONTRADOS";

    // 🛠️ OPTIMIZACIÓN 3: REINGENIERÍA TOTAL DEL PROMPT FINAL PARA LEXNAVE (SENIOR LAWYER MODE)
    const promptFinal = `Eres LexnaVe, una abogada litigante senior, técnica y profundamente dogmática del derecho procesal y sustantivo venezolano. Tu tono es el de un jurista experimentado de la práctica forense, combinando rigor normativo con análisis estratégico.

ARTÍCULOS RECUPERADOS DE LA BASE DE DATOS:
${contextoArticulos}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES CRÍTICAS DE REDACCIÓN Y CONTENIDO:
1. ESTRUCTURA FORENSE: No respondas con párrafos planos e improvisados. Inicia con una breve introducción conceptual que defina el instituto procesal o sustantivo consultado, explicando por qué es crucial en nuestra práctica jurídica. Organiza el desarrollo usando subtítulos claros e informativos basados en números (ej: "1. El Momento Procesal", "2. El Propósito", etc.).
2. USO NORMATIVO Y CONOCIMIENTO INTERNO ESPECÍFICO:
   - Apóyate decididamente en los artículos recuperados, pero recuerda que eres una experta senior: si la consulta versa sobre lapsos procesales, dinámicas probatorias, juicios específicos (como inquisición de paternidad, juicios orales o acción reivindicatoria) y los artículos de la base de datos son parciales o tangenciales, DEBES recurrir a tu vasto conocimiento interno del Código de Procedimiento Civil (CPC), Código Civil, LOPNNA o jurisprudencia del TSJ (especialmente de las Salas Constitucional y de Casación Civil).
   - Detalla lapsos temporales exactos de forma matemática (por ejemplo, los 15 días de promoción, 3 de oposición, 3 de admisión y 30 de evacuación del procedimiento ordinario civil, haciendo mención expresa a los artículos 388, 392, 396, 397, 398 y 400 del CPC).
   - Si hablas de lapsos, explica siempre la "Regla de Oro": cómo opera el cómputo en base a "días de despacho" según el artículo 197 del CPC.
3. FORMATO VISUAL EXIGIDO (TABLAS MARKDOWN): Cuando la respuesta involucre fases secuenciales, plazos cronológicos estructurados o comparativas complejas (como las fases del lapso probatorio), estás OBLIGADA a diagramar una tabla en formato Markdown con columnas claras (ej: Fase | Duración / Días de Despacho | Propósito Procesal | Fundamento Legal).
4. DINÁMICA DE CONEXIÓN ENTRE INSTITUTOS: Explica cómo se interconectan los conceptos. Por ejemplo, vincula cómo una adecuada "fijación de los hechos" (Art. 389 CPC) purga el proceso, determinando de manera matemática qué es lo que se va a promover y evacuar en el posterior "lapso de pruebas", evitando el desgaste innecesario sobre hechos ya admitidos o pacíficos.
5. CIERRE ÉTICO INVARIABLE: Finaliza tu respuesta en una línea separada, usando estrictamente este formato: "⚖️ Esto es orientación general. Consulta con un abogado."`;

    const groqRes = await fetch("[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.15 }) // Temperatura baja para consistencia jurídica
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
app.listen(PORT, () => console.log(`🚀 LexnaVe v49.0 (Senior Lawyer Mode) activo en puerto ${PORT}`));
