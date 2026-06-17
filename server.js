import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai'; // Asegura que coincide con tu dependencia en Render

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización de la API de Gemini (Asegurada para entornos productivos)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Base de datos simulada o mapeo de IDs de leyes para la clasificación previa
const LEY_MAP = {
  1: "Constitución de la República Bolivariana de Venezuela (CRBV)",
  2: "Código de Procedimiento Civil (CPC)",
  3: "Código Civil de Venezuela (CCV)",
  4: "Ley de Transporte Terrestre",
  5: "Ley de Abogados y Reglamento de Honorarios",
  7: "Procedimientos Especiales Contenciosos"
};

/**
 * ROBUSTEZ TÉCNICA: Limpia y parsea JSON generados por LLMs
 * Evita el fatal: "SyntaxError: Unexpected non-whitespace character after JSON..."
 */
function safeJsonParse(rawText) {
  try {
    // Si viene limpio, parsea directo
    return JSON.parse(rawText.trim());
  } catch (e) {
    // Si el LLM metió texto explicativo, extraemos únicamente el bloque JSON con Regex
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
 * Filtra los artículos que envía la base de datos vectorial mediante evaluación lógica
 */
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
  
  const promptFiltro = `
  Actúa como un estricto Juez de Admisión. Evalúa cuáles de los siguientes artículos de la ley venezolana tienen relación directa y útil para responder la pregunta del ciudadano.
  
  Pregunta: "${pregunta}"
  
  Artículos Candidatos:
  ${JSON.stringify(articulosCandidatos, null, 2)}
  
  Responde ÚNICAMENTE con un arreglo JSON que contenga los IDs de los artículos admitidos. No agregues saludos, introducciones ni bloques de código markdown.
  Ejemplo de salida: [1, 4, 12]
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: promptFiltro
    });
    
    const responseText = response.text || "";
    // Uso del parser blindado para mitigar caídas en producción
    const idsAdmitidos = safeJsonParse(responseText);
    
    if (Array.isArray(idsAdmitidos)) {
      return articulosCandidatos.filter(art => idsAdmitidos.includes(art.id));
    }
    return articulosCandidatos.slice(0, 3); // Fallback seguro
  } catch (error) {
    console.error("❌ Error mitigado en el filtro supremo:", error.message);
    // Fallback dinámico en caso de fallo de sintaxis: no dejamos al usuario sin respuesta
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
    Analiza la siguiente consulta legal de un ciudadano venezolano y clasifícala en formato JSON estricto:
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

    const resClasificacion = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: promptClasificacion
    });

    const metadata = safeJsonParse(resClasificacion.text);
    console.log(`${timestamp} ⚖️ Clasificación Procesal Exitosa:`, JSON.stringify(metadata, null, 2));

    // Si el backend determina que se necesita aclarar obligatoriamente antes de procesar
    if (metadata.needs_clarification && metadata.clarification_question) {
      return res.json({ 
        respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` 
      });
    }

    // 2. Ejecución del Filtro Supremo sobre los datos del RAG externo
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    console.log(`${timestamp} ✅ Tras el filtro supremo quedaron ${articulosFiltrados.length} artículos.`);

    // 3. CONSTRUCCIÓN DEL PROMPT DE SISTEMA DEFINITIVO (Blindaje Anti-Alucinaciones Ordinarias)
    const systemPrompt = `
    Eres "LexnaVe", un ultra-meticuloso Abogado Senior y Experto en Derecho Procesal Civil y Constitucional Venezolano. 
    Tu misión es orientar al ciudadano con absoluta precisión técnica, pulcritud en los lapsos procesales y un tono firme, pedagógico y profesional.

    ⚠️ REGLAS DOGMÁTICAS INVIOLABLES DE EVALUACIÓN JURÍDICA:
    1. PROHIBICIÓN DEL COMODÍN ORDINARIO: Si el usuario te pregunta por un procedimiento especial (Juicio Breve, Intimación, Estimación de Honorarios, Tránsito, Divorcio por Desafecto), tienes PROHIBIDO usar o rellenar tablas con los lapsos del Juicio Ordinario Civil (15 días promoción, 30 evacuación, etc.). Si tu contexto normativo inmediato no contiene los lapsos exactos, recurre a tu conocimiento interno experto de la legislación de Venezuela.
    2. VERDAD CONSTITUCIONAL: La Seguridad de la Nación está consagrada expresamente en el Título VII, Artículo 322 y siguientes de la CRBV como una competencia del Estado y corresponsabilidad ciudadana. Jamás digas que la Constitución no contiene artículos de este tema.
    3. EXACTITUD EN CONCEPTOS PROCESALES:
       - La "Promoción de Pruebas" NO es para presentar la demanda. La demanda abre el juicio (Art. 339 CPC).
       - La "Oposición" en tablas de pruebas es a la admisión de los medios probatorios de la contraparte, no para contestar la demanda.
    4. PROTOCOLO ANTE VACÍOS (CONOCIMIENTO EXPERTO DE RESPALDO):
       - Si es "Procedimiento Breve" (Art. 881 CPC): El lapso probatorio es de DIEZ (10) días de despacho para promover y evacuar simultáneamente (Art. 889 CPC). No hay lapsos separados de 15 o 30 días.
       - Si es "Estimación de Honorarios" (Art. 22 Ley de Abogados): Si se objeta por moderación, se abre una articulación probatoria de OCHO (8) días de despacho. Si se demanda su cobro, puede ir por el procedimiento de Retasa o vía intimación.
       - Si es "Juicio de Intimación" (Art. 640 CPC): El decreto de intimación concede DIEZ (10) días de despacho al demandado para pagar o formular oposición formal.
       - Si es "Divorcio por Desafecto" (Sentencia 1070/2016 TSJ-SC): Es jurisdicción voluntaria. Se interpone la solicitud, se cita al otro cónyuge y el Juez decreta la disolución en una Audiencia Simple. No hay lapso de pruebas ni debate sobre el afecto.
       - Si es "Choque de Carros" (Tránsito): La acción civil se fundamenta en el Art. 1185 del CCV (Responsabilidad Civil Extracontractual), pero requiere obligatoriamente el Acta de Choque levantada por la autoridad de tránsito (INTT/Policía) según la Ley de Transporte Terrestre.

    ESTRUCTURA DE TU RESPUESTA:
    - Diseña secciones limpias usando encabezados markdown.
    - Cuando presentes flujos procesales, utiliza tablas únicamente si conoces los números de días exactos vigentes en Venezuela; si el flujo procesal es de jurisdicción voluntaria o sin lapsos fijos (como el desafecto), descríbelo en viñetas estructuradas paso a paso, nunca dejes columnas o filas en blanco o con guiones descriptivos.
    - Cierra siempre con la advertencia obligatoria: "⚖️ Esto es orientación general. Consulta con un abogado."
    `;

    const promptFinal = `
    Contexto Legal Recuperado (Artículos de la Ley):
    ${JSON.stringify(articulosFiltrados, null, 2)}

    Clasificación del Caso:
    ${JSON.stringify(metadata, null, 2)}

    Consulta del Usuario a Resolver:
    "${pregunta}"
    `;

    // 4. Generación de la Respuesta Jurídica Definitiva
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        { role: 'user', text: systemPrompt },
        { role: 'user', text: promptFinal }
      ]
    });

    res.json({ respuesta: response.text });

  } catch (error) {
    console.error(`❌ Error crítico en el flujo de consulta:`, error);
    res.status(500).json({ 
      respuesta: "⚠️ Se produjo un error procesal en el servidor judicial de LexnaVe. Por favor, reintente su consulta." 
    });
  }
});

// Inicialización del puerto binding compatible con la infraestructura de Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend activo y escuchando en el puerto ${PORT}`);
});
