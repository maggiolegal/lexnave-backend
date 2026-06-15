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

// ✅ PROMPT BLINDADO: Solo permite el formato X | Y
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un motor de indexación legal. NO hables, NO expliques, NO saludes.
Tu ÚNICA salida permitida es este formato exacto: CATEGORIA_DOGMATICA | palabra_clave_1, palabra_clave_2, palabra_clave_3

REGLAS:
1. Si preguntan por un artículo específico (ej: art 1167), la categoría es "articulo_NUMERO_ley" y las palabras son conceptos clave de ese artículo.
2. Las palabras clave deben ser términos simples que aparezcan textualmente en la ley (ej: daño, culpa, pago, entrega).
3. PROHIBIDO cualquier otro texto.

EJEMPLOS:
Input: "me chocaron" → Output: responsabilidad_civil_extracontractual | daño, culpa, reparar, negligencia
Input: "articulo 1167 codigo civil" → Output: articulo_1167_codigo_civil | accion_pauliana, fraude, acreedores, perjuicio
Input: "no me entregan la casa" → Output: obligacion_de_entrega_inmueble | vendedor, comprador, tradicion, posesion

INPUT: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 })
    });
    const data = await res.json();
    let output = data.choices[0].message.content.trim();
    
    // Limpieza de emergencia por si Groq falla
    if (output.includes('|')) {
        output = output.split('|').map(s => s.trim()).join(' | ');
    }
    return output;
  } catch (error) { return preguntaColoquial; }
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

    const terminosTecnicos = await traducirATerminosJuridicos(pregunta);
    console.log("⚖️ Raw Output:", terminosTecnicos);

    // Parseo seguro
    const partes = terminosTecnicos.split('|');
    const categoria = partes[0]?.trim() || "";
    const keywordsRaw = partes[1]?.trim() || "";
    const terminosArray = [categoria, ...keywordsRaw.split(',').map(t => t.trim())].filter(t => t);
    
    let articulos = [];
    const referenciaExacta = terminosArray.find(t => /^articulo_\d+_.+$/.test(t));

    // Búsqueda Exacta
    if (referenciaExacta) {
      const p = referenciaExacta.split('_'); 
      const numArt = p[1];
      const leyRef = p.slice(2).join('_').toLowerCase();
      const mapLeyes = { 'constitucion': 1, 'propiedad_horizontal': 2, 'codigo_civil': 3, 'codigo_comercio': 4, 'coppp': 5, 'codigo_penal': 6, 'codigo_procedimiento_civil': 7, 'lottt': 8 };
      const leyKey = Object.keys(mapLeyes).find(k => leyRef.includes(k));
      const leyId = leyKey ? mapLeyes[leyKey] : null;

      if (leyId) {
        const { data } = await supabase.from('articulos').select('*, leyes(nombre)').eq('numero_articulo', numArt).eq('ley_id', leyId).limit(1);
        if (data && data.length > 0) articulos = data;
      }
    }

    // Búsqueda Semántica + Textual
    if (articulos.length === 0) {
      const currentExtractor = await getExtractor();
      const output = await currentExtractor(keywordsRaw || pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      const { data, error } = await supabase.rpc('match_articulos', { query_embedding: queryEmbedding, match_threshold: 0.15, match_count: 5 });
      
      if (!error && data && data.length > 0) {
        // FILTRO DE COHERENCIA: Si la categoría sugiere una ley específica, filtramos
        const leyPreferida = categoria.includes('civil') ? 3 : categoria.includes('comercio') ? 4 : null;
        
        if (leyPreferida) {
            articulos = data.filter(a => a.ley_id === leyPreferida);
            if (articulos.length === 0) articulos = data; // Fallback si no hay de esa ley
        } else {
            articulos = data;
        }
        console.log(`✅ Semántica encontró ${articulos.length} artículos.`);
      }

      // Fallback Textual con Keywords
      if (articulos.length === 0 && keywordsRaw) {
        const terminosBusqueda = keywordsRaw.split(',').map(t => `contenido_enriquecido.ilike.%${t.trim()}%`).join(',');
        const { data: textData } = await supabase.from('articulos').select('*, leyes(nombre)').or(terminosBusqueda).limit(3);
        if (textData) articulos = textData;
      }
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática.

ARTÍCULOS RECUPERADOS:
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
app.listen(PORT, () => console.log(`🚀 LexnaVe v20.1 activo en puerto ${PORT}`));
