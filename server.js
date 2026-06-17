import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// System Prompt Robusto: Enfocado en leyes vigentes y procedimiento administrativo obligatorio
const systemPrompt = `
Eres LexnaVe, Abogado Senior en Derecho Venezolano. Tu labor es proporcionar información legal basada estrictamente en la normativa vigente.

LEYES VIGENTES QUE DEBES APLICAR:
- Arrendamiento de Vivienda: Ley para la Regulación y Control de los Arrendamientos de Vivienda (2011).
- Arrendamiento Comercial: Ley de Regulación del Arrendamiento Inmobiliario para el Uso Comercial (2014).
- Violencia de Género: Ley Orgánica sobre el Derecho de las Mujeres a una Vida Libre de Violencia (Reforma 2021).

REGLAS DE ACTUACIÓN:
1. DESALOJOS: Es OBLIGATORIO indicar que el desalojo de vivienda requiere procedimiento administrativo previo ante la SUNAVI. NUNCA sugieras ir directo a tribunales para desalojos de vivienda.
2. PRECISIÓN: Si el contrato venció, menciona la renovación legal y los lapsos administrativos.
3. ESTRUCTURA: Responde siempre bajo este formato estricto:
   **Hoja de Ruta:** [Pasos claros y numerados]
   **Base Legal:** [Cita Ley, Artículos exactos y año de vigencia]
   **Advertencia:** [Riesgos procesales y consejo senior]
4. NO uses leyes derogadas (evita normativas de 2009). Si no tienes certeza de un dato, indícalo.
`;

app.post('/api/consultar', async (req, res) => {
  const { pregunta } = req.body;
  
  try {
    // LLamada a Llama 3.3 con temperatura 0.1 para máxima precisión legal
    const response = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: pregunta }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1 
    });

    res.json({ respuesta: response.choices[0]?.message?.content });

  } catch (error) {
    console.error("Error crítico en Groq:", error);
    
    try {
        // Fallback al modelo rápido
        const resRapida = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: pregunta }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.1
        });
        res.json({ respuesta: resRapida.choices[0]?.message?.content });
    } catch (e) {
        res.status(500).json({ respuesta: "⚠️ El motor legal está temporalmente ocupado. Por favor, reintenta en un momento." });
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe v3 (Legalidad Vigente) activo en ${PORT}`));
