import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const LEY_MAP = {
  1: "Constitución de la República Bolivariana de Venezuela",
  2: "Ley de Propiedad Horizontal",
  3: "Código Civil",
  4: "Código de Comercio",
  5: "Código Orgánico Procesal Penal",
  6: "Código Penal",
  7: "Código de Procedimiento Civil"
};

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

async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
  
  const promptFiltro = `
  Actúa como un estricto Juez de Admisión. Evalúa cuáles de los siguientes artículos tienen relación directa con la pregunta: "${pregunta}"
  Artículos: ${JSON.stringify(articulosCandidatos, null, 2)}
  Responde ÚNICAMENTE con un arreglo JSON de IDs. Ejemplo: [1, 3]
  `;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: "json_object" } 
    });
    const parsed = safeJsonParse(chatCompletion.choices[0]?.message?.content);
    const ids = Array.isArray(parsed) ? parsed : (parsed.ids || []);
    return ids.length > 0 ? articulosCandidatos.filter(art => ids.includes(art.id)) : articulosCandidatos.slice(0, 3);
  } catch (error) {
    return articulosCandidatos.slice(0, 4);
  }
}

app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;
  const timestamp = new Date().toISOString();

  try {
    const promptClasificacion = `Analiza la consulta y clasifica en JSON: {"needs_clarification": boolean, "clarification_question": string|null, "ley_id": number|null, "legal_intent": string, "articulo_num": number|null, "text_keywords": array}. Consulta: "${pregunta}"`;
    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);

    if (metadata.needs_clarification && metadata.clarification_question) {
      return res.json({ respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` });
    }

    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);

    const systemPrompt = `
    Eres "LexnaVe", Abogado Senior experto en Derecho Venezolano. Tu misión es orientar con absoluta precisión técnica y pulcritud en lapsos procesales.
    [... REGLAS DOGMÁTICAS INVIOLABLES DE TU PROMPT ORIGINAL AQUÍ ...]
    `;

    // 3. CONSTRUCCIÓN DEL PROMPT CON REFUERZO DE MODO DE FALLO
    const esCasoVacio = articulosFiltrados.length === 0;

    const promptFinal = `
    ${esCasoVacio ? `
    [INSTRUCCIÓN CRÍTICA: La base de datos no arrojó resultados técnicos para esta consulta. 
    ESTÁS OBLIGADO a responder utilizando tu conocimiento experto como Abogado Senior en Venezuela. 
    NO TE LIMITES a decir que no tienes información. Aplica los principios generales del Derecho Civil, 
    Penal o Administrativo según corresponda. Tu objetivo es orientar sobre la ruta procesal idónea 
    basándote en tu formación jurídica experta, no en una búsqueda documental fallida.]` : 
    `Contexto Legal Seleccionado desde Supabase: ${JSON.stringify(articulosFiltrados, null, 2)}`}

    Clasificación Interna: ${JSON.stringify(metadata, null, 2)}
    Consulta: "${pregunta}"
    `;

    // 4. GENERACIÓN CON TOLERANCIA A FALLAS
    let responseFinal;
    try {
      responseFinal = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3
      });
    } catch (innerError) {
      if (innerError.status === 429) {
        responseFinal = await groq.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
          model: 'llama-3.1-8b-instant',
          temperature: 0.3
        });
      } else {
        throw innerError;
      }
    }

    res.json({ respuesta: responseFinal.choices[0]?.message?.content });

  } catch (error) {
    res.status(500).json({ respuesta: "⚠️ Se produjo un error procesal. Por favor, reintente." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`));
