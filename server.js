import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai'; 

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización clásica usando la variable de entorno de Render
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// SINOPSIS EXACTA DE TU TABLA public.leyes (Verificado en 1000058415.jpg)
const LEY_MAP = {
  1: "Constitución de la República Bolivariana de Venezuela",
  2: "Ley de Propiedad Horizontal",
  3: "Código Civil",
  4: "Código de Comercio",
  5: "Código Orgánico Procesal Penal",
  6: "Código Penal",
  7: "Código de Procedimiento Civil"
};

/**
 * ROBUSTEZ TÉCNICA: Limpia y parsea JSON generados por LLMs
 * Previene el SyntaxError aislando bloques estructurales con expresiones regulares
 */
function safeJsonParse(rawText) {
  try {
    return JSON.parse(rawText.trim());
  } catch (e) {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0].trim());
      } catch (innerError) {
        throw new Error(`Imposible parsear JSON incluso tras extracción: ${innerError.message}`);
      }
    }
    throw e;
  }
}

/**
 * FILTRO SUPREMO MEJORADO (RAG Custody)
 */
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
  
  const promptFiltro = `
  Actúa como un estricto Juez de Admisión. Evalúa cuáles de los siguientes artículos de la ley venezolana tienen relación directa y útil para responder la pregunta del ciudadano.
  
  Pregunta: "${pregunta}"
  
  Artículos Candidatos:
  ${JSON.stringify(articulosCandidatos, null, 2)}
  
  Responde ÚNICAMENTE con un arreglo JSON que contenga los IDs de los artículos admitidos. No agregues saludos, introducciones ni bloques de código markdown.
  Ejemplo de salida: [1, 3, 7]
  `;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(promptFiltro);
    const response = await result.response;
    const responseText = response.text() || "";
    
    const idsAdmitidos = safeJsonParse(responseText);
    
    if (Array.isArray(idsAdmitidos)) {
      return articulosCandidatos.filter(art => idsAdmitidos.includes(art.id));
    }
    return articulosCandidatos.slice(0, 3);
  } catch (error) {
    console.error("❌ Error mitigado en el filtro supremo:", error.message);
    return articulosCandidatos.slice(0, 4);
  }
}

/**
 * ENDPOINT PRINCIPAL DE CONSULTA LEGAL
 */
