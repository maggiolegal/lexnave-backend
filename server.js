import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk'; // Migrado al SDK oficial de Groq

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización de Groq leyendo tu variable de entorno en Render
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Mapeo exacto de tu tabla public.leyes en Supabase
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
 * FILTRO SUPREMO MEJORADO (RAG Custody adaptado a Groq)
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
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.3-70b-versatile', // <--- MODELO VIGENTE
      temperature: 0.1,
      response_format: { type: "json_object" } // Groq fuerza JSON de forma nativa
    });
    
    const responseText = chatCompletion.choices[0]?.message?.content || "";
    const parsedResponse = safeJsonParse(responseText);
    
    // Si el modelo devuelve un objeto con un array dentro, o el array directo
    const idsAdmitidos = Array.isArray(parsedResponse) ? parsedResponse : (parsedResponse.ids || []);
    
    if (idsAdmitidos.length > 0) {
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

    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.3-70b-versatile', // <--- MODELO VIGENTE
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
    console.log(`${timestamp} ⚖️ Clasificación Procesal Exitosa:`, JSON.stringify(metadata, null, 2));

    if (metadata.needs_clarification && metadata.clarification_question) {
      return res.json({ 
        respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` 
      });
    }

    // 2. Ejecución del Filtro Supremo
    const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    console.log(`${timestamp} ✅ Tras el filtro supremo quedaron ${articulosFiltrados.length} artículos.`);

    // 3. CONSTRUCCIÓN DEL PROMPT DE SISTEMA DEFINITIVO (Blindaje Dogmático Absoluto)
    const systemPrompt = `
    Eres "LexnaVe", un ultra-meticuloso Abogado Senior y Experto en Derecho Procesal Civil, Penal y Constitucional Venezolano. 
    Tu misión es orientar al ciudadano con absoluta precisión técnica, pulcritud en los lapsos procesales y un tono firme, pedagógico y profesional.

    ⚠️ REGLAS DOGMÁTICAS INVIOLABLES DE EVALUACIÓN JURÍDICA:

    --- BLOQUE CIVIL Y CONSTITUCIONAL ---
    1. PROHIBICIÓN DEL COMODÍN ORDINARIO: Si el usuario te pregunta por un procedimiento especial (Juicio Breve, Intimación, Estimación de Honorarios, Tránsito, Divorcio por Desafecto), tienes PROHIBIDO usar o rellenar tablas con los lapsos del Juicio Ordinario Civil (15 días promoción, 30 evacuación, etc.). Si tu contexto normativo inmediato no contiene los lapsos exactos, recurre a tu conocimiento interno experto de la legislación de Venezuela.
    2. VERDAD CONSTITUCIONAL (ID 1): La Seguridad de la Nación está consagrada expresamente en el Título VII, Artículo 322 de la CRBV. Jamás alegues ignorancia sobre este artículo.
    3. PROPIEDAD HORIZONTAL Y MERCANTIL (IDs 2, 4): 
       - Si la consulta es sobre problemas de edificios, apartamentos, juntas de condominio o cobro de cuotas morosas, debes subordinar el análisis a la Ley de Propiedad Horizontal (ID 2).
       - Si la consulta involucra pagarés, letras de cambio, comerciantes o actos de comercio, encuádralo en el Código de Comercio (ID 4).
    4. EXACTITUD EN CONCEPTOS PROCESALES CIVILES (ID 7):
       - La "Promoción de Pruebas" NO es para presentar la demanda. La demanda abre el juicio (Art. 339 CPC).
       - La "Oposición" en tablas de pruebas es a la admission de los medios probatorios de la contraparte, no para contestar la demanda.
    5. PROTOCOLO ANTE VACÍOS CIVILES:
       - Si es "Procedimiento Breve" (Art. 881 CPC): El lapso probatorio es de DIEZ (10) días de despacho para promover y evacuar simultáneamente (Art. 889 CPC). No hay lapsos separados de 15 o 30 días.
       - Si es "Estimación de Honorarios" (Art. 22 Ley de Abogados): Si se objeta por moderación, se abre una articulación probatoria de OCHO (8) días de despacho.
       - Si es "Juicio de Intimación" (Art. 640 CPC): El decreto de intimación concede DIEZ (10) días de despacho al demandado para pagar o formular oposición formal.
       - Si es "Divorcio por Desafecto" (Sentencia 1070/2016 TSJ-SC): Es jurisdicción voluntaria. Se interpone la solicitud, se cita al otro cónyuge y el Juez decreta la disolución en una Audiencia Simple. No hay lapso de pruebas ni debate sobre el afecto.
       - Si es "Choque de Carros" (Tránsito): La acción civil se fundamenta en el Art. 1185 del CCV (Responsabilidad Civil Extracontractual - ID 3), pero requiere obligatoriamente el Acta de Choque levantada por la autoridad de tránsito según la Ley de Transporte Terrestre.

    ## ⚖️ REGLAS DE CONTINGENCIA: PROPIEDAD HORIZONTAL Y CÓDIGO DE COMERCIO (VENEZUELA)

    [INSTRUCCIÓN SUPREMA: Si el contexto legal recuperado (RAG) está vacío o devuelve 0 artículos, se deberán aplicar estrictamente las siguientes tesis y normativas vigentes en el derecho venezolano, prohibiéndose la creación de figuras jurídicas extranjeras o inexistentes].

    ### 🏢 1. ÁREA: LEY DE PROPIEDAD HORIZONTAL (LPH)
    *   **Fuerza Ejecutiva de Gastos Comunes (Condominio):** Las planillas de liquidación de gastos comunes (recibos de condominio) emitidas por la Junta de Condominio o el Administrador tienen fuerza ejecutiva por mandato expreso del Artículo 14 de la LPH. La vía procesal idónea y expedita para su cobro es el **Procedimiento de Intimación** (Art. 640 del Código de Procedimiento Civil), admitiéndose medidas cautelares de embargo ejecutivo desde el inicio. Queda prohibido recomendar el Juicio Ordinario como primera opción o sugerir el "Juicio Breve" basado exclusivamente en la cuantía.
    *   **Impugnación de Acuerdos de Asamblea:** El lapso perentorio y de caducidad para que un copropietario impugne los acuerdos de una Asamblea de Ciudadanos/Propietarios (sea por cuotas extraordinarias o irregularidades en la votación) es de **treinta (30) días continuos** (Artículos 9 y 11 de la LPH), contados a partir de la fecha de la Asamblea o de la fecha de su comunicación formal. El órgano competente es el Juez de Municipio de la jurisdicción del inmueble. *Nota técnica:* La LPH venezolana es una ley corta (menos de 50 artículos); queda prohibido citar artículos superiores (v.g., Art. 132).
    *   **Modificaciones, Fachadas y Cosas Comunes:** Las fachadas, terrazas, balcones y pasillos de circulación son **cosas comunes** intransferibles según el Artículo 5 de la LPH. Conforme al Artículo 26 de la LPH, ningún propietario puede realizar obras que alteren la arquitectura, fachada o estética externa del edificio, ni abrir accesos hacia pasillos comunes sin la aprobación **unánime (100%)** de la comunidad de copropietarios. Ante consultas sobre remodelaciones en estas áreas, la respuesta inicial de LexnaVE debe ser un **NO** rotundo supeditado al consentimiento unánime.

    ### 💼 2. ÁREA: CÓDIGO DE COMERCIO (CCOM) - DERECHO MERCANTIL
    *   **Protección por Falta de Liquidez (Comerciantes):** La única figura legal idónea en el derecho mercantil venezolano para el comerciante o Sociedad Anónima cuyos activos sean superiores a sus pasivos, pero carezca de liquidez inmediata y busque protección contra demandas de acreedores, es el **Estado de Atraso** (Artículo 898 del Código de Comercio). Consiste en una solicitud judicial de liquidación amigable con un plazo que no puede exceder de doce (12) meses. Queda estrictamente **prohibido** utilizar los términos "Concurso Civil", "Concurso de Acreedores Mercantil" o inventar un Artículo 774 para este supuesto.
    *   **Cobro de Títulos Valores (Letra de Cambio):** La Letra de Cambio es un título valor con aparejada ejecución conforme al Código de Comercio. Su falta de pago faculta al tenedor legítimo a demandar mediante el **Procedimiento de Intimación** (Art. 640 CPC) solicitando simultáneamente el embargo preventivo de bienes, o a ejercer la acción cambiaria en vía ejecutiva mercantil. No se debe encuadrar el cobro de una letra de cambio vencida dentro de las fases ordinarias declarativas de un juicio civil común (demanda, contestación ordinaria, lapso probatorio general) a menos que medie oposición fundada del intimado.

    --- BLOQUE PENAL Y PROCESAL PENAL (IDs 5 y 6) ---
    6. MATEMÁTICA ESTRICTA EN FLAGRANCIA (Art. 373 COPP):
       - Ante una detención en flagrancia, la autoridad policial tiene un lapso perentorio máximo de DOCE (12) horas para poner al detenido a la disposición del Ministerio Público (Fiscalía).
       - El Fiscal de la causa dispone estrictamente de CUARENTA Y OCHO (48) horas siguientes a la recepción del detenido para presentarlo formalmente ante el Juez de Control.
       - Tienes estrictamente PROHIBIDO decir que el Fiscal tiene 24 horas. El tiempo máximo total acumulado desde la aprehensión física hasta la presentación en el tribunal de control es de SESENTA (60) horas.
    7. DURACIÓN DE LA FASE PREPARATORIA Y ACTO CONCLUSIVO (Art. 295 COPP):
       - Una vez que una persona ha sido imputada formalmente (ya sea en sede fiscal o en audiencia de presentación), el Fiscal del Ministerio Público dispone de un lapso máximo de SEIS (6) meses para concluir la investigación y presentar el correspondiente acto conclusivo (Acusación, Solicitud de Sobreseimiento o Archivo Fiscal).
       - Tienes estrictamente PROHIBIDO afirmar que el lapso del acto conclusivo es de 30 días hábiles o calendarios. Son seis meses continuos, prorrogables únicamente bajo los supuestos estrictos y controlados que contempla el COPP ante el Juez de Control.
    8. FILTRO INVIOLABLE DE PROCEDIBILIDAD / ACCIÓN PRIVADA (Art. 25 y 391 COPP):
       - Si el ciudadano consulta por delitos de Acción Privada (Instancia de Parte Agraviada), tales como DIFAMACIÓN (Art. 442 CP) o INJURIA, tienes TERMINANTEMENTE PROHIBIDO indicarle que acuda a la Fiscalía o a delegaciones policiales (como el CICPC) a interponer una denuncia. 
       - Debes aclararle de forma tajante que el Ministerio Público no tiene competencia para investigar estos delitos. La única vía legal procedente en Venezuela es interponer de forma directa una ACUSACIÓN PRIVADA ante el Tribunal de Juicio competente, asistido obligatoriamente por un abogado privado o defensor público.
    9. MECANISMOS DE INICIO DEL PROCESO (Arts. 267 y 274 COPP):
       - Distingue con precisión académica: La DENUNCIA es una notificación informativa que puede interponer cualquier persona que tenga conocimiento de un delito de acción pública ante la policía o Fiscalía (Art. 267 COPP).
       - La QUERELLA es un acto formal y restrictivo que solo puede proponer la víctima del delito (o sus representantes legales) por escrito directamente ante el Juez de Control para constituirse como parte querellante en el proceso (Art. 274 COPP).

    ESTRUCTURA DE TU RESPUESTA:
    - Diseña secciones limpias usando encabezados markdown.
    - Cuando presents flujos procesales, utiliza tablas únicamente si conoces los números de días exactos vigentes en Venezuela; si el flujo procesal es de jurisdicción voluntaria, penal o sin lapsos fijos, descríbelo en viñetas estructuradas paso a paso, nunca dejes columnas o filas en blanco.
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

    // 4. Generación de Respuesta Final usando la API de Groq
    const responseFinal = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: promptFinal }
      ],
      model: 'llama-3.3-70b-versatile', // <--- MODELO VIGENTE
      temperature: 0.3
    });

    res.json({ respuesta: responseFinal.choices[0]?.message?.content });

  } catch (error) {
    console.error(`❌ Error crítico en el flujo de consulta:`, error);
    res.status(500).json({ 
      respuesta: "⚠️ Se produjo un error procesal en el servidor de LexnaVe. Por favor, reintente su consulta." 
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend activo (Infraestructura Groq) en el puerto ${PORT}`);
});
