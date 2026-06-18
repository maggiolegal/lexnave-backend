import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización de Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Mapeo de leyes
const LEY_MAP = {
  1: "Constitución de la República Bolivariana de Venezuela",
  2: "Ley de Propiedad Horizontal",
  3: "Código Civil",
  4: "Código de Comercio",
  5: "Código Orgánico Procesal Penal",
  6: "Código Penal",
  7: "Código de Procedimiento Civil",
  8: "Ley de Arrendamientos Inmobiliarios" // AÑADIDO
};

// Conocimiento experto de respaldo para cuando el filtro falle
const EXPERT_KNOWLEDGE = {
  // Caso: Detención en flagrancia
  flagrancia: {
    ley_id: 5,
    articulos: [
      { id: 373, texto: "Artículo 373 COPP: Lapso de 12 horas para poner al detenido a disposición del MP y 48 horas para presentarlo ante el Juez." }
    ]
  },
  // Caso: Difamación
  difamacion: {
    ley_id: 6,
    articulos: [
      { id: 442, texto: "Artículo 442 Código Penal: Difamación. Penas de 3 a 12 meses de prisión." }
    ]
  },
  // Caso: Letra de cambio
  letra_cambio: {
    ley_id: 4,
    articulos: [
      { id: 488, texto: "Artículo 488 Código de Comercio: Procedimiento ejecutivo para títulos valores." },
      { id: 490, texto: "Artículo 490 Código de Comercio: Plazo de 3 días para pago u oposición." }
    ]
  },
  // Caso: Desalojo
  desalojo: {
    ley_id: 8,
    articulos: [
      { id: 34, texto: "Artículo 34 Ley de Arrendamientos: Causales de desalojo por falta de pago." },
      { id: 36, texto: "Artículo 36: Procedimiento breve para desalojo." }
    ]
  }
};

/**
 * ROBUSTEZ TÉCNICA: Limpia y parsea JSON
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
        throw new Error(`Imposible parsear JSON: ${innerError.message}`);
      }
    }
    throw e;
  }
}

/**
 * FILTRO SUPREMO MEJORADO - CON FALLBACK INTELIGENTE
 */
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  // ========== NUEVA VALIDACIÓN ROBUSTA ==========
  console.log(`📋 Total artículos candidatos: ${articulosCandidatos?.length || 0}`);
  
  // Si no hay artículos, activar modo experto
  if (!articulosCandidatos || articulosCandidatos.length === 0) {
    console.warn("⚠️ No se recibieron artículos - activando modo experto");
    return null; // Retornar null para activar el modo experto
  }

  // Validar estructura de los artículos
  const primerArticulo = articulosCandidatos[0];
  console.log('📋 Estructura del primer artículo:', JSON.stringify(primerArticulo, null, 2));
  
  // Verificar que los artículos tengan los campos necesarios
  const tieneCamposValidos = articulosCandidatos.every(art => 
    art && typeof art === 'object' && 'id' in art && 'texto' in art
  );

  if (!tieneCamposValidos) {
    console.warn("⚠️ Artículos con estructura incorrecta - usando modo experto");
    return null;
  }

  // ========== FILTRO CON GROQ ==========
  const promptFiltro = `
  Actúa como un estricto Juez de Admisión. Evalúa cuáles de los siguientes artículos de la ley venezolana tienen relación directa y útil para responder la pregunta del ciudadano.
  
  Pregunta: "${pregunta}"
  
  Artículos Candidatos:
  ${JSON.stringify(articulosCandidatos, null, 2)}
  
  Responde ÚNICAMENTE con un arreglo JSON que contenga los IDs de los artículos admitidos.
  Ejemplo de salida: [1, 3, 7]
  `;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptFiltro }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    
    const responseText = chatCompletion.choices[0]?.message?.content || "";
    const parsedResponse = safeJsonParse(responseText);
    
    const idsAdmitidos = Array.isArray(parsedResponse) ? parsedResponse : (parsedResponse.ids || []);
    
    if (idsAdmitidos.length > 0) {
      const filtrados = articulosCandidatos.filter(art => idsAdmitidos.includes(art.id));
      console.log(`✅ Filtro: ${filtrados.length} artículos relevantes`);
      return filtrados;
    }
    
    // Si el filtro no encontró nada, devolver los primeros 3
    console.warn("⚠️ Filtro no encontró artículos - devolviendo primeros 3");
    return articulosCandidatos.slice(0, 3);
    
  } catch (error) {
    console.error("❌ Error en filtro supremo:", error.message);
    return articulosCandidatos.slice(0, 4);
  }
}

/**
 * DETECCIÓN DE PATRONES PARA MODO EXPERTO
 */
