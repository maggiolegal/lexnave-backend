import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * ROBUSTEZ TÉCNICA: Limpia y parsea JSON generados por LLMs
 */
function safeJsonParse(rawText) {
  try {
    return JSON.parse(rawText.trim());
  } catch (e) {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0].trim());
      } catch (innerError) {
        throw new Error(`Imposible parsear JSON: ${innerError.message}`);
      }
    }
    throw e;
  }
}

/**
 * FILTRO SUPREMO: Selección de normativa relevante
 */
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
  const promptFiltro = `
  Actúa como un estricto Juez de Admisión. Evalúa cuáles de los artículos proporcionados tienen relación directa con la pregunta: "${pregunta}".
  Artículos: ${JSON.stringify(articulosCandidatos, null, 2)}
  Responde ÚNICAMENTE con un arreglo JSON de los IDs admitidos. No agregues texto extra.
  Ejemplo: [1, 3, 7]
  `;

  try {
    const chat = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    const ids = safeJsonParse(chat.choices[0]?.message?.content);
    const idList = Array.isArray(ids) ? ids : (ids.ids || []);
    return articulosCandidatos.filter(art => idList.includes(art.id));
  } catch (e) {
    return articulosCandidatos.slice(0, 3);
  }
}

/**
 * ENDPOINT PRINCIPAL
 */
app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;

  try {
    // 1. Clasificación
    const promptClasificacion = `Analiza la consulta y devuelve un JSON: {"needs_clarification": boolean, "clarification_question": string|null, "legal_intent": string}. Consulta: "${pregunta}"`;
    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);

    if (metadata.needs_clarification) {
      return res.json({ respuesta: `🔍 ${metadata.clarification_question}` });
    }

    // 2. Filtro
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);

    // 3. System Prompt (Configuración de LexnaVe)
    const systemPrompt = `
    Eres LexnaVe, Abogado Senior experto en Derecho Venezolano.
    TU MISIÓN: Orientar al ciudadano con precisión técnica, tono firme y profesional.
    
    REGLAS DE ORO:
    - Responde ÚNICAMENTE usando la estructura indicada abajo.
    - NO añadas introducciones, despedidas ni comentarios fuera de las secciones.
    - SIEMPRE cita artículos y leyes.
    - Si el contexto (RAG) es insuficiente, usa tu conocimiento experto en leyes venezolanas vigentes.
    - NUNCA sugieras cortes de servicios públicos (delito).
    
    ESTRUCTURA OBLIGATORIA:
    **Hoja de Ruta:** [Instrucciones imperativas: "NOTIFIQUE", "EXIJA", "SOLICITE".]
    **Base Legal:** [Cita jerárquica de normas venezolanas y artículos clave.]
    **Advertencia:** [Riesgo procesal real: "RESPONSABILIDAD CIVIL O PENAL" y "NULIDAD DE ACTOS".]
    `;

    // 4. Generación final
    const responseFinal = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Contexto Legal: ${JSON.stringify(articulosFiltrados)}\n\nConsulta: "${pregunta}"` }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3
    });

    res.json({ respuesta: responseFinal.choices[0]?.message?.content });

  } catch (error) {
    console.error("Error en flujo:", error);
    res.status(500).json({ respuesta: "⚠️ Error procesal en el servidor. Intente de nuevo." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe v4.3 activo en ${PORT}`));
