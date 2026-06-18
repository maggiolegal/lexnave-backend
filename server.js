import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

// ========== CONFIGURACIÓN ==========
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

import { WebSocket } from 'ws';
const supabase = createClient(
    process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
    process.env.SUPABASE_KEY || "sb_publishable_pIYUap3GDuL7xqwP0CCCWA_WrUPp1aN",
    {
        realtime: { transport: WebSocket }
    }
);
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

// ========== CONOCIMIENTO EXPERTO POR LEY ==========
const EXPERT_KNOWLEDGE = {
  1: { // Constitución
    articulos: [
      { id: 44, texto: "Artículo 44: Derecho a la libertad personal. Nadie puede ser arrestado sino en virtud de orden judicial, salvo flagrancia." },
      { id: 49, texto: "Artículo 49: Debido proceso y derecho a la defensa." },
      { id: 322, texto: "Artículo 322: Seguridad de la Nación. Corresponde al Estado la protección de la soberanía." }
    ]
  },
  2: { // Propiedad Horizontal
    articulos: [
      { id: 1, texto: "Artículo 1: Ámbito de aplicación de la Ley de Propiedad Horizontal." },
      { id: 12, texto: "Artículo 12: Obligaciones de los propietarios y copropietarios." },
      { id: 34, texto: "Artículo 34: Pago de cuotas de mantenimiento y administración." }
    ]
  },
  3: { // Código Civil
    articulos: [
      { id: 1159, texto: "Artículo 1159: Los contratos tienen fuerza de ley entre las partes." },
      { id: 1167, texto: "Artículo 1167: Obligaciones condicionales." },
      { id: 1185, texto: "Artículo 1185: Responsabilidad civil extracontractual. Quien cause daño a otro está obligado a indemnizar." }
    ]
  },
  4: { // Código de Comercio
    articulos: [
      { id: 488, texto: "Artículo 488: Las letras de cambio, pagarés y cheques se ejecutarán conforme al procedimiento ejecutivo." },
      { id: 490, texto: "Artículo 490: Presentada la demanda ejecutiva, el Juez decretará el embargo y citará al deudor para que pague en tres días." },
      { id: 649, texto: "Artículo 649: Requisitos del documento constitutivo de sociedades mercantiles." }
    ]
  },
  5: { // COPP
    articulos: [
      { id: 25, texto: "Artículo 25: Acción privada. Solo puede ser ejercida por la víctima o sus representantes." },
      { id: 267, texto: "Artículo 267: Denuncia. Cualquier persona puede denunciar un hecho punible." },
      { id: 274, texto: "Artículo 274: Querella. Acto formal que ejerce la víctima para constituirse como parte querellante." },
      { id: 295, texto: "Artículo 295: Plazo de 6 meses para la investigación preparatoria." },
      { id: 373, texto: "Artículo 373: Detención en flagrancia. 12 horas policía + 48 horas fiscal = 60 horas total." }
    ]
  },
  6: { // Código Penal
    articulos: [
      { id: 175, texto: "Artículo 175: Amenazas. El que amenazare a otro con causarle un daño grave, será penado con prisión de seis a dieciocho meses." },
      { id: 413, texto: "Artículo 413: Lesiones personales. Penas según la gravedad de la lesión." },
      { id: 442, texto: "Artículo 442: Difamación. El que impute a otro un hecho determinado capaz de exponerle al desprecio, será penado con prisión de tres a doce meses." },
      { id: 443, texto: "Artículo 443: La difamación es delito de acción privada." },
      { id: 444, texto: "Artículo 444: Calumnia. Cuando se imputa un delito falso." },
      { id: 449, texto: "Artículo 449: Plazo de 6 meses para ejercer la acción penal por difamación." }
    ]
  },
  7: { // CPC
    articulos: [
      { id: 339, texto: "Artículo 339: La demanda abre el juicio civil." },
      { id: 640, texto: "Artículo 640: Juicio de intimación. 10 días para pagar u oponerse." },
      { id: 881, texto: "Artículo 881: Procedimiento breve. Lapsos reducidos." },
      { id: 889, texto: "Artículo 889: Lapso probatorio de 10 días para promover y evacuar." }
    ]
  },
  8: { // Ley Arrendamiento Vivienda
    articulos: [
      { id: 1, texto: "Artículo 1: Objeto de la Ley. Régimen jurídico especial de arrendamiento de inmuebles urbanos." },
      { id: 2, texto: "Artículo 2: Carácter estratégico y de interés público." },
      { id: 34, texto: "Artículo 34: Causales de desalojo. La falta de pago por 2 meses consecutivos es causal de desalojo." },
      { id: 36, texto: "Artículo 36: Procedimiento breve para el desalojo. Contestación de 15 días y lapso probatorio de 8 días." }
    ]
  },
  9: { // Ley de la Mujer
    articulos: [
      { id: 42, texto: "Artículo 42: Medidas de protección para víctimas de violencia." },
      { id: 53, texto: "Artículo 53: Órdenes de protección y alejamiento." },
      { id: 58, texto: "Artículo 58: Procedimiento especial para casos de violencia." }
    ]
  },
  10: { // Arrendamiento Comercial
    articulos: [
      { id: 1, texto: "Artículo 1: Ámbito de aplicación para inmuebles comerciales." },
      { id: 15, texto: "Artículo 15: Causales de resolución del contrato." }
    ]
  },
  11: { // Registros y Notarias
    articulos: [
      { id: 1, texto: "Artículo 1: Organización del sistema de registros y notarías." },
      { id: 20, texto: "Artículo 20: Funciones de los registradores y notarios." }
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
        throw new Error(`Imposible parsear JSON: ${innerError.message}`);
      }
    }
    throw e;
  }
}