function detectarPatronLegal(pregunta) {
  const p = pregunta.toLowerCase();
  
  // Patrones de detección
  if (p.includes('flagrancia') || p.includes('arrestó') || p.includes('detención') || p.includes('detenido')) {
    return 'flagrancia';
  }
  if (p.includes('difamación') || p.includes('difamar') || p.includes('estafador') || p.includes('instagram') || p.includes('redes sociales')) {
    return 'difamacion';
  }
  if (p.includes('letra de cambio') || p.includes('pagaré') || p.includes('cheque') || p.includes('título valor')) {
    return 'letra_cambio';
  }
  if (p.includes('alquiler') || p.includes('inquilino') || p.includes('arrendamiento') || p.includes('desalojo')) {
    return 'desalojo';
  }
  
  return null;
}

/**
 * SISTEMA PROMPT MEJORADO
 */
function construirSystemPrompt(leyId, esModoExperto = false) {
  let basePrompt = `
  Eres "LexnaVe", un ultra-meticuloso Abogado Senior y Experto en Derecho Venezolano. 
  Tu misión es orientar al ciudadano con absoluta precisión técnica, pulcritud en los lapsos procesales y un tono firme, pedagógico y profesional.

  ⚠️ REGLAS DOGMÁTICAS INVIOLABLES:

  --- BLOQUE CIVIL Y CONSTITUCIONAL ---
  1. PROHIBICIÓN DEL COMODÍN ORDINARIO: Si el usuario pregunta por procedimiento especial (Juicio Breve, Intimación, Estimación de Honorarios), tienes PROHIBIDO usar lapsos del Juicio Ordinario Civil.
  2. JUICIO EJECUTIVO MERCANTIL (Art. 488 Código de Comercio): Para Letras de Cambio, el procedimiento es EJECUTIVO, no ordinario. Se decreta embargo preventivo y se da 3 días para pago u oposición.
  3. PROPIEDAD HORIZONTAL (ID 2): Problemas de edificios, condominios, cuotas de mantenimiento.
  4. DESALOJO (Ley de Arrendamientos): Procedimiento BREVE. Art. 34 para causales, Art. 36 para procedimiento.

  --- BLOQUE PENAL ---
  5. FLAGRANCIA (Art. 373 COPP): 12 horas policía + 48 horas fiscal = 60 horas total. Si se exceden, procede hábeas corpus.
  6. DIFAMACIÓN (Art. 442 CP): Acción PRIVADA. No se denuncia en Fiscalía, se interpone ACUSACIÓN PRIVADA con abogado.
  7. AMENAZAS (Art. 175 CP) y LESIONES (Art. 413 CP): Acción PÚBLICA. Se denuncia en Fiscalía.

  ESTRUCTURA DE RESPUESTA:
  - Usa encabezados markdown para secciones
  - Cita ARTÍCULOS ESPECÍFICOS con texto textual
  - Incluye PLazOS PROCESALES concretos
  - Diferencia entre ACCIÓN PÚBLICA y PRIVADA
  - Cierra con: "⚖️ Esto es orientación general. Consulta con un abogado."
  `;

  // Si es modo experto, añadir instrucción específica
  if (esModoExperto) {
    basePrompt += `
    ⚠️ MODO EXPERTO ACTIVADO: No tienes artículos específicos en el contexto. 
    Debes usar TU CONOCIMIENTO INTERNO de la legislación venezolana, pero 
    especifica claramente que estás citando de memoria y recomienda verificar 
    la norma en el texto oficial.
    `;
  }

  return basePrompt;
}

/**
 * ENDPOINT PRINCIPAL DE CONSULTA LEGAL - VERSIÓN CORREGIDA
 */
