import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { pipeline, env } from '@xenova/transformers';
import ws from 'ws'; // ✅ Importación obligatoria para Node.js 20

env.allowLocalModels = false; 
env.useBrowserCache = false;

const app = express();
app.use(cors());
app.use(express.json());

// Cliente Supabase con transporte WebSocket explícito para Node.js 20
const supabase = createClient(
  process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    realtime: {
      autoReconnect: false, // Desactivamos reconexión innecesaria
      transport: ws         // ✅ Inyectamos el constructor de WebSocket
    }
  }
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

// Traductor por Abstracción Dogmática Universal
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un experto en derecho venezolano. Tu ÚNICA tarea es traducir problemas humanos a CATEGORÍAS JURÍDICAS DOGMÁTICAS ESPECÍFICAS.

REGLAS ABSOLUTAS:
1. SI EL USUARIO MENCIONA UN ARTÍCULO EXPLÍCITO: Devuélvelo como primer término (ej: articulo_410_codigo_comercio).
2. SI NO MENCIONA ARTÍCULOS: Identifica LA ETIQUETA DOCTRINARIA MÁS PRECISA Y TÉCNICA aplicable al caso.
3. PROHIBIDO TERMINOLOGÍA GENÉRICA: Nunca usa "daños", "responsabilidad", "incumplimiento" o "delito" solos. Usa SIEMPRE la figura dogmática completa (ej: responsabilidad_civil_extracontractual, nulidad_relativa_contrato, tipo_penal_doloso).
4. Formato estricto: solo términos separados por comas, sin markdown ni explicaciones.

