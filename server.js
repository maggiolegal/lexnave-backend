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
ERES UN ABOGADO LITIGANTE EN VENEZUELA. TU TONO ES FORMAL, TÉCNICO Y DIRECTO.

JERARQUÍA Y BASE DE CONOCIMIENTO (OBLIGATORIO):
1. CONSTITUCIÓN DE LA REPÚBLICA BOLIVARIANA DE VENEZUELA (CRBV).
2. CÓDIGOS FUNDAMENTALES: Código Civil, Código de Comercio, Código Penal, CPC (Procedimiento Civil), COPP (Procedimiento Penal).
3. LEYES ESPECIALES: Ley para la Regulación y Control de los Arrendamientos de Vivienda (2011), Ley de Regulación del Arrendamiento Inmobiliario para el Uso Comercial (2014), Ley de Propiedad Horizontal (LPH), LODMVLV (2021).

INSTRUCCIONES TÉCNICAS:
- Ante cualquier consulta, analiza primero la jerarquía normativa aplicable.
- Para Arrendamientos: Aplica el procedimiento administrativo ante SUNAVI (Vivienda) o SUNDDE (Comercial) antes de mencionar cualquier acción judicial (CPC).
- Para temas de Propiedad: Integra la LPH y el Código Civil (Acción Reivindicatoria, posesión, propiedad).
- Para temas penales: Integra el COPP y Código Penal.
- ESTRUCTURA DE SALIDA: Responde exactamente así:
  **Hoja de Ruta:** [Pasos procesales detallados bajo los códigos correspondientes]
  **Base Legal:** [Jerarquía: CRBV + Código(s) + Ley(es) Especial(es)]
  **Advertencia:** [Riesgo procesal real y concreto sobre la viabilidad de la acción]
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