app.post('/api/consultar', async (req, res) => {
  const { pregunta, articulosRaw } = req.body;
  const timestamp = new Date().toISOString();

  console.log(`${timestamp} 📨 [Petición] Pregunta: ${pregunta}`);
  console.log(`${timestamp} 📋 Artículos recibidos: ${articulosRaw?.length || 0}`);

  try {
    // ========== 1. CLASIFICACIÓN PROCESAL MEJORADA ==========
    const promptClasificacion = `
    Analiza la siguiente consulta legal de un ciudadano venezolano y clasifícala en formato JSON estricto.
    
    REGLAS DE CLASIFICACIÓN PRIORITARIA:
    - Si menciona "flagrancia", "arresto", "detención" → ley_id: 5 (COPP)
    - Si menciona "difamación", "injuria", "calumnia", "redes sociales" → ley_id: 6 (Código Penal)
    - Si menciona "letra de cambio", "pagaré", "cheque" → ley_id: 4 (Código de Comercio)
    - Si menciona "alquiler", "inquilino", "arrendamiento" → ley_id: 8 (Ley de Arrendamientos)
    - Si menciona "propiedad horizontal", "condominio" → ley_id: 2 (LPH)
    
    Consulta: "${pregunta}"

    Respuesta en JSON:
    {
      "needs_clarification": boolean,
      "clarification_question": string o null,
      "ley_id": number o null,
      "legal_intent": "string descriptivo",
      "articulo_num": number o null,
      "text_keywords": ["array", "de", "palabras"]
    }
    `;

    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
    console.log(`${timestamp} ⚖️ Clasificación:`, JSON.stringify(metadata, null, 2));

    // Si necesita aclaración
    if (metadata.needs_clarification && metadata.clarification_question) {
      return res.json({ 
        respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` 
      });
    }

    // ========== 2. FILTRADO DE ARTÍCULOS CON FALLBACK ==========
    let articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosRaw || []);
    let esModoExperto = false;

    // Si el filtro devolvió null o 0 artículos, activar modo experto
    if (!articulosFiltrados || articulosFiltrados.length === 0) {
      esModoExperto = true;
      
      // Intentar detectar patrón para usar conocimiento experto
      const patron = detectarPatronLegal(pregunta);
      if (patron && EXPERT_KNOWLEDGE[patron]) {
        const expertData = EXPERT_KNOWLEDGE[patron];
        articulosFiltrados = expertData.articulos.map(art => ({
          ...art,
          ley_id: expertData.ley_id
        }));
        console.log(`${timestamp} 🧠 Usando conocimiento experto para: ${patron}`);
        console.log(`${timestamp} 📋 Artículos de respaldo: ${articulosFiltrados.length}`);
      } else {
        // Si no hay patrón, usar los primeros 4 de los raw o generar mensaje
        articulosFiltrados = (articulosRaw || []).slice(0, 4);
        if (articulosFiltrados.length === 0) {
          // Crear artículos genéricos basados en la clasificación
          articulosFiltrados = [{
            id: metadata.articulo_num || 1,
            texto: `Artículo ${metadata.articulo_num || 1} - Consulta legal sobre ${metadata.legal_intent || 'asunto jurídico'}`
          }];
        }
        console.log(`${timestamp} 📋 Usando artículos por defecto`);
      }
    }

    console.log(`${timestamp} ✅ Artículos finales: ${articulosFiltrados.length}`);

    // ========== 3. CONSTRUCCIÓN DEL PROMPT FINAL ==========
    const systemPrompt = construirSystemPrompt(metadata.ley_id, esModoExperto);

    const promptFinal = `
    Contexto Legal Seleccionado:
    ${JSON.stringify(articulosFiltrados, null, 2)}

    Clasificación del Caso:
    ${JSON.stringify(metadata, null, 2)}

    Consulta del Usuario:
    "${pregunta}"

    ${esModoExperto ? '⚠️ MODO EXPERTO: Usa tu conocimiento interno de la legislación venezolana.' : ''}
    `;

    // ========== 4. GENERACIÓN DE RESPUESTA ==========
    const responseFinal = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: promptFinal }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.3
    });

    const respuestaFinal = responseFinal.choices[0]?.message?.content;

    // ========== 5. VALIDACIÓN DE CALIDAD ==========
    // Verificar si la respuesta tiene citas de artículos
    const tieneArticulos = /artículo|art\./i.test(respuestaFinal);
    const tienePlazos = /\d+ horas|\d+ días/i.test(respuestaFinal);
    
    console.log(`${timestamp} 📊 Calidad: Artículos=${tieneArticulos}, Plazos=${tienePlazos}`);

    // Si falta calidad, añadir advertencia
    let respuestaConAdvertencia = respuestaFinal;
    if (!tieneArticulos || !tienePlazos) {
      respuestaConAdvertencia += `\n\n⚠️ **Nota del sistema**: Para una orientación más precisa, consulta directamente el texto de la ley en el portal del TSJ o con un abogado especializado.`;
    }

    res.json({ respuesta: respuestaConAdvertencia });

  } catch (error) {
    console.error(`❌ Error crítico:`, error);
    
    // Respuesta de emergencia
    let respuestaEmergencia = "⚠️ Se produjo un error procesal en el servidor. ";
    
    // Intentar dar una respuesta útil aunque falle Groq
    try {
      const patron = detectarPatronLegal(req.body.pregunta || '');
      if (patron && EXPERT_KNOWLEDGE[patron]) {
        const expertData = EXPERT_KNOWLEDGE[patron];
        const articulosTexto = expertData.articulos.map(a => a.texto).join('\n');
        respuestaEmergencia += `\n\n**Orientación de emergencia:**\n${articulosTexto}\n\nConsulta con un abogado para mayor detalle.`;
      } else {
        respuestaEmergencia += "Por favor, reintente su consulta o consulte con un abogado.";
      }
    } catch (e) {
      respuestaEmergencia += "Por favor, reintente su consulta.";
    }
    
    res.status(500).json({ respuesta: respuestaEmergencia });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend v2.0 (Corregido) en puerto ${PORT}`);
});
