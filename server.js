import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

// ========== CONFIGURACIÓN SUPABASE ==========
const supabase = createClient(
    process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
    process.env.SUPABASE_KEY || "sb_publishable_pIYUap3GDuL7xqwP0CCCWA_WrUPp1aN",
    {
        realtime: { transport: WebSocket }
    }
);

// ========== INICIALIZACIÓN GROQ ==========
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ========== MAPEO DE LEYES ==========
const LEY_MAP = {
  1: "Constitución de la República Bolivariana de Venezuela",
  2: "Ley de Propiedad Horizontal",
  3: "Código Civil",
  4: "Código de Comercio",
  5: "Código Orgánico Procesal Penal",
  6: "Código Penal",
  7: "Código de Procedimiento Civil",
  8: "Ley de Arrendamiento de Vivienda",
  9: "Ley Orgánica sobre el Derecho de las Mujeres a una Vida Libre de Violencia",
  10: "Ley de regulación del arrendamiento inmobiliario para el uso comercial",
  11: "LEY DE REGISTROS Y NOTARIAS"
};

// ========== CONOCIMIENTO EXPERTO POR LEY (FALLBACK) ==========
const EXPERT_KNOWLEDGE = {
  1: {
    articulos: [
      { id: 44, texto: "Artículo 44: Derecho a la libertad personal. Nadie puede ser arrestado sino en virtud de orden judicial, salvo flagrancia." },
      { id: 49, texto: "Artículo 49: Debido proceso y derecho a la defensa." },
      { id: 322, texto: "Artículo 322: Seguridad de la Nación." }
    ]
  },
  2: {
    articulos: [
      { id: 1, texto: "Artículo 1: Ámbito de aplicación de la Ley de Propiedad Horizontal." },
      { id: 12, texto: "Artículo 12: Obligaciones de los propietarios." },
      { id: 34, texto: "Artículo 34: Pago de cuotas de mantenimiento." }
    ]
  },
  3: {
    articulos: [
      { id: 1159, texto: "Artículo 1159: Los contratos tienen fuerza de ley entre las partes." },
      { id: 1167, texto: "Artículo 1167: Obligaciones condicionales." },
      { id: 1185, texto: "Artículo 1185: Responsabilidad civil extracontractual." }
    ]
  },
  4: {
    articulos: [
      { id: 488, texto: "Artículo 488: Letras de cambio, pagarés y cheques se ejecutarán por procedimiento ejecutivo." },
      { id: 490, texto: "Artículo 490: Demanda ejecutiva. Embargo y 3 días para pago u oposición." },
      { id: 649, texto: "Artículo 649: Requisitos del documento constitutivo de sociedades mercantiles." }
    ]
  },
  5: {
    articulos: [
      { id: 25, texto: "Artículo 25: Acción privada." },
      { id: 267, texto: "Artículo 267: Denuncia." },
      { id: 274, texto: "Artículo 274: Querella." },
      { id: 295, texto: "Artículo 295: Plazo de 6 meses para investigación." },
      { id: 373, texto: "Artículo 373: Detención en flagrancia. 12h policía + 48h fiscal = 60h total." }
    ]
  },
  6: {
    articulos: [
      { id: 175, texto: "Artículo 175: Amenazas. Prisión de 6 a 18 meses." },
      { id: 413, texto: "Artículo 413: Lesiones personales." },
      { id: 442, texto: "Artículo 442: Difamación. Prisión de 3 a 12 meses." },
      { id: 443, texto: "Artículo 443: Difamación es acción privada." },
      { id: 444, texto: "Artículo 444: Calumnia." },
      { id: 449, texto: "Artículo 449: Plazo de 6 meses para difamación." }
    ]
  },
  7: {
    articulos: [
      { id: 339, texto: "Artículo 339: La demanda abre el juicio civil." },
      { id: 640, texto: "Artículo 640: Juicio de intimación. 10 días para pagar u oponerse." },
      { id: 881, texto: "Artículo 881: Procedimiento breve." },
      { id: 889, texto: "Artículo 889: Lapso probatorio de 10 días." }
    ]
  },
  8: {
    articulos: [
      { id: 1, texto: "Artículo 1: Objeto de la Ley de Arrendamiento." },
      { id: 2, texto: "Artículo 2: Carácter estratégico y de interés público." },
      { id: 34, texto: "Artículo 34: Causales de desalojo. Falta de pago por 2 meses." },
      { id: 36, texto: "Artículo 36: Procedimiento breve. Contestación 15 días, pruebas 8 días." }
    ]
  },
  9: {
    articulos: [
      { id: 1, texto: "Artículo 1: Objeto de la Ley contra la Violencia a la Mujer." },
      { id: 3, texto: "Artículo 3: Derechos protegidos. Vida, integridad, seguridad." },
      { id: 42, texto: "Artículo 42: Medidas de protección." },
      { id: 53, texto: "Artículo 53: Órdenes de protección y alejamiento." },
      { id: 58, texto: "Artículo 58: Procedimiento especial." }
    ]
  },
  10: {
    articulos: [
      { id: 1, texto: "Artículo 1: Ámbito de aplicación comercial." },
      { id: 15, texto: "Artículo 15: Causales de resolución." }
    ]
  },
  11: {
    articulos: [
      { id: 1, texto: "Artículo 1: Organización del sistema de registros." },
      { id: 20, texto: "Artículo 20: Funciones de registradores." }
    ]
  }
};

