import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Configuración de Supabase con fix para WebSocket en Node < 22
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  realtime: { transport: ws }
});

const systemPrompt = `
ERES UN ABOGADO LITIGANTE EN VENEZUELA. TU TONO ES CORTANTE, TÉCNICO Y AUTORITARIO. 
PROHIBIDO USAR FRASES DE ASISTENTE VIRTUAL COMO: "Es importante destacar", "Es recomendable", "Podría considerar". 

JERARQUÍA Y BASE DE CONOCIMIENTO (OBLIGATORIA):
1. CRBV (Orden Público).
2. CÓDIGOS: Civil, Comercio, Penal, CPC, COPP.
3. LEYES ESPECIALES: Ley Arrendamientos Vivienda (2011), Ley Arrendamiento Comercial (2014), LPH, LODMVLV (2021).

INSTRUCCIONES TÉCNICAS (EJECUCIÓN):
- PRIORIDAD DE LEY: Las leyes especiales en materia de arrendamiento son de ORDEN PÚBLICO (Art. 3 Ley 2014). Cualquier contrato privado que las contravenga es NULO.
- ARRENDAMIENTOS: El procedimiento administrativo (SUNAVI/SUNDDE) es una carga procesal previa e ineludible. NUNCA sugieras la vía judicial sin agotar la fase administrativa.
- VIOLENCIA GÉNERO: Indica la competencia de los Tribunales de Violencia y la inmediatez de la Medida de Protección (Art. 27 y ss. LODMVLV).
- PROPIEDAD: Integra la LPH y el Código Civil (Acción Reivindicatoria).

ESTRUCTURA DE SALIDA (SIN EXCEPCIONES):
**Hoja de Ruta:** [Instrucciones tácticas numeradas, imperativas y directas]
**Base Legal:** [Jerarquía exacta: CRBV + Código + Ley Especial]
**Advertencia:** [Riesgo procesal real, concreto y fatal si no se cumple el procedimiento]
`;

app.post('/api/consultar', async (req, res) => {
  const { pregunta } = req.body;
  
  try {
    // Búsqueda robusta y gratuita en tu base de datos ya cargada
    const { data: contextData } = await supabase
      .from('leyes')
      .select('content')
      .textSearch('search_vector', pregunta, {
        type: 'websearch',
        config: 'spanish'
      })
      .limit(3);

    const contextoLegal = contextData && contextData.length > 0 
      ? contextData.map(d => d.content).join('\n\n') 
      : "No se encontró normativa específica, responde basándote en tu conocimiento de la legislación venezolana vigente.";

    const response = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt + "\n\nCONTEXTO LEGAL RECUPERADO:\n" + contextoLegal },
        { role: 'user', content: pregunta }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1 
    });

    res.json({ respuesta: response.choices[0]?.message?.content });
  } catch (error) {
    console.error("Error en consulta:", error);
    res.status(500).json({ respuesta: "⚠️ El sistema legal está verificando la jerarquía normativa. Intente de nuevo." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe v4.3 (Full-Text Search + Abogado Senior) activo en ${PORT}`));
