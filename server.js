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
  { realtime: { transport: ws } }
);

let extractor = null;
async function getExtractor() {
  if (!extractor) {
    console.log("🧠 Cargando modelo semántico...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("✅ Modelo listo.");
  }
  return extractor;
}

// Traductor Cognitivo Puro (Sin diccionarios)
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un experto en derecho venezolano. Tu ÚNICA tarea es traducir problemas humanos a FIGURAS JURÍDICAS ABSTRACTAS para búsqueda semántica.

REGLAS ABSOLUTAS:
1. SI EL USUARIO MENCIONA UN ARTÍCULO EXPLÍCITO: Devuélvelo como primer término (ej: articulo_410_codigo_comercio).
2. SI NO MENCIONA ARTÍCULOS: ESTÁ PROHIBIDO INVENTAR NÚMEROS. Identifica SOLO la figura jurídica venezolana aplicable.
3. Usa terminología técnica precisa del derecho venezolano.
4. Formato estricto: solo términos separados por comas, sin markdown ni explicaciones.

EJEMPLOS:
Input: "me chocaron el carro y no paga" → Output: responsabilidad_civil_extracontractual, obligacion_de_reparar_danos, culpa_o_negligencia
Input: "que dice el articulo 1185 del codigo civil" → Output: articulo_1185_codigo_civil
Input: "juicio oral en materia civil" → Output: procedimiento_ordinario_civil, promocion_pruebas, oralidad_procesal
Input: "me detuvieron sin orden judicial" → Output: garantias_constitucionales_penales, amparo_constitucional, libertad_personal

INPUT ACTUAL: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ 
        model: "llama-3.1-8b-instant", 
        messages: [{ role: "user", content: prompt }], 
        temperature: 0.0 
      })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ Error en traducción:", error);
    return preguntaColoquial;
  }
}

async function obtenerMemoria(sessionId) {
  if (!sessionId) return [];
  const { data: historial } = await supabase
    .from('chat_history')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(5);
  return historial?.reverse() || [];
}

async function guardarMensaje(sessionId, role, content) {
  if (!sessionId) return;
  await supabase.from('chat_history').insert({ session_id: sessionId, role, content }).then(({ error }) => {
    if (error) console.error("❌ Error guardando mensaje:", error);
  });
}

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta, sessionId } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    await guardarMensaje(sessionId, 'user', pregunta);
    const historial = await obtenerMemoria(sessionId);

    const terminosTecnicos = await traducirATerminosJuridicos(pregunta);
    console.log("⚖️ Términos generados:", terminosTecnicos);

    let articulos = [];
    const terminosArray = terminosTecnicos.split(',').map(t => t.trim());
    const referenciaExacta = terminosArray.find(t => /^articulo_\d+_.+$/.test(t));

    // Búsqueda Exacta Solo Si Hay Referencia Válida
    if (referenciaExacta) {
      console.log("🎯 Referencia exacta detectada:", referenciaExacta);
      const partes = referenciaExacta.split('_'); 
      const numArt = partes[1];
      const leyRef = partes.slice(2).join('_').toLowerCase();
      
      const mapLeyes = { 
        'constitucion': 1, 'propiedad_horizontal': 2, 'codigo_civil': 3, 
        'codigo_comercio': 4, 'coppp': 5, 'codigo_penal': 6, 
        'codigo_procedimiento_civil': 7, 'lottt': 8 
      };
      
      const leyKey = Object.keys(mapLeyes).find(k => leyRef.includes(k) || k.includes(leyRef));
      const leyId = leyKey ? mapLeyes[leyKey] : null;

      if (leyId) {
        const { data } = await supabase
          .from('articulos')
          .select('*, leyes(nombre)')
          .eq('numero_articulo', numArt)
          .eq('ley_id', leyId)
          .limit(1);
        if (data && data.length > 0) articulos = data;
      }
    }

    // Fallback Semántico Puro (Sin expansiones manuales)
    if (articulos.length === 0) {
      console.log(" Búsqueda semántica pura...");
      const terminosLimpios = terminosArray.filter(t => !/^articulo_\d+_.+$/.test(t)).join(', ');
      
      const currentExtractor = await getExtractor();
      const output = await currentExtractor(terminosLimpios || pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      const { data, error } = await supabase.rpc('match_articulos', {
        query_embedding: queryEmbedding, match_threshold: 0.05, match_count: 5
      });
      if (!error && data) articulos = data;
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const contextoHistorial = historial.length > 0
      ? `\nHISTORIAL RECIENTE:\n${historial.map(h => `${h.role}: ${h.content}`).join('\n')}`
      : "";

    // Prompt Final Con Citación Forzada Y Empatía Estructural
    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática. Tienes memoria de esta conversación.

ARTÍCULOS LEGALES RECUPERADOS DE LA BASE DE DATOS:
${contextoArticulos}

HISTORIAL RECIENTE:
${contextoHistorial}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES OBLIGATORIAS DE RESPUESTA:
1. EMPATÍA ESTRUCTURAL: Si el usuario expone un problema personal, inicia SIEMPRE con "Lamento el incidente por el que estás pasando..." o "Entiendo tu preocupación...".
2. CITACIÓN FORZADA: SI LOS ARTÍCULOS RECUPERADOS SON RELEVANTES, DEBES CITAR AL MENOS UNO TEXTUALMENTE usando este formato exacto: "El artículo [NÚMERO] del [LEY] establece que [CONTENIDO TEXTUAL]". La cita debe ser la base de tu respuesta.
3. EXPLICACIÓN APLICADA: Después de citar, explica brevemente cómo aplica al caso en lenguaje claro y accesible.
4. SIN ARTÍCULOS RELEVANTES: Si el contexto dice "No se encontraron...", inicia con "⚠️ Nota: No se encontraron artículos específicos en la base cargada..." y responde con conocimiento general venezolano, pero ACLARA que no hay fundamento en la base verificada.
5. CIERRE ÉTICO OBLIGATORIO: Termina siempre con "⚖️ Esto es orientación general. Consulta con un abogado."

Usa el historial para mantener coherencia conversacional.`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ 
        model: "llama-3.3-70b-versatile", 
        messages: [{ role: "user", content: promptFinal }], 
        temperature: 0.2 
      })
    });

    const data = await groqRes.json();
    const respuesta = data.choices[0].message.content;

    await guardarMensaje(sessionId, 'assistant', respuesta);
    res.json({ respuesta });

  } catch (error) {
    console.error("❌ Error crítico:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v20.0 activo en puerto ${PORT}`));