EJEMPLOS DE ABSTRACCIÓN CORRECTA:
Input: "me chocaron el carro y no paga" → Output: responsabilidad_civil_extracontractual, obligacion_de_reparar_danos, culpa_o_negligencia
Input: "mi jefe me botó sin pagar prestaciones" → Output: despido_injustificado, prestaciones_sociales_lottt, indemnizacion_sustitutiva
Input: "firmé un contrato bajo amenaza" → Output: vicio_consentimiento_violencia, nulidad_relativa_contrato, codigo_civil
Input: "me detuvieron sin orden judicial" → Output: garantia_constitucional_libertad_personal, amparo_constitucional, copp_articulo_128

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
    if (error) console.error(" Error guardando mensaje:", error);
  });
}

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta, sessionId } = req.body;
    console.log(" Pregunta:", pregunta);
    
    await guardarMensaje(sessionId, 'user', pregunta);
    const historial = await obtenerMemoria(sessionId);

    const terminosTecnicos = await traducirATerminosJuridicos(pregunta);
    console.log("️ Términos generados:", terminosTecnicos);

    let articulos = [];
    const terminosArray = terminosTecnicos.split(',').map(t => t.trim());
    const referenciaExacta = terminosArray.find(t => /^articulo_\d+_.+$/.test(t));

    // Búsqueda Exacta Solo Si Hay Referencia Válida
    if (referenciaExacta) {
      console.log(" Referencia exacta detectada:", referenciaExacta);
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

    // Fallback Semántico con Umbral Seguro (0.15) + Fallback Textual
    if (articulos.length === 0) {
      console.log("🔍 Búsqueda semántica pura (umbral 0.15)...");
      const terminosLimpios = terminosArray.filter(t => !/^articulo_\d+_.+$/.test(t)).join(', ');
      
      const currentExtractor = await getExtractor();
      const output = await currentExtractor(terminosLimpios || pregunta, { pooling: 'mean', normalize: true });
      const queryEmbedding = Array.from(output.data);

      const { data, error } = await supabase.rpc('match_articulos', {
        query_embedding: queryEmbedding, match_threshold: 0.15, match_count: 5
      });
      
      if (!error && data && data.length > 0) {
        articulos = data;
        console.log(`✅ Encontrados ${data.length} artículos por similitud semántica.`);
      } else {
        console.log("⚠️ Búsqueda semántica no arrojó resultados. Activando fallback textual...");
        
        // 🚀 FALLBACK TEXTUAL: Buscar por etiquetas dogmáticas en contenido_enriquecido
        const { data: textData } = await supabase
          .from('articulos')
          .select('*, leyes(nombre)')
          .ilike('contenido_enriquecido', '%responsabilidad_civil_extracontractual%')
          .eq('ley_id', 3) // Solo Código Civil
          .limit(3);
          
        if (textData && textData.length > 0) {
          articulos = textData;
          console.log(`✅ Fallback textual encontró ${textData.length} artículos relevantes.`);
        }
      }
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const contextoHistorial = historial.length > 0
      ? `\nHISTORIAL RECIENTE:\n${historial.map(h => `${h.role}: ${h.content}`).join('\n')}`
      : "";

    // Prompt Final Con Regla de Rechazo y Citación Forzada
    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática. Tienes memoria de esta conversación.

ARTÍCULOS LEGALES RECUPERADOS DE LA BASE DE DATOS:
${contextoArticulos}

HISTORIAL RECIENTE:
${contextoHistorial}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES OBLIGATORIAS DE RESPUESTA:
1. EMPATÍA ESTRUCTURAL: Si el usuario expone un problema personal, inicia SIEMPRE con "Lamento el incidente por el que estás pasando..." o "Entiendo tu preocupación...".
2. REGLA DE RECHAZO: Analiza los artículos recuperados. SI NO GUARDAN RELACIÓN LÓGICA CON LA PREGUNTA (ej: citas de mandato en un accidente de tránsito), IGNÓRALOS COMPLETAMENTE y declara que no hay fundamentos en la base cargada. NUNCA fuerces una cita irrelevante.
3. CITACIÓN FORZADA: SOLO SI LOS ARTÍCULOS SON RELEVANTES, DEBES CITAR AL MENOS UNO TEXTUALMENTE usando este formato exacto: "El artículo [NÚMERO] del [LEY] establece que [CONTENIDO TEXTUAL]". La cita debe ser la base de tu respuesta.
4. EXPLICACIÓN APLICADA: Después de citar, explica brevemente cómo aplica al caso en lenguaje claro y accesible.
5. SIN ARTÍCULOS RELEVANTES: Inicia con "️ Nota: he analizado el asunto..." y responde con conocimiento general venezolano.

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
    console.error(" Error crítico:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

// RUTA TEMPORAL PARA ACTUALIZAR EMBEDDINGS EN LA NUBE (LOTES DE 50)
app.get('/api/admin/update-embeddings', async (req, res) => {
  console.log(" Verificando estado y procesando lote...");
  try {
    // 1. Contar cuántos faltan por actualizar
    const { count } = await supabase
      .from('articulos')
      .select('*', { count: 'exact', head: true })
      .not('contenido_enriquecido', 'is', null);

    if (count === 0) {
        return res.json({ msg: "✅ ¡TODO LISTO! No quedan artículos por actualizar." });
    }

    // 2. Procesar el lote de 50
    const { data: articulos } = await supabase
      .from('articulos')
      .select('id, contenido_enriquecido')
      .not('contenido_enriquecido', 'is', null)
      .limit(50);

    const currentExtractor = await getExtractor();
    let countActualizados = 0;

    for (const art of articulos) {
      // Generar embedding
      const output = await currentExtractor(art.contenido_enriquecido, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);
      
      // ✅ VERIFICACIÓN DE ERRORES AL GUARDAR CON RETURNING MINIMAL
      const { error: updateError } = await supabase
        .from('articulos')
        .update({ embedding: embedding }, { returning: 'minimal' }) 
        .eq('id', art.id);

      if (updateError) {
        console.error(`❌ ERROR AL GUARDAR Art ${art.id}:`, updateError.message);
      } else {
        countActualizados++;
        console.log(` Guardado exitoso Art ${art.id}`);
      }
    }

    res.json({ 
        msg: `✅ Lote de ${countActualizados} actualizado.`, 
        restantes: count - countActualizados,
        instruction: "Recarga para continuar." 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v20.0 activo en puerto ${PORT}`));