// ========== FUNCIÓN DE PARSEO JSON ==========
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

// ========== OBTENER ARTÍCULOS DE SUPABASE POR LEY_ID ==========
async function obtenerArticulosPorLey(leyId) {
  try {
    console.log(`🔍 Buscando artículos para ley_id: ${leyId}`);
    
    let { data, error } = await supabase
      .from('articulos')
      .select('id, numero_articulo, ley_id, contenido')
      .eq('ley_id', leyId);
    
    if (error) {
      console.error('❌ Error Supabase:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      console.log(`✅ Encontrados ${data.length} artículos en Supabase para ley ${leyId}`);
      const transformados = data.map(art => {
        let idNumerico = art.numero_articulo;
        if (typeof idNumerico === 'string') {
          const numMatch = idNumerico.match(/\d+/);
          idNumerico = numMatch ? parseInt(numMatch[0]) : art.id;
        }
        return {
          id: idNumerico,
          texto: art.contenido,
          ley_id: art.ley_id
        };
      });
      return transformados.slice(0, 10);
    }
    
    console.log(`⚠️ No hay artículos en Supabase para ley ${leyId}`);
    return null;
    
  } catch (error) {
    console.error('❌ Error en obtenerArticulosPorLey:', error);
    return null;
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
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });
    
    const responseText = chatCompletion.choices[0]?.message?.content || "";
    const parsedResponse = safeJsonParse(responseText);
    
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
      model: 'llama-3.3-70b-versatile',
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

    // 2. OBTENER ARTÍCULOS POR LEY_ID (desde Supabase)
    let articulosFiltrados = [];
    let leyesAUsar = [];

    // Si hay ley_id de la clasificación, usarla
    if (metadata.ley_id) {
      leyesAUsar.push(metadata.ley_id);
    }

    // Detección de palabras clave para agregar leyes adicionales
    if (pregunta.match(/amenaz|agres|empuj|golpe|violencia|herid|golp|insult|ofend|maltrat|cuchill|navaj|puñal|pistol|arma/i)) {
      if (!leyesAUsar.includes(6)) leyesAUsar.push(6);
      if (!leyesAUsar.includes(9)) leyesAUsar.push(9);
    }

    if (pregunta.match(/alquil|arrend|inquil|desalo/i)) {
      if (!leyesAUsar.includes(8)) leyesAUsar.push(8);
    }

    if (pregunta.match(/pagar|letra|cambio|cheque|mercantil|comerci|comercial|pagaré/i)) {
      if (!leyesAUsar.includes(4)) leyesAUsar.push(4);
    }

    // Si no hay leyes detectadas, usar todas las disponibles
    if (leyesAUsar.length === 0) {
      leyesAUsar = [1, 2, 3, 4, 5, 6, 7];
    }

    leyesAUsar = [...new Set(leyesAUsar)];
    console.log(`📋 Leyes a consultar: ${leyesAUsar.join(', ')}`);

    // Buscar en Supabase por cada ley
    for (const leyId of leyesAUsar) {
      const articulos = await obtenerArticulosPorLey(leyId);
      if (articulos && articulos.length > 0) {
        articulosFiltrados.push(...articulos.slice(0, 5));
      }
    }

    // Si no hay artículos de Supabase, usar EXPERT_KNOWLEDGE como fallback
    if (articulosFiltrados.length === 0) {
      console.log('⚠️ No hay artículos de Supabase, usando conocimiento experto');
      for (const leyId of leyesAUsar) {
        const expertData = EXPERT_KNOWLEDGE[leyId];
        if (expertData) {
          articulosFiltrados.push(...expertData.articulos);
        }
      }
    }

    // Limitar a 10 artículos totales para evitar error de tokens
    if (articulosFiltrados.length > 10) {
      articulosFiltrados = articulosFiltrados.slice(0, 10);
    }

    console.log(`${timestamp} ✅ Tras el filtro quedaron ${articulosFiltrados.length} artículos.`);

    // 3. CONSTRUCCIÓN DEL PROMPT DE SISTEMA DEFINITIVO
    const systemPrompt = `
    Eres "LexnaVe", un ultra-meticuloso Abogado Senior y Experto en Derecho Venezolano. 
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
       - La "Oposición" en tablas de pruebas es a la admisión de los medios probatorios de la contraparte, no para contestar la demanda.
    5. PROTOCOLO ANTE VACÍOS CIVILES:
       - Si es "Procedimiento Breve" (Art. 881 CPC): El lapso probatorio es de DIEZ (10) días de despacho para promover y evacuar simultáneamente (Art. 889 CPC). No hay lapsos separados de 15 o 30 días.
       - Si es "Estimación de Honorarios" (Art. 22 Ley de Abogados): Si se objeta por moderación, se abre una articulación probatoria de OCHO (8) días de despacho.
       - Si es "Juicio de Intimación" (Art. 640 CPC): El decreto de intimación concede DIEZ (10) días de despacho al demandado para pagar o formular oposición formal.
       - Si es "Divorcio por Desafecto" (Sentencia 1070/2016 TSJ-SC): Es jurisdicción voluntaria. Se interpone la solicitud, se cita al otro cónyuge y el Juez decreta la disolución en una Audiencia Simple. No hay lapso de pruebas ni debate sobre el afecto.
       - Si es "Choque de Carros" (Tránsito): La acción civil se fundamenta en el Art. 1185 del CCV (Responsabilidad Civil Extracontractual - ID 3), pero requiere obligatoriamente el Acta de Choque levantada por la autoridad de tránsito según la Ley de Transporte Terrestre.

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
    - Debes CITAR textualmente los artículos que uses, con su número y contenido exacto.
    - Cada afirmación legal debe ir acompañada del artículo correspondiente.
    - Cuando presents flujos procesales, utiliza tablas únicamente si conoces los números de días exactos vigentes en Venezuela; si el flujo procesal es de jurisdicción voluntaria, penal o sin lapsos fijos, descríbelo en viñetas estructuradas paso a paso, nunca dejes columnas o filas en blanco.
    - Cierra siempre con la advertencia obligatoria: "⚖️ Esto es orientación general. Consulta con un abogado."
    `;

    const promptFinal = `
    Contexto Legal Seleccionado desde Supabase (Artículos Admitidos):
    ${JSON.stringify(articulosFiltrados, null, 2)}
    Formato: "Artículo X: [texto del artículo]"

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
      model: 'llama-3.3-70b-versatile',
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
