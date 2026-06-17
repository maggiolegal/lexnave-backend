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
  const promptFiltro = `Actúa como Juez de Admisión. Identifica artículos útiles para: "${pregunta}". Responde SOLO JSON [id1, id2]. Artículos: ${JSON.stringify(articulosCandidatos, null, 2)}`;

  let response;
  try {
    response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
  } catch (error) {
    response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
  }
  const parsed = safeJsonParse(response.choices[0]?.message?.content || "");
  const ids = Array.isArray(parsed) ? parsed : (parsed.ids || []);
  return ids.length > 0 ? articulosCandidatos.filter(art => ids.includes(art.id)) : articulosCandidatos.slice(0, 3);
}

app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;
  
  try {
    // CLASIFICACIÓN ANTI-REPREGUNTA
    const promptClasificacion = `Analiza la consulta. NO pidas datos adicionales. Responde JSON: { "needs_clarification": false, "ley_id": number|null, "legal_intent": string }. Consulta: "${pregunta}"`;
    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    
    // SYSTEM PROMPT DE ESTRATEGA
    const systemPrompt = `
    Eres LexnaVe, Abogado Senior en Derecho Venezolano. Tu respuesta DEBE ser precisa al 100%.
    
    ⚠️ INSTRUCCIÓN DE COMPORTAMIENTO:
    1. PROHIBIDO REPREGUNTAR: No eres un funcionario administrativo. Si faltan datos, asume el escenario más probable y da una respuesta condicional ("Si ocurre A, haz B; si ocurre C, haz D").
    2. RIGOR PROCESAL: 
       - Arrendamiento Vivienda: Agotamiento administrativo SUNAVI (Art. 101 LRCV) es requisito para admisión de demanda de desalojo. El desalojo es excepcional (Art. 91 LRCV). 
       - Intimación (Art. 640 CPC) para cobro de cánones vencidos es vía ejecutiva separada y debe promoverse inmediatamente.
    3. ESTRUCTURA OBLIGATORIA: 
       1. Hoja de Ruta Estratégica (Acciones concretas). 
       2. Fundamento Legal (Artículos específicos). 
       3. Advertencia Legal.
    4. RESPUESTA TÉCNICA: Ve directo al punto, cita el artículo y el lapso. No expliques teorías jurídicas largas.
    `;
    
    const promptFinal = `Contexto legal: ${JSON.stringify(articulosFiltrados)}. Consulta del usuario: "${pregunta}"`;

    let responseFinal;
    let esModeloRapido = false;

    try {
      responseFinal = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.3
      });
    } catch (error) {
      console.warn("⚠️ 70b saturado, usando 8b...");
      esModeloRapido = true;
      responseFinal = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.3
      });
    }

    let respuesta = responseFinal.choices[0]?.message?.content;
    if (esModeloRapido) respuesta += "\n\n--- \n*Nota: Respuesta optimizada para alta velocidad.*";

    res.json({ respuesta });

  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "⚠️ Error en el motor LexnaVe. Reintente." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`));
