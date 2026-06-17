import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
- ESTRUCTURA DE SALIDA (JSON ESTRICTO):
  **Hoja de Ruta:** [Pasos procesales detallados bajo los códigos correspondientes]
  **Base Legal:** [Jerarquía: CRBV + Código(s) + Ley(es) Especial(es)]
  **Advertencia:** [Riesgo procesal real y concreto sobre la viabilidad de la acción]
`;

app.post('/api/consultar', async (req, res) => {
  const { pregunta } = req.body;
  
  try {
    // Buscar contexto en Supabase en todas las tablas de leyes/códigos
    const { data: contextData } = await supabase.rpc('match_leyes', {
      query_embedding: await obtenerEmbedding(pregunta), 
      match_threshold: 0.7,
      match_count: 5 // Aumentado para mayor cobertura de códigos
    });

    const contextoLegal = contextData ? contextData.map(d => d.content).join('\n') : "";

    const response = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt + "\nCONTEXTO LEGAL INTEGRAL:\n" + contextoLegal },
        { role: 'user', content: pregunta }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1 
    });

    res.json({ respuesta: response.choices[0]?.message?.content });

  } catch (error) {
    console.error("Error crítico:", error);
    res.status(500).json({ respuesta: "⚠️ El motor legal está procesando la jerarquía normativa. Intente de nuevo." });
  }
});

async function obtenerEmbedding(texto) { /* Lógica de embedding aquí */ return []; }

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe v4.1 (Jerarquía Normativa Completa) activo en ${PORT}`));