app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;
  const timestamp = new Date().toISOString();

  console.log(`${timestamp} 📨 [Petición] Pregunta: ${pregunta}`);

  try {
    // 1. Clasificación Procesal de la Intención Legal del Usuario
    const promptClasificacion = `
    Analiza la siguiente consulta legal de un ciudadano venezolano y clasifícala en formato JSON estricto considerando nuestra base de datos (1:CRBV, 2:LPH, 3:CCV, 4:CCom, 5:COPP, 6:CP, 7:CPC):
    Consulta: "${pregunta}"

    Campos obligatorios en el JSON:
    {
      "needs_clarification": boolean,
      "clarification_question": string o null,
      "ley_id": number o null,
      "legal_intent": "string descriptivo de la acción judicial",
      "articulo_num": number o null,
      "text_keywords": ["array", "de", "palabras", "clave"]
    }
    `;

    const modelClasificacion = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const resultClasificacion = await modelClasificacion.generateContent(promptClasificacion);
    const responseClasificacion = await resultClasificacion.response;

    const metadata = safeJsonParse(responseClasificacion.text());
    console.log(`${timestamp} ⚖️ Clasificación Procesal Exitosa:`, JSON.stringify(metadata, null, 2));

    if (metadata.needs_clarification && metadata.clarification_question) {
      return res.json({ 
        respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` 
      });
    }

    // 2. Ejecución del Filtro Supremo
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    console.log(`${timestamp} ✅ Tras el filtro supremo quedaron ${articulosFiltrados.length} artículos.`);

    // 3. CONSTRUCCIÓN DEL PROMPT DE SISTEMA DEFINITIVO (Blindaje de Lapsos y Subsunción Táctica)
    const systemPrompt = `
    Eres "LexnaVe", un ultra-meticuloso Abogado Senior y Experto en Derecho Procesal Civil, Penal y Constitucional Venezolano. 
    Tu misión es orientar al ciudadano con absoluta precisión técnica, pulcritud en los lapsos procesales y un tono firme, pedagógico y profesional.

    ⚠️ REGLAS DOGMÁTICAS INVIOLABLES DE EVALUACIÓN JURÍDICA:
    1. PROHIBICIÓN DEL COMODÍN ORDINARIO: Si el usuario te pregunta por un procedimiento especial (Juicio Breve, Intimación, Estimación de Honorarios, Tránsito, Divorcio por Desafecto), tienes PROHIBIDO usar o rellenar tablas con los lapsos del Juicio Ordinario Civil (15 días promoción, 30 evacuación, etc.). Si tu contexto normativo inmediato no contiene los lapsos exactos, recurre a tu conocimiento interno experto de la legislación de Venezuela.
    2. VERDAD CONSTITUCIONAL Y PENAL (IDs 1, 5, 6): 
       - La Seguridad de la Nación está consagrada expresamente en el Título VII, Artículo 322 de la CRBV (ID 1). Jamás alegues ignorancia sobre este artículo.
       - Consultas sobre delitos, denuncias o querellas deben fundamentarse rígidamente en el Código Penal (ID 6) y el Código Orgánico Procesal Penal (ID 5).
    3. PROPIEDAD HORIZONTAL Y MERCANTIL (IDs 2, 4): 
       - Si la consulta es sobre problemas de edificios, apartamentos, juntas de condominio o cobro de cuotas morosas, debes subordinar el análisis a la Ley de Propiedad Horizontal (ID 2).
       - Si la consulta involucra pagarés, letras de cambio, comerciantes o actos de comercio, encuádralo en el Código de Comercio (ID 4).
    4. EXACTITUD EN CONCEPTOS PROCESALES (ID 7):
       - La "Promoción de Pruebas" NO es para presentar la demanda. La demanda abre el juicio (Art. 339 CPC).
       - La "Oposición" en tablas de pruebas es a la admisión de los medios probatorios de la contraparte, no para contestar la demanda.
    5. PROTOCOLO ANTE VACÍOS (CONOCIMIENTO EXPERTO DE RESPALDO):
       - Si es "Procedimiento Breve" (Art. 881 CPC): El lapso probatorio es de DIEZ (10) días de despacho para promover y evacuar simultáneamente (Art. 889 CPC). No hay lapsos separados de 15 o 30 días.
       - Si es "Estimación de Honorarios" (Art. 22 Ley de Abogados): Si se objeta por moderación, se abre una articulación probatoria de OCHO (8) días de despacho.
       - Si es "Juicio de Intimación" (Art. 640 CPC): El decreto de intimación concede DIEZ (10) días de despacho al demandado para pagar o formular oposición formal.
       - Si es "Divorcio por Desafecto" (Sentencia 1070/2016 TSJ-SC): Es jurisdicción voluntaria. Se interpone la solicitud, se cita al otro cónyuge y el Juez decreta la disolución en una Audiencia Simple. No hay lapso de pruebas ni debate sobre el afecto.
       - Si es "Choque de Carros" (Tránsito): La acción civil se fundamenta en el Art. 1185 del CCV (Responsabilidad Civil Extracontractual - ID 3), pero requiere obligatoriamente el Acta de Choque levantada por la autoridad de tránsito según la Ley de Transporte Terrestre.

    ESTRUCTURA DE TU RESPUESTA:
    - Diseña secciones limpias usando encabezados markdown.
    - Cuando presentes flujos procesales, utiliza tablas únicamente si conoces los números de días exactos vigentes en Venezuela; si el flujo procesal es de jurisdicción voluntaria o sin lapsos fijos, descríbelo en viñetas estructuradas paso a paso, nunca dejes columnas o filas en blanco.
    - Cierra siempre con la advertencia obligatoria: "⚖️ Esto es orientación general. Consulta con un abogado."
    `;

    const promptFinal = `
    Contexto Legal Seleccionado desde Supabase (Artículos Admitidos):
    ${JSON.stringify(articulosFiltrados, null, 2)}

    Clasificación Interna del Caso:
    ${JSON.stringify(metadata, null, 2)}

    Consulta del Usuario a Resolver:
    "${pregunta}"
    `;

    // Estructura de llamadas multi-role clásica para simular System Instructions
    const modelFinal = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const chat = modelFinal.startChat({
      history: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: "Entendido. Asumo el rol de LexnaVe con las reglas dogmáticas e instrucciones estructurales indicadas." }] }
      ]
    });

    const resultFinal = await chat.sendMessage(promptFinal);
    const responseFinal = await resultFinal.response;

    res.json({ respuesta: responseFinal.text() });

  } catch (error) {
    console.error(`❌ Error crítico en el flujo de consulta:`, error);
    res.status(500).json({ 
      respuesta: "⚠️ Se produjo un error procesal en el servidor judicial de LexnaVe. Por favor, reintente su consulta." 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend activo y escuchando en el puerto ${PORT}`);
});
