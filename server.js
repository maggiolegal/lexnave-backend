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

// Configuración de Supabase con Service Role Key
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

// Función para traducir lenguaje coloquial a términos jurídicos venezolanos
async function traducirATerminosJuridicos(preguntaColoquial) {
  const prompt = `Eres un experto en terminología jurídica venezolana. Tu ÚNICA tarea es convertir preguntas en lenguaje coloquial a 3-5 términos técnicos precisos para búsqueda legal.

REGLAS ESTRICTAS:
1. Devuelve SOLO los términos separados por comas.
2. Sin explicaciones, sin saludos, sin formato markdown.
3. Usa exclusivamente vocabulario del derecho civil, penal, laboral y constitucional venezolano.
4. Si la pregunta ya es técnica, devuélvela igual.

EJEMPLOS:
Input: "me chocaron el carro y se fugó" → Output: accidente tránsito terrestre, delito fuga conductor, responsabilidad civil extracontractual
Input: "compré casa y no me la entregan" → Output: compraventa inmueble, incumplimiento contractual, entrega posesión bien raíz
Input: "mi jefe no me paga" → Output: salario pendiente, lottt, despido injustificado
Input: "que es seguridad de la nacion" → Output: seguridad nacional, defensa integral, constitución república bolivariana

INPUT ACTUAL: "${preguntaColoquial}"
OUTPUT:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1
      })
    });
    
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error(" Error en traducción jurídica:", error);
    return preguntaColoquial;
  }
}

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta original:", pregunta);
    
    // PASO 1: Traducir a términos jurídicos
    const terminosTecnicos = await traducirATerminosJuridicos(pregunta);
    console.log("⚖️ Términos técnicos generados:", terminosTecnicos);
    
    // PASO 2: Generar embedding de los TÉRMINOS TÉCNICOS
    const currentExtractor = await getExtractor();
    const output = await currentExtractor(terminosTecnicos, { pooling: 'mean', normalize: true });
    const queryEmbedding = Array.from(output.data);

    // PASO 3: Buscar en Supabase con umbral reducido (0.1)
    const { data: articulos, error } = await supabase.rpc('match_articulos', {
      query_embedding: queryEmbedding,
      match_threshold: 0.1,
      match_count: 5
    });

    if (error) {
      console.error("❌ Error en RPC match_articulos:", error);
      return res.status(500).json({ respuesta: "Error al buscar en la base legal." });
    }

    const contexto = articulos?.length 
      ? articulos.map((a, i) => `[${i+1}] ${a.leyes?.nombre || 'Ley'} Art. ${a.numero_articulo}: "${a.contenido}"`).join('\n')
      : "No se encontraron artículos relacionados.";

    // PASO 4: Prompt Final con Instrucción Universal de Fallback
    const promptFinal = `Eres LexnaVe, abogada venezolana experta. 

ARTÍCULOS RECUPERADOS DE LA BASE LEGAL:
${contexto}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES DE RESPUESTA:
Analiza los ARTÍCULOS proporcionados. Si son relevantes para la pregunta, úsalos como fuente principal. Si los artículos NO están relacionados con la consulta (ej: la pregunta es sobre seguridad de la nación pero los artículos traídos son de derecho civil o mercantil), ignóralos por completo y responde basándote en tu conocimiento jurídico venezolano general aplicable al tema consultado. En ese caso, inicia tu respuesta aclarando: '⚠️ Nota: según la normativa venezolana vigente...'

REGLAS ADICIONALES:
1. Explica claramente qué dice la ley aplicable.
2. Aplica la ley al caso concreto del usuario.
3. Da pasos prácticos inmediatos.
4. Usa lenguaje sencillo y empático (el usuario NO sabe de leyes).
5. Incluye siempre al final: "⚖️ Esto es orientación general. Consulta con un abogado."`;

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: promptFinal }],
        temperature: 0.2
      })
    });

    const data = await groqRes.json();
    res.json({ respuesta: data.choices[0].message.content });

  } catch (error) {
    console.error("❌ Error crítico:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 LexnaVe v20.0 activo en puerto ${PORT}`));