// ========== OBTENER ARTÍCULOS DE SUPABASE POR LEY_ID ==========
async function obtenerArticulosPorLey(leyId, pregunta) {
  try {
    console.log(`🔍 Buscando artículos para ley_id: ${leyId}`);
    
    // Primero intentar por ley_id
    let { data, error } = await supabase
      .from('articulos')
      .select('numero_articulo as id, ley_id, contenido as texto')
      .eq('ley_id', leyId);
    
    if (error) {
      console.error('❌ Error Supabase:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      console.log(`✅ Encontrados ${data.length} artículos en Supabase para ley ${leyId}`);
      // Filtrar por relevancia usando búsqueda textual adicional
      const relevantes = data.filter(art => 
        art.texto && pregunta.toLowerCase().split(' ').some(p => 
          art.texto.toLowerCase().includes(p) && p.length > 4
        )
      );
      return relevantes.length > 0 ? relevantes : data.slice(0, 5);
    }
    
    console.log(`⚠️ No hay artículos en Supabase para ley ${leyId}`);
    return null;
    
  } catch (error) {
    console.error('❌ Error en obtenerArticulosPorLey:', error);
    return null;
  }
}

// ========== FILTRAR ARTÍCULOS RELEVANTES ==========
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
  if (!articulosCandidatos || articulosCandidatos.length === 0) {
    return null;
  }

  const promptFiltro = `
  Evalúa cuáles de los siguientes artículos tienen relación directa con la pregunta.
  
  Pregunta: "${pregunta}"
  
  Artículos:
  ${JSON.stringify(articulosCandidatos, null, 2)}
  
  Responde ÚNICAMENTE con un arreglo JSON de IDs admitidos.
  Ejemplo: [1, 3, 7]
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
    return articulosCandidatos.slice(0, 4);
  } catch (error) {
    console.error("❌ Error en filtro:", error.message);
    return articulosCandidatos.slice(0, 3);
  }
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
  const { pregunta, sessionId } = req.body;
  const timestamp = new Date().toISOString();

  console.log(`${timestamp} 📨 [Petición] Pregunta: ${pregunta}`);

  try {
    // 1. CLASIFICACIÓN PROCESAL
    const promptClasificacion = `
    Clasifica esta consulta legal venezolana en JSON:
    
    Leyes disponibles:
    1: Constitución, 2: Propiedad Horizontal, 3: Código Civil
    4: Código de Comercio, 5: COPP, 6: Código Penal
    7: CPC, 8: Ley Arrendamiento Vivienda, 9: Ley de la Mujer
    10: Arrendamiento Comercial, 11: Registros y Notarias
    
    Consulta: "${pregunta}"
    
    JSON:
    {
      "needs_clarification": boolean,
      "clarification_question": string o null,
      "ley_id": number o null,
      "legal_intent": "string",
      "text_keywords": ["palabras", "clave"]
    }
    `;

    const resClasificacion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: promptClasificacion }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
    console.log(`${timestamp} ⚖️ Clasificación: ley_id=${metadata.ley_id}`);

    if (metadata.needs_clarification && metadata.clarification_question) {
      return res.json({ 
        respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato._` 
      });
    }

    // 2. OBTENER ARTÍCULOS POR LEY_ID
    let articulosFiltrados = null;
    
    if (metadata.ley_id) {
      // Intentar obtener de Supabase
      const articulosSupabase = await obtenerArticulosPorLey(metadata.ley_id, pregunta);
      
      if (articulosSupabase && articulosSupabase.length > 0) {
        articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosSupabase);
      }
      
      // Si no hay artículos de Supabase, usar conocimiento experto
      if (!articulosFiltrados || articulosFiltrados.length === 0) {
        const expertData = EXPERT_KNOWLEDGE[metadata.ley_id];
        if (expertData) {
          console.log(`🧠 Usando conocimiento experto para ley ${metadata.ley_id}`);
          articulosFiltrados = expertData.articulos;
        }
      }
    }

    // Si aún no hay artículos, usar un fallback genérico
    if (!articulosFiltrados || articulosFiltrados.length === 0) {
      console.log('⚠️ Usando fallback genérico');
      articulosFiltrados = [
        { id: 1, texto: "Consulta legal. La ley aplicable dependerá del caso concreto." }
      ];
    }

    console.log(`✅ Artículos finales: ${articulosFiltrados.length}`);

    // 3. CONSTRUIR SYSTEM PROMPT MEJORADO
    const systemPrompt = `
    Eres "LexnaVe", Abogado Senior Experto en Derecho Venezolano.
    
    ⚠️ REGLAS ESTRICTAS:
    
    1. SIEMPRE cita artículos con número y texto
    2. SIEMPRE menciona plazos procesales en días/horas
    3. Diferencia claramente ACCIÓN PÚBLICA vs ACCIÓN PRIVADA
    4. Si hay múltiples vías (penal + civil), EXPLÍCALAS POR SEPARADO
    5. Usa formato markdown con secciones claras
    6. Cierra con: "⚖️ Esto es orientación general. Consulta con un abogado."
    
    Ley aplicable: ${metadata.ley_id ? LEY_MAP[metadata.ley_id] : 'No especificada'}
    Intención legal: ${metadata.legal_intent || 'Consulta general'}
    `;

    const promptFinal = `
    Artículos de la ley aplicable:
    ${JSON.stringify(articulosFiltrados, null, 2)}
    
    Consulta del usuario:
    "${pregunta}"
    
    Responde con estructura clara, citando artículos específicos y plazos procesales.
    `;

    // 4. GENERAR RESPUESTA
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
    console.error(`❌ Error crítico:`, error);
    res.status(500).json({ 
      respuesta: "⚠️ Error en el servidor. Por favor, reintente su consulta." 
    });
  }
});

// ========== INICIAR SERVIDOR ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend v3.0 (Corregido) en puerto ${PORT}`);
});
