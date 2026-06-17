import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// System Prompt Robusto
const systemPrompt = `
Eres LexnaVe, Abogado Senior en Derecho Venezolano. 
REGLAS:
1. No repreguntes.
2. Si el caso es vivienda, menciona SUNAVI (Art. 101 LRCV).
3. Lapsos exactos: Intimación (10 días); Breve (10 días).
4. Diferencia Vía Ejecutiva (Art. 630 CPC) de Intimación (Art. 640 CPC).
5. Estructura: 1. Hoja de Ruta, 2. Base Legal, 3. Advertencia.
`;

app.post('/api/consultar', async (req, res) => {
  const { pregunta } = req.body;
  
  try {
    // LLamada directa sin forzar JSON estricto para evitar error 400
    const response = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: pregunta }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3
    });

    res.json({ respuesta: response.choices[0]?.message?.content });

  } catch (error) {
    console.error("Error crítico:", error);
    // Fallback al modelo rápido si el 70b falla por cualquier motivo
    try {
        const resRapida = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: pregunta }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.3
        });
        res.json({ respuesta: resRapida.choices[0]?.message?.content });
    } catch (e) {
        res.status(500).json({ respuesta: "⚠️ El motor legal está temporalmente ocupado. Reintenta." });
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe v3 (Anti-Error) activo en ${PORT}`));
