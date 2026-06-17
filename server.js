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
    // Clasificación
    const promptClasificacion = `Analiza esta consulta legal venezolana y devuelve JSON: { "needs_clarification": boolean, "clarification_question": string|null }. Consulta: "${pregunta}"`;
    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.1-8b-instant', // Usamos 8b para clasificar rápido
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
    if (metadata.needs_clarification) return res.json({ respuesta: `🔍 ${metadata.clarification_question}` });

    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    
    // System Prompt Optimizado
    const systemPrompt = `
    Eres LexnaVe, Abogado Senior en Derecho Venezolano. Tu respuesta DEBE ser precisa al 100%.
    
    REGLAS DE ORO:
    1. PROPIEDAD HORIZONTAL: Fachadas y áreas comunes requieren 100% de aprobación (Art. 5 y 26 LPH). Gastos comunes tienen fuerza ejecutiva (Art. 14 LPH).
    2. COBRO DE PAGARÉS/LETRAS: Usa siempre el Procedimiento de Intimación (Art. 640 CPC). Es rápido y ejecutivo. 
    3. LAPSOS PROCESALES: 
       - Intimación: 10 días de despacho para oponerse.
       - Procedimiento Breve: 10 días para promover y evacuar.
       - Acto Conclusivo (Penal): 6 meses.
       - Impugnación Asamblea: 30 días continuos.
    4. ACCIÓN PRIVADA (Difamación/Injuria): NUNCA envíes a Fiscalía. Acusación Privada directa ante el Tribunal de Juicio.
    5. SI EL MODELO 8B ES UTILIZADO: Sé conciso, directo al punto, cita el artículo y el lapso.
    
    Estructura siempre en: 1. Recomendación Estratégica, 2. Fundamento Legal (Artículo), 3. Advertencia legal final.
    `;
    
    const promptFinal = `Contexto: ${JSON.stringify(articulosFiltrados)}. Consulta: "${pregunta}"`;

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
