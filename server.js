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
      autoReconnect: false,
      transport: ws
    }
  }
);

// Middleware para validar Token JWT de Supabase Auth
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Token de autenticación requerido." });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: "Token inválido o expirado." });
    }
    
    req.user = user; // Adjuntamos el usuario verificado a la request
    next();
  } catch (err) {
    console.error("Error verificando auth:", err);
    return res.status(500).json({ error: "Error interno verificando autenticación." });
  }
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

// Traductor por Abstracción Dogmática + Palabras Puente Naturales
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un experto en derecho venezolano. Tu tarea es doble:

1. IDENTIFICAR la CATEGORÍA JURÍDICA DOGMÁTICA precisa (ej: responsabilidad_civil_extracontractual).
2. EXTRAER 3-4 PALABRAS CLAVE NATURALES que aparezcan textualmente en los artículos de ley relacionados con este tema (ej: para choque -> daño, culpa, reparar, hecho_ilicito).

REGLAS:
- Formato estricto: CATEGORIA | palabra1, palabra2, palabra3
- Las palabras clave deben ser simples y comunes en el texto legal venezolano.
- Sin explicaciones, sin markdown.

EJEMPLOS:
Input: "me chocaron el carro" → Output: responsabilidad_civil_extracontractual | daño, culpa, reparar, negligencia
Input: "no me entregan la casa" → Output: obligacion_de_entrega | vendedor, comprador, tradicion, posesion, inmueble
Input: "me quiero divorciar" → Output: disolucion_vinculo_matrimonial | divorcio, separacion, matrimonio, conyugal
Input: "letra de cambio no pagada" → Output: titulo_credito_cambiario | letra, endoso, librado, protesto

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

