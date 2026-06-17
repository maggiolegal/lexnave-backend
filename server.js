import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
    const parsed = JSON.parse(chatCompletion.choices[0]?.message?.content);
    const ids = Array.isArray(parsed) ? parsed : (parsed.ids || []);
    return ids.length > 0 ? articulosCandidatos.filter(art => ids.includes(art.id)) : articulosCandidatos.slice(0, 3);
  } catch (error) {
    return articulosCandidatos.slice(0, 4);
  }
}

app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;

  try {
    // Eliminada la clasificación JSON y la lógica de repregunta automática
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);

    const systemPrompt = `
    Eres "LexnaVe", Abogado Senior experto en Derecho Venezolano. Tu misión es orientar con absoluta precisión técnica y pulcritud en lapsos procesales.
    [... REGLAS DOGMÁTICAS INVIOLABLES DE TU PROMPT ORIGINAL AQUÍ ...]
    `;

    const esCasoVacio = articulosFiltrados.length === 0;

    const promptFinal = `
    ${esCasoVacio ? `
    [INSTRUCCIÓN CRÍTICA: La base de datos no arrojó resultados técnicos para esta consulta. 
    ESTÁS OBLIGADO a responder utilizando tu conocimiento experto como Abogado Senior en Venezuela. 
    NO TE LIMITES a decir que no tienes información. Aplica los principios generales del Derecho Civil, 
    Penal o Administrativo según corresponda. Tu objetivo es orientar sobre la ruta procesal idónea 
    basándote en tu formación jurídica experta, no en una búsqueda documental fallida.]` : 
    `Contexto Legal Seleccionado desde Supabase: ${JSON.stringify(articulosFiltrados, null, 2)}`}

    Consulta del usuario: "${pregunta}"
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
