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

// Traductor de Intenciones Jurídicas (Anti-Alucinación + Figuras Puras)
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un experto en derecho venezolano. Tu tarea es traducir problemas reales a FIGURAS JURÍDICAS PURAS para búsqueda semántica.

REGLAS DE ORO:
1. SI EL USUARIO MENCIONA UN ARTÍCULO EXPLÍCITO: Devuélvelo como primer término (ej: articulo_410_codigo_comercio).
2. SI NO MENCIONA ARTÍCULOS: ESTÁ PROHIBIDO INVENTAR NÚMEROS. Identifica SOLO las figuras jurídicas aplicables.
3. Usa conceptos legales venezolanos precisos, no descripciones genéricas.
4. Formato estricto: solo términos separados por comas, sin markdown ni explicaciones.

EJEMPLOS CORRECTOS:
Input: "me chocaron el carro y no paga" 
Output: responsabilidad_civil_extracontractual, obligacion_de_reparar_danos, culpa_o_negligencia

Input: "que dice el articulo 1185 del codigo civil"
Output: articulo_1185_codigo_civil, responsabilidad_aquiliana

Input: "juicio oral en proceso penal"
Output: juicio_oral, codigo_organico_procesal_penal, oralidad

INPUT ACTUAL: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ 
        model: "llama-3.1-8b-instant", 
        messages: [{ role: "user", content: prompt }], 
        temperature: 0.0 // Temperatura cero para eliminar creatividad al generar términos
      })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ Error en traducción:", error);
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
    console.log("⚖️ Términos generados:", terminosTecnicos);

    let articulos = [];
    let busquedaExactaFallida = false;
    
    // BÚSQUEDA HÍBRIDA INTELIGENTE
    const terminosArray = terminosTecnicos.split(',').map(t => t.trim());
    const referenciaExacta = terminosArray.find(t => /^articulo_\d+_.+$/.test(t));

    if (referenciaExacta) {
      console.log("🎯 Detección de referencia exacta:", referenciaExacta);
      const partes = referenciaExacta.split('_'); 
      const numArt = partes[1];
      const leyRef = partes.slice(2).join('_').toLowerCase();
      
      // Mapeo flexible con coincidencia parcial
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

    // Fallback semántico mejorado (solo con figuras jurídicas puras)
    if (articulos.length === 0) {
      console.log("🔍 Búsqueda semántica fallback...");
      const terminosLimpios = terminosArray.filter(t => !/^articulo_\d+_.+$/.test(t)).join(', ');
      
      const currentExtractor = await getExtractor();
      const queryEmbedding = Array.from((await currentExtractor(terminosLimpios || pregunta, { pooling: 'mean', normalize: true })).data);

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

    // Prompt Final con Empatía Jurídica y Citación Fundamentada
    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática. Tienes memoria de esta conversación.

ARTÍCULOS LEGALES RECUPERADOS:
${contextoArticulos}

HISTORIAL RECIENTE:
${contextoHistorial}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES DE RESPUESTA:
1. INICIO EMPÁTICO: Si el usuario expone un problema personal, inicia validando su situación ("Lamento el incidente...", "Entiendo tu preocupación...").
2. CITACIÓN FUNDAMENTADA: Cita SIEMPRE el artículo exacto encontrado como base legal. Usa el formato: "el artículo [NÚMERO] del [LEY] establece que [CONTENIDO TEXTUAL O PARAFRASEO FIEL]".
3. EXPLICACIÓN BREVE: Después de citar, da una explicación sintética de cómo aplica al caso o qué significa en lenguaje claro.
4. SI NO HAY ARTÍCULOS RELEVANTES: Inicia con "⚠️ Nota: No se encontraron artículos específicos en la base cargada..." y responde con conocimiento general venezolano.
5. CIERRA SIEMPRE CON: "️ Esto es orientación general. Consulta con un abogado."

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