// RUTA PRINCIPAL DE CONSULTA (PROTEGIDA POR AUTH)
app.post('/api/consultar', verifyAuth, async (req, res) => {
  try {
    const { pregunta, sessionId: clientSessionId } = req.body;
    const userId = req.user.id;
    
    // Construir sessionId seguro basado en el usuario autenticado
    const safeSessionId = clientSessionId && clientSessionId.startsWith(`${userId}_`) 
      ? clientSessionId 
      : `${userId}_${crypto.randomUUID().split('-')[0]}`;

    console.log(`📨 [${userId.substring(0,8)}...] Pregunta:`, pregunta);
    
    await guardarMensaje(safeSessionId, 'user', pregunta);
    const historial = await obtenerMemoria(safeSessionId);

    const terminosTecnicos = await traducirATerminosJuridicos(pregunta);
    console.log("⚖️ Términos generados:", terminosTecnicos);

    // Separar categoría dogmática de palabras clave naturales
    const partesRespuesta = terminosTecnicos.split('|');
    const categoriaDogmatica = partesRespuesta[0]?.trim() || "";
    const palabrasClaveRaw = partesRespuesta[1]?.trim() || "";
    
    // Crear array combinado para búsquedas
    const terminosArray = [categoriaDogmatica, ...palabrasClaveRaw.split(',').map(t => t.trim())].filter(t => t);
    
    let articulos = [];
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

    // Fallback Semántico + Fallback Textual Dinámico
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
        console.log("⚠️ Búsqueda semántica falló. Activando fallback textual dinámico...");
        
        const terminosBusqueda = terminosArray
          .filter(t => !/^articulo_\d+/.test(t))
          .map(t => `contenido_enriquecido.ilike.%${t}%`)
          .join(',');

        if (terminosBusqueda) {
          const { data: textData } = await supabase
            .from('articulos')
            .select('*, leyes(nombre)')
            .or(terminosBusqueda)
            .limit(3);
            
          if (textData && textData.length > 0) {
            articulos = textData;
            console.log(`✅ Fallback dinámico encontró ${textData.length} artículos usando: ${terminosArray.join(', ')}`);
          }
        }
      }
    }

    // ⚖️ FILTRO DE RELEVANCIA INTELIGENTE CON PALABRAS PUENTE
    if (articulos.length > 0) {
      const tieneCoincidenciaDogmatica = articulos.some(a => 
        terminosArray.some(t => {
          if (/^articulo_\d+/.test(t)) return false;
          const contenidoLower = a.contenido_enriquecido?.toLowerCase() || '';
          // Busca coincidencia exacta de la palabra clave simple
          return contenidoLower.includes(t.toLowerCase());
        })
      );

      if (!tieneCoincidenciaDogmatica) {
        console.log("⚠️ Sin coincidencia dogmática. Usando expansión semántica automática...");
        
        const terminosBusqueda = terminosArray
          .filter(t => !/^articulo_\d+/.test(t))
          .map(t => `contenido_enriquecido.ilike.%${t}%`)
          .join(',');

        if (terminosBusqueda) {
          const { data: textData } = await supabase
            .from('articulos')
            .select('*, leyes(nombre)')
            .or(terminosBusqueda)
            .limit(3);
            
          if (textData && textData.length > 0) {
            articulos = textData; 
            console.log(`✅ Expansión semántica encontró ${textData.length} artículos.`);
          }
        }
      }
    }

    const contextoArticulos = articulos.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos específicos.";

    const contextoHistorial = historial.length > 0
      ? `\nHISTORIAL RECIENTE:\n${historial.map(h => `${h.role}: ${h.content}`).join('\n')}`
      : "";

    const promptFinal = `Eres LexnaVe, abogada venezolana experta y empática. Tienes memoria de esta conversación.

ARTÍCULOS LEGALES RECUPERADOS DE LA BASE DE DATOS (Estos fueron seleccionados por un motor de búsqueda jurídica avanzada):
${contextoArticulos}

HISTORIAL RECIENTE:
${contextoHistorial}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES OBLIGATORIAS DE RESPUESTA (ESTRUCTURA COMBINADA):
1. EMPATÍA ESTRUCTURAL: Inicia SIEMPRE reconociendo el sentimiento del usuario (ej: "Lamento el incidente...", "Entiendo tu preocupación...").
2. FUNDAMENTO LEGAL: Cita AL MENOS UNO de los artículos recuperados TEXTUALMENTE usando este formato: "El artículo [NÚMERO] del [LEY] establece que [CONTENIDO TEXTUAL]".
3. EXPLICACIÓN APLICADA: Después de citar, explica en lenguaje claro y cotidiano cómo ese artículo resuelve o aplica al problema específico del usuario. Conecta la ley con su realidad.
4. CIERRE ÉTICO: Termina siempre con "⚖️ Esto es orientación general. Consulta con un abogado."

NOTA: Si los artículos recuperados son irrelevantes, ignóralos y responde con conocimiento general venezolano, pero mantén la estructura de empatía y cierre ético.`;

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

    await guardarMensaje(safeSessionId, 'assistant', respuesta);
    res.json({ respuesta, sessionId: safeSessionId });

  } catch (error) {
    console.error("❌ Error crítico:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

// RUTA TEMPORAL PARA ACTUALIZAR EMBEDDINGS (Sin Auth para mantenimiento)
app.get('/api/admin/update-embeddings', async (req, res) => {
  console.log("🚀 Verificando estado y procesando lote...");
  try {
    const { count } = await supabase
      .from('articulos')
      .select('*', { count: 'exact', head: true })
      .not('contenido_enriquecido', 'is', null);

    if (count === 0) {
        return res.json({ msg: "✅ ¡TODO LISTO! No quedan artículos por actualizar." });
    }

    const { data: articulos } = await supabase
      .from('articulos')
      .select('id, contenido_enriquecido')
      .not('contenido_enriquecido', 'is', null)
      .limit(50);

    const currentExtractor = await getExtractor();
    let countActualizados = 0;

    for (const art of articulos) {
      const output = await currentExtractor(art.contenido_enriquecido, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);
      
      const { error: updateError } = await supabase
        .from('articulos')
        .update({ embedding: embedding }, { returning: 'minimal' }) 
        .eq('id', art.id);

      if (updateError) {
        console.error(`❌ ERROR AL GUARDAR Art ${art.id}:`, updateError.message);
      } else {
        countActualizados++;
        console.log(`💾 Guardado exitoso Art ${art.id}`);
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
app.listen(PORT, () => console.log(`🚀 LexnaVe v20.0 (Multi-User Auth) activo en puerto ${PORT}`));
