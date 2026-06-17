import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
  const promptFiltro = `Evalúa cuáles de estos artículos son útiles para: "${pregunta}". Responde SOLO con un array JSON de IDs. Artículos: ${JSON.stringify(articulosCandidatos, null, 2)}`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    const parsed = safeJsonParse(chatCompletion.choices[0]?.message?.content);
    const ids = Array.isArray(parsed) ? parsed : (parsed.ids || []);
    return ids.length > 0 ? articulosCandidatos.filter(art => ids.includes(art.id)) : [];
  } catch (error) {
    return [];
  }
}

app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;

  try {
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    
    const systemPrompt = `
    Eres "LexnaVe", Abogado Senior experto en Derecho Venezolano. 
    REGLAS:
    1. Arrendamiento Comercial: Seguir estrictamente la Ley de Regulación del Arrendamiento Inmobiliario para el Uso Comercial. No desalojar sin procedimiento administrativo previo ante la SUNVI.
    2. Títulos Valores: El pagaré es título ejecutivo. Se cobra vía Procedimiento de Intimación (Art. 640 CPC).
    3. Rigor Procesal: Citar siempre el artículo exacto (COPP, CPC, CCom).
    4. Prohibido recomendar acciones arbitrarias.
    `;

    const promptFinal = `Contexto: ${JSON.stringify(articulosFiltrados, null, 2)}. Consulta: "${pregunta}"`;

    // LÓGICA DE FALLOVER: 70b -> 8b si hay Rate Limit
    let responseFinal;
    try {
      responseFinal = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3
      });
    } catch (err) {
      console.warn("⚠️ Rate Limit en 70b, intentando con 8b instant...");
      responseFinal = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.3
      });
    }

    res.json({ respuesta: responseFinal.choices[0]?.message?.content });

  } catch (error) {
    console.error("❌ Error final:", error);
    res.status(500).json({ respuesta: "⚠️ Error en el motor LexnaVe. Intente de nuevo." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe activo en puerto ${PORT}`));
