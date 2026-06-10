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

// Traductor ANTI-ALUCINACIONES
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un experto en terminología jurídica venezolana. Convierte preguntas coloquiales a términos técnicos para búsqueda legal.

REGLAS CRÍTICAS:
1. SOLO genera términos tipo "articulo_NUMERO_LEY" si estás 100% SEGURO de que ese artículo existe. Si dudas, NO lo incluyas.
2. Para conceptos generales, devuelve 3-5 términos técnicos separados por comas.
3. Usa nombres de ley estandarizados: constitucion, codigo_civil, codigo_comercio, lottt, coppp, codigo_penal, codigo_procedimiento_civil, propiedad_horizontal.
4. Sin explicaciones ni markdown. Solo los términos.

EJEMPLOS:
Input: "que dice el articulo 410 del codigo de comercio" → Output: articulo_410_codigo_comercio, obligaciones mercantiles
Input: "me chocaron el carro" → Output: accidente tránsito terrestre, responsabilidad civil extracontractual
Input: "seguridad de la nacion" → Output: seguridad nacional, defensa integral, constitución

INPUT ACTUAL: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.0 }) // Temperatura 0 para máxima precisión
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error(" Error en traducción:", error);
    return preguntaColoquial;
  }
}

// Gestor de memoria seguro
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
    console.log("⚖️ Términos:", terminosTecnicos);

    let articulos = [];
    let busquedaExactaFallida = false;
    
    // BÚSQUEDA HÍBRIDA INTELIGENTE
    const terminosArray = terminosTecnicos.split(',').map(t => t.trim());
    const referenciaExacta = terminosArray.find(t => /^articulo_\d+_.+$/.test(t));

    if (referenciaExacta) {
      console.log(" Detección de referencia exacta:", referenciaExacta);
      const partes = referenciaExacta.split('_'); 
      const numArt = partes[1];
      const leyRef = partes.slice(2).join('_').toLowerCase();
      
      // Mapeo flexible con coincidencia parcial
      const mapLeyes = { 
        'constitucion': 1, 'propiedad_horizontal': 2, 'codigo_civil': 3, 
        'codigo_comercio': 4, 'coppp': 5, 'codigo_penal': 6, 
        'codigo_procedimiento_civil': 7, 'lottt': 8 
      };
      
      // Buscar coincidencia parcial en las claves del mapa
      const leyKey = Object.keys(mapLeyes).find(k => leyRef.includes(k) || k.includes(leyRef));
      const leyId = leyKey ? mapLeyes[leyKey] : null;

      if (leyId) {
        const { data } = await supabase
          .from('articulos')
          .select('*, leyes(nombre)')
          .eq('numero_articulo', numArt)
          .eq('ley_id', leyId)
          .limit(1);
        if (data && data.length > 0) {
          articulos = data;
        } else {
          busquedaExactaFallida = true;
          console.log("⚠️ Referencia exacta no encontrada en BD. Cayendo a semántica.");
        }
      } else {
        busquedaExactaFallida = true;
        console.log("⚠️ Ley no reconocida en mapeo. Cayendo a semántica.");
      }
    }

    // Fallback semántico mejorado
    if (articulos.length === 0) {
      console.log(" Búsqueda semántica fallback...");
      // Filtrar términos falsos antes de generar embedding
      const terminosLimpios = terminosArray.filter(t => !/^articulo_\d+_.+$/.test(t) || busquedaExactaFallida).join(', ');
      
      const currentExtractor = await getExtractor();
      const output = await currentExtractor(terminosLimpios || pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      const { data, error } = await supabase.rpc('match_articulos', {
        query_embedding: queryEmbedding, match_threshold: 0.05, match_count: 5 // Umbral ultra-bajo para recuperar algo
      });
      if (!error && data) articulos = data;
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const contextoHistorial = historial.length > 0
      ? `\nHISTORIAL RECIENTE:\n${historial.map(h => `${h.role}: ${h.content}`).join('\n')}`
      : "";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta. Tienes memoria de esta conversación.

ARTÍCULOS LEGALES:
${contextoArticulos}
${contextoHistorial}

PREGUNTA ACTUAL: "${pregunta}"

INSTRUCCIONES:
Analiza los ARTÍCULOS proporcionados. Si son relevantes, úsalos como fuente principal CITANDO EL NÚMERO DE ARTÍCULO EXACTO. Si NO están relacionados o están vacíos, responde usando tu conocimiento jurídico venezolano general. En ese caso inicia con: '⚠️ Nota: No se encontraron artículos específicos en la base cargada, pero según la normativa vigente...'

Usa el HISTORIAL para entender referencias contextuales. Responde en lenguaje sencillo, da pasos prácticos y termina siempre con: "⚖️ Esto es orientación general. Consulta con un abogado."`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: promptFinal }], temperature: 0.2 })
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
