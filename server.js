import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
// 1. IMPORTAR WS PARA SOLUCIONAR ERROR DE DEPLOY
import ws from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 2. CONFIGURAR SUPABASE PASANDO WS COMO TRANSPORTE
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: 'lexnave-auth-token',
    persistSession: false, // Recomendado para entornos de servidor
    detectSessionInUrl: false,
  },
  // ESTA ES LA SOLUCIÓN AL ERROR DE DEPLOY EN NODE < 22
  realtime: {
    transport: ws,
  },
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
    // 3. BUSCAR CONTEXTO EN SUPABASE (Usando la RPC match_leyes)
    // Nota: Necesitas tener implementada la lógica de embeddings para que esto funcione.
    const queryEmbedding = await obtenerEmbedding(pregunta); // Función dummy abajo
    
    let contextoLegal = "";
    if (queryEmbedding && queryEmbedding.length > 0) {
        const { data: contextData, error: rpcError } = await supabase.rpc('match_leyes', {
            query_embedding: queryEmbedding,
            match_threshold: 0.7,
            match_count: 5
        });
        
        if (rpcError) {
            console.error("Error en RPC de Supabase:", rpcError);
        } else if (contextData) {
            contextoLegal = contextData.map(d => d.content).join('\n');
        }
    }

    // 4. LLAMADA A GROQ CON EL CONTEXTO INTEGRADO
    const response = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt + (contextoLegal ? "\n\nCONTEXTO LEGAL INTEGRAL:\n" + contextoLegal : "") },
        { role: 'user', content: pregunta }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1 
    });

    res.json({ respuesta: response.choices[0]?.message?.content });

  } catch (error) {
    console.error("Error crítico general:", error);
    res.status(500).json({ respuesta: "⚠️ Error en la consulta legal. Intente de nuevo." });
  }
});

// Función auxiliar para embeddings (Neceistarás implementar la lógica real aquí)
async function obtenerEmbedding(texto) {
    // Aquí invocas tu modelo de embeddings (ej. text-embedding-3-small de OpenAI)
    // y devuelves el array de números. Por ahora devuelve vacío.
    console.log("obtenerEmbedding: Lógica de embedding no implementada.");
    return []; 
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe v4.2 (Fix WS + Jerarquía Completa) activo en ${PORT}`));
