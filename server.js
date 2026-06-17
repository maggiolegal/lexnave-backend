import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Función de utilidad para esperar (sleep)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    Eres "LexnaVe", Abogado Senior experto en Derecho Venezolano. Tu misión es orientar con absoluta precisión técnica y pulcritud en lapsos procesales.
    
    JERARQUÍA DE ACCIONES OBLIGATORIA:
    1. Ante perturbaciones en áreas comunes o propiedad horizontal: La figura procesal correcta y expedita es el INTERDICTO DE AMPARO (Art. 782 CCV).
    2. Si hay construcción nueva en áreas comunes sin permiso: INTERDICTO DE OBRA NUEVA (Art. 786 CCV).
    3. PROHIBIDO sugerir "Acciones de Demolición" ordinarias para estos casos, ya que son procesos lentos e improcedentes.
    4. Cita siempre la base legal (CCV, LPH, COPP).
    `;

    const esCasoVacio = articulosFiltrados.length === 0;

    const promptFinal = `
    ${esCasoVacio ? `
    [INSTRUCCIÓN CRÍTICA: No se encontraron artículos específicos en base de datos.
    ESTÁS OBLIGADO a responder basándote en tu conocimiento experto como Abogado Senior en Venezuela, 
    siguiendo estrictamente la JERARQUÍA DE ACCIONES definida en tu sistema.]` : 
    `Contexto Legal: ${JSON.stringify(articulosFiltrados, null, 2)}`}

    Consulta: "${pregunta}"
    `;

    // 4. GENERACIÓN CON REINTENTO (SIN DEGRADAR A 8B)
    let responseFinal;
    let intentos = 0;
    const maxIntentos = 2;

    while (intentos < maxIntentos) {
      try {
        responseFinal = await groq.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: promptFinal }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.2
        });
        break; // Éxito
      } catch (innerError) {
        if (innerError.status === 429 && intentos < maxIntentos - 1) {
          intentos++;
          await sleep(5000); // Esperar 5 segundos antes de reintentar
        } else {
          throw innerError;
        }
      }
    }

    if (!responseFinal) {
      return res.status(503).json({ respuesta: "⚠️ El sistema de alta capacidad está saturado. Por favor, reintente en unos segundos." });
    }

    res.json({ respuesta: responseFinal.choices[0]?.message?.content });

  } catch (error) {
    res.status(500).json({ respuesta: "⚠️ Se produjo un error procesal. Por favor, reintente." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`));
