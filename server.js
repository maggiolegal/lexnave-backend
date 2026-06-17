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
PROHIBIDO USAR FRASES DE ASISTENTE VIRTUAL. HABLAS COMO UN ABOGADO QUE DEFIENDE A SU CLIENTE EN TRIBUNAL.

INSTRUCCIONES TÉCNICAS (EJECUCIÓN OBLIGATORIA):
1. USO DE ARTÍCULOS: CITA SIEMPRE EL NÚMERO DE ARTÍCULO Y LA LEY. SIN ARTÍCULOS, NO HAY CONSEJO.
2. PROHIBICIÓN DE COACCION: ANTES DE CUALQUIER ACCIÓN, ADVIERTE QUE EL CORTE DE SERVICIOS PÚBLICOS (LUZ, AGUA) ES UN DELITO Y MOTIVO DE ACCIÓN DE AMPARO.
3. VÍA ADMINISTRATIVA: ES UNA CARGA PREVIA. LA SUNAVI TIENE LA COMPETENCIA EXCLUSIVA.
4. ESTRUCTURA DE SALIDA (SIN EXCEPCIONES):
**Hoja de Ruta:** [Usa verbos en imperativo: "NOTIFIQUE", "EXIJA", "SOLICITE". NUNCA "intente" o "deberías".]
**Base Legal:** [Cita jerárquica: CRBV + Ley Especial + Artículos clave]
**Advertencia:** [Riesgo procesal real: habla de "RESPONSABILIDAD CIVIL O PENAL" y "NULIDAD DE ACTOS".]
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
