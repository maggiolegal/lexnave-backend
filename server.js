import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_KEY || !GROQ_API_KEY) {
  console.error("❌ Faltan variables de entorno: SUPABASE_KEY y GROQ_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === 1. DICCIONARIO DE TRADUCCIÓN COLOQUIAL A JURÍDICO ===
const TRADUCTOR_COLOQUIAL_JURIDICO = {
  'casa': 'inmueble vivienda bien raiz propiedad',
  'carro': 'vehiculo automotor transporte',
  'choque': 'accidente transito colision siniestro',
  'daño': 'perjuicio menoscabo indemnizacion responsabilidad ilicito',
  'compre': 'compraventa compra venta contrato',
  'vendio': 'compraventa venta enajenacion',
  'entregar': 'tradicion entrega posesion tenencia',
  'letra': 'titulo valor letra cambio pagare documento mercantil',
  'pagar': 'pago cumplimiento obligacion deuda solventar',
  'despido': 'terminacion relacion laboral despido injustificado',
  'jefe': 'patron empleador trabajador',
  'sueldo': 'salario remuneracion prestaciones',
  'divorcio': 'disolucion vinculo matrimonial separacion cuerpos',
  'hijos': 'filiacion patria potestad responsabilidad crianza',
  'herencia': 'sucesion causante heredero legatario testamento',
  'vecino': 'condominio copropiedad comunidad',
  'ruido': 'molestias servidumbres uso disfrute'
};

// === 2. MAPEO DE TEMAS A LEYES ===
const TEMAS_A_LEYES = {
  'divorcio': ['Código Civil', 'Constitución'],
  'matrimonio': ['Código Civil'],
  'custodia': ['Código Civil'],
  'pensión': ['Código Civil'],
  'alimentos': ['Código Civil'],
  'herencia': ['Código Civil'],
  'sucesión': ['Código Civil'],
  'testamento': ['Código Civil'],
  'contrato': ['Código Civil', 'Código de Comercio'],
  'compra': ['Código Civil', 'Código de Comercio'],
  'venta': ['Código Civil', 'Código de Comercio'],
  'arrendamiento': ['Código Civil'],
  'despido': ['Constitución'],
  'laboral': ['Constitución'],
  'trabajo': ['Constitución'],
  'salario': ['Constitución'],
  'penal': ['Código Penal', 'COPP'],
  'delito': ['Código Penal', 'COPP'],
  'carcel': ['Código Penal', 'COPP'],
  'prisión': ['Código Penal', 'COPP'],
  'hurto': ['Código Penal'],
  'robo': ['Código Penal'],
  'estafa': ['Código Penal'],
  'procedimiento': ['Código de Procedimiento Civil', 'COPP'],
  'demanda': ['Código de Procedimiento Civil'],
  'juicio': ['Código de Procedimiento Civil', 'COPP'],
  'citacion': ['Código de Procedimiento Civil'],
  'propiedad': ['Código Civil', 'Ley de Propiedad Horizontal'],
  'apartamento': ['Ley de Propiedad Horizontal'],
  'condominio': ['Ley de Propiedad Horizontal'],
  'asamblea': ['Ley de Propiedad Horizontal'],
  'mercantil': ['Código de Comercio'],
  'empresa': ['Código de Comercio'],
  'sociedad': ['Código de Comercio'],
  'cheque': ['Código de Comercio'],
  'letra de cambio': ['Código de Comercio'],
  'pagare': ['Código de Comercio']
};

// === 3. BASE DE DATOS EXTENSA DE PALABRAS CLAVE LEGALES (7 LEYES) ===
const PALABRAS_CLAVE_LEGALES = [
  // --- TÉRMINOS GENERALES Y PROCESALES ---
  'accion', 'demanda', 'recurso', 'amparo', 'casacion', 'apelacion', 
  'sentencia', 'auto', 'proveido', 'tribunal', 'juez', 'fiscalia', 
  'ministerio publico', 'abogado', 'defensor', 'citacion', 'notificacion',
  'prueba', 'testigo', 'perito', 'inspeccion', 'diligencia', 'expediente',
  'competencia', 'jurisdiccion', 'nulidad', 'prescripcion', 'caducidad',
  
  // --- CÓDIGO CIVIL (Familia, Bienes, Obligaciones) ---
  'capacidad', 'domicilio', 'ausencia', 'matrimonio', 'divorcio', 
  'separacion', 'cuerpos', 'filiacion', 'adopcion', 'patria', 'potestad',
  'tutela', 'curatela', 'mayoria', 'edad', 'bienes', 'muebles', 'inmuebles',
  'propiedad', 'posesion', 'usufructo', 'uso', 'habitacion', 'servidumbre',
  'hipoteca', 'prenda', 'anticresis', 'obligacion', 'contrato', 'consentimiento',
  'objeto', 'causa', 'vicio', 'error', 'dolo', 'violencia', 'lesion',
  'simulacion', 'fraude', 'pago', 'cesion', 'novacion', 'compensacion',
  'confusion', 'remision', 'prescripcion', 'adquirir', 'dominio', 'herencia',
  'sucesion', 'testamento', 'legado', 'albacea', 'particion', 'colacion',
  'donacion', 'venta', 'compra', 'permuta', 'arrendamiento', 'comodato',
  'deposito', 'mandato', 'fianza', 'transaccion', 'cuasicontrato',
  'enriquecimiento', 'ilicito', 'hecho', 'daño', 'perjuicio', 'indemnizacion',
  
  // --- CÓDIGO DE COMERCIO (Mercantil) ---
  'comerciante', 'actos', 'comercio', 'libros', 'contabilidad', 'balanza',
  'corredor', 'comisionista', 'agente', 'sociedad', 'anonima', 'comandita',
  'responsabilidad', 'limitada', 'nombre', 'colectiva', 'liquidacion',
  'quiebra', 'concurso', 'acreedores', 'suspension', 'pagos', 'titulo',
  'valor', 'negociable', 'letra', 'cambio', 'pagare', 'cheque', 'endoso',
  'acepte', 'aval', 'protesto', 'vencimiento', 'intereses', 'moratorios',
  'barco', 'navegacion', 'averia', 'fletamento', 'seguro', 'maritimo',
  
  // --- CÓDIGO PENAL (Delitos y Penas) ---
  'delito', 'falta', 'pena', 'prision', 'arresto', 'multa', 'inhabilitacion',
  'extranjero', 'expulsion', 'tentativa', 'complicidad', 'encubrimiento',
  'concurrencia', 'reincidencia', 'atenuantes', 'agravantes', 'eximentes',
  'legitima', 'defensa', 'estado', 'necesidad', 'cumplimiento', 'deber',
  'ejercicio', 'derecho', 'homicidio', 'asesinato', 'infanticidio', 'aborto',
  'lesiones', 'culposas', 'dolosas', 'veneno', 'abandono', 'persona',
  'incendio', 'estragos', 'naufragio', 'violacion', 'estupro', 'rapto',
  'seduccion', 'corrupcion', 'menores', 'bigamia', 'incesto', 'ultraje',
  'pudor', 'calumnia', 'injuria', 'difamacion', 'hurto', 'robo', 'extorsion',
  'estafa', 'usura', 'apropiacion', 'indebida', 'estelionato', 'usura',
  'administracion', 'publica', 'peculado', 'malversacion', 'cohecho',
  'soborno', 'trafico', 'influencias', 'prevaricato', 'denegacion', 'justicia',
  'retardo', 'funcionario', 'publico', 'falsedad', 'documento', 'moneda',
  'sellos', 'armas', 'explosivos', 'orden', 'publico', 'resistencia',
  'atentado', 'motin', 'rebelion', 'sedicion',
  
  // --- CÓDIGO DE PROCEDIMIENTO CIVIL (Proceso Civil) ---
  'competencia', 'fuero', 'domicilio', 'recusacion', 'inhibicion',
  'intervencion', 'terceros', 'litisconsorcio', 'acumulacion', 'demandado',
  'actor', 'libelo', 'emplazamiento', 'contestacion', 'reconvencion',
  'pruebas', 'promocion', 'evacuacion', 'informes', 'sentencia', 'casacion',
  'revision', 'ejecucion', 'embargo', 'secuestro', 'intervencion',
  'judicial', 'remate', 'adjudicacion', 'costas', 'interes', 'mora',
  
  // --- CÓDIGO ORGÁNICO PROCESAL PENAL (Proceso Penal) ---
  'investigacion', 'flagrancia', 'detencion', 'presentacion', 'imputado',
  'acusacion', 'juicio', 'oral', 'publico', 'veredicto', 'absolucion',
  'condena', 'reparacion', 'victim', 'testigo', 'proteccion', 'medidas',
  'cautelares', 'libertad', 'condicional', 'suspension', 'proceso',
  'abreviado', 'aceptacion', 'cargos', 'apertura', 'debate', 'deliberacion',
  
  // --- LEY DE PROPIEDAD HORIZONTAL ---
  'condominio', 'copropiedad', 'partes', 'comunes', 'privativas',
  'asamblea', 'conjunto', 'residencial', 'administrador', 'junta',
  'condominios', 'cuotas', 'gastos', 'mantenimiento', 'reglamento',
  'obras', 'mejoras', 'innovaciones', 'uso', 'destino', 'inmueble',
  
  // --- CONSTITUCIÓN (Derechos Fundamentales) ---
  'derechos', 'humanos', 'garantias', 'vida', 'integridad', 'personal',
  'libertad', 'seguridad', 'juridica', 'igualdad', 'no', 'discriminacion',
  'educacion', 'salud', 'vivienda', 'trabajo', 'seguridad', 'social',
  'familia', 'niños', 'adolescentes', 'adultos', 'mayores', 'pueblos',
  'indigenas', 'ambiente', 'deberes', 'ciudadanos', 'sufragio', 'participacion',
  'poder', 'publico', 'legislativo', 'ejecutivo', 'judicial', 'electoral',
  'ciudadano', 'descentralizacion', 'municipios', 'estados', 'regiones'
];

app.get('/', (req, res) => {
  res.json({ 
    message: 'LexnaVe Backend funcionando',
    version: '4.1 - Flexible Query Engine',
    especialidad: 'Derecho Venezolano',
    leyes_cargadas: {
      'Constitución': 350,
      'Código Civil': 1995,
      'Código de Comercio': 1120,
      'COPP': 518,
      'Código Penal': 546,
      'Código de Procedimiento Civil': 946,
      'Ley de Propiedad Horizontal': 50
    }
  });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    
    if (!pregunta || pregunta.trim().length < 5) {
      return res.status(400).json({ 
        respuesta: "Por favor, formula una pregunta más específica sobre derecho venezolano.",
        articulos: [] 
      });
    }
    
    console.log("🔍 Pregunta recibida:", pregunta);
    
    // Detectar si es una consulta por número de artículo específico
    const consultaArticuloEspecifico = detectarConsultaArticuloEspecifico(pregunta);
    
    let articulos = [];
    let error = null;
    
    if (consultaArticuloEspecifico) {
      // Búsqueda directa por número de artículo y ley
      console.log("📝 Búsqueda por artículo específico:", consultaArticuloEspecifico);
      const resultado = await buscarArticuloEspecifico(consultaArticuloEspecifico);
      articulos = resultado.data;
      error = resultado.error;
    } else {
      // Búsqueda normal por contenido SEMÁNTICO MEJORADO
      const palabrasClave = extraerPalabrasClaveMejorado(pregunta);
      const leyesRelevantes = identificarLeyesRelevantes(pregunta);
      
      console.log("📝 Palabras clave (Ordenadas):", palabrasClave);
      console.log("⚖️ Leyes relevantes:", leyesRelevantes);
      
      const queryBusqueda = construirQueryBusqueda(palabrasClave);
      console.log("🔎 Query final:", queryBusqueda);
      
      const resultado = await supabase
        .from("articulos")
        .select(`
          id, 
          numero_articulo, 
          contenido, 
          ley_id,
          leyes (nombre)
        `)
        .textSearch("contenido", queryBusqueda, {
          type: "websearch",
          config: "spanish"
        })
        .limit(12);
      
      articulos = resultado.data;
      error = resultado.error;
    }
    
    if (error) {
      console.error("❌ Error de Supabase:", error);
      return res.json({ 
        respuesta: "Error en base de datos. Por favor, intenta nuevamente.", 
        articulos: [] 
      });
    }
    
    console.log(`📊 Artículos encontrados: ${articulos ? articulos.length : 0}`);
    
    // Filtrar y priorizar
    const resultados = filtrarYPriorizarArticulos(articulos || [], pregunta);
    console.log(`✅ Artículos relevantes: ${resultados.length}`);
    
    // Generar respuesta
    let respuesta = "";
    let fuentesCitadas = [];
    
    if (resultados.length > 0) {
      const contextoLegal = construirContextoLegal(resultados);
      const prompt = crearPromptProfesional(pregunta, contextoLegal);
      
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "Eres LexnaVe, asistente legal especializada en derecho venezolano. Responde con precisión jurídica basándote SOLO en los artículos proporcionados."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.2,
          max_tokens: 1200,
          top_p: 0.9
        })
      });
      
      const groqData = await groqRes.json();
      
      if (groqData.choices && groqData.choices[0]) {
        respuesta = groqData.choices[0].message.content;
        fuentesCitadas = extraerFuentesCitadas(resultados, respuesta);
      } else {
        console.error("❌ Error Groq:", groqData);
        respuesta = "⚠️ Error al procesar tu consulta. Intenta nuevamente.";
      }
    } else {
      respuesta = generarRespuestaSinResultados(pregunta, consultaArticuloEspecifico);
    }
    
    const respuestaFinal = formatearRespuestaFinal(respuesta, fuentesCitadas);
    
    res.json({ 
      respuesta: respuestaFinal, 
      articulos: resultados.slice(0, 5),
      meta: {
        total_encontrados: resultados.length,
        consulta_especifica: !!consultaArticuloEspecifico
      }
    });
    
  } catch (error) {
    console.error("❌ Error crítico:", error.message);
    res.status(500).json({ 
      respuesta: "Error técnico. Intenta nuevamente más tarde.", 
      articulos: [] 
    });
  }
});

// === FUNCIONES ESPECIALIZADAS ===

function detectarConsultaArticuloEspecifico(pregunta) {
  const regexArticulo = /(?:art[íi]culo|art\.?)\s+(\d+)(?:\s+(?:del|de la|de)\s+([a-záéíóúñ\s]+))?/i;
  const match = pregunta.match(regexArticulo);
  
  if (match) {
    const numero = match[1];
    let ley = match[2] ? match[2].trim() : null;
    
    if (ley) {
      ley = normalizarNombreLey(ley);
    }
    
    return { numero, ley };
  }
  
  return null;
}

function normalizarNombreLey(nombre) {
  const normalizaciones = {
    'cpc': 'Código de Procedimiento Civil',
    'codigo de procedimiento civil': 'Código de Procedimiento Civil',
    'proc civil': 'Código de Procedimiento Civil',
    'cc': 'Código Civil',
    'codigo civil': 'Código Civil',
    'cp': 'Código Penal',
    'codigo penal': 'Código Penal',
    'copp': 'Código Orgánico Procesal Penal',
    'codigo organico procesal penal': 'Código Orgánico Procesal Penal',
    'comercio': 'Código de Comercio',
    'codigo de comercio': 'Código de Comercio',
    'constitucion': 'Constitución',
    'constitución': 'Constitución',
    'crbv': 'Constitución',
    'lph': 'Ley de Propiedad Horizontal',
    'propiedad horizontal': 'Ley de Propiedad Horizontal'
  };
  
  const nombreLower = nombre.toLowerCase();
  
  for (const [clave, valor] of Object.entries(normalizaciones)) {
    if (nombreLower.includes(clave)) {
      return valor;
    }
  }
  
  return nombre;
}

async function buscarArticuloEspecifico({ numero, ley }) {
  let query = supabase
    .from("articulos")
    .select(`
      id, 
      numero_articulo, 
      contenido, 
      ley_id,
      leyes (nombre)
    `)
    .eq("numero_articulo", numero);
  
  if (ley) {
    query = query.ilike("leyes.nombre", `%${ley}%`);
  }
  
  return await query.limit(5);
}

// === FUNCIÓN MEJORADA: EXTRACCIÓN CON PRIORIZACIÓN JURÍDICA ===
function extraerPalabrasClaveMejorado(pregunta) {
  const stopWords = ["me", "quiero", "tengo", "la", "el", "los", "las", "un", "una", "de", "del", "como", "en", "qué", "que", "por", "para", "con", "sin", "sobre", "entre", "hago", "puedo", "debo", "se", "es", "son"];
  
  let palabrasOriginales = pregunta.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
    .split(/\s+/)
    .filter(p => !stopWords.includes(p) && p.length > 2);

  // 1. Aplicar traducción coloquial -> jurídico
  let terminosJuridicosAgregados = [];
  
  palabrasOriginales.forEach(palabra => {
    if (TRADUCTOR_COLOQUIAL_JURIDICO[palabra]) {
      const sinonimos = TRADUCTOR_COLOQUIAL_JURIDICO[palabra].split(' ');
      terminosJuridicosAgregados.push(...sinonimos);
    }
  });

  // 2. Identificar palabras clave legales existentes en la pregunta
  const palabrasLegalesExistentes = PALABRAS_CLAVE_LEGALES.filter(keyword => 
    pregunta.toLowerCase().includes(keyword)
  );

  // 3. Combinar todo: Jurídicos PRIMERO, luego Originales, luego Legales Generales
  // Esto asegura que la palabra "obligatoria" (+) sea siempre el término técnico correcto
  const todasLasPalabras = [...new Set([...terminosJuridicosAgregados, ...palabrasOriginales, ...palabrasLegalesExistentes])];
  
  return todasLasPalabras.slice(0, 12);
}

function identificarLeyesRelevantes(pregunta) {
  const preguntaLower = pregunta.toLowerCase();
  const leyesDetectadas = new Set();
  
  for (const [tema, leyes] of Object.entries(TEMAS_A_LEYES)) {
    if (preguntaLower.includes(tema)) {
      leyes.forEach(ley => leyesDetectadas.add(ley));
    }
  }
  
  return Array.from(leyesDetectadas);
}

// === FUNCIÓN CRÍTICA: QUERY FLEXIBLE ===
function construirQueryBusqueda(palabrasClave) {
  if (palabrasClave.length === 0) return "";
  
  // Estrategia: 
  // 1. La primera palabra (que ahora será un término jurídico gracias al ordenamiento) es OBLIGATORIA (+)
  // 2. El resto son OPCIONALES (ayudan a filtrar pero no bloquean si faltan)
  
  const principal = palabrasClave[0];
  const secundarias = palabrasClave.slice(1);
  
  // Ejemplo: "+compraventa casa inmueble entrega"
  let query = `+${principal}`;
  
  if (secundarias.length > 0) {
    query += " " + secundarias.join(" ");
  }
  
  return query;
}

function filtrarYPriorizarArticulos(articulos, pregunta) {
  if (!articulos || articulos.length === 0) return [];
  
  const leyesFundamentales = [
    'Constitución',
    'Código Civil',
    'Código Penal',
    'Código de Procedimiento Civil',
    'Código Orgánico Procesal Penal'
  ];
  
  const palabrasPregunta = pregunta.toLowerCase().split(/\s+/);
  
  const conScore = articulos.map(art => {
    let score = 0;
    const contenido = art.contenido.toLowerCase();
    const nombreLey = art.leyes?.nombre || "";
    
    // Priorizar leyes fundamentales
    if (leyesFundamentales.some(ley => nombreLey.includes(ley))) {
      score += 5;
    }
    
    // Coincidencias de palabras originales
    palabrasPregunta.forEach(palabra => {
      if (palabra.length > 3 && contenido.includes(palabra)) {
        score += 2;
      }
    });
    
    // Bonus por coincidencia de términos legales expandidos
    PALABRAS_CLAVE_LEGALES.forEach(keyword => {
      if (contenido.includes(keyword)) {
        score += 1;
      }
    });
    
    return { ...art, score };
  });
  
  return conScore
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function construirContextoLegal(articulos) {
  let contexto = "";
  
  articulos.forEach((art, index) => {
    const nombreLey = art.leyes?.nombre || "Ley venezolana";
    
    contexto += `\n[${index + 1}] ${nombreLey}\n`;
    contexto += `Artículo ${art.numero_articulo}: ${art.contenido.substring(0, 500)}${art.contenido.length > 500 ? '...' : ''}\n`;
    contexto += `---\n`;
  });
  
  return contexto;
}

function crearPromptProfesional(pregunta, contextoLegal) {
  return `
CONTEXTO LEGAL VENEZOLANO DISPONIBLE:
${contextoLegal}

PREGUNTA DEL CIUDADANO: "${pregunta}"

INSTRUCCIONES ESTRICTAS:

1. **FUNDAMENTO EXCLUSIVO**: Tu respuesta debe basarse ÚNICAMENTE en los artículos mostrados arriba. NO inventes normas.

2. **ESTRUCTURA OBLIGATORIA**:
   a) Respuesta directa y clara.
   b) Explicación del fundamento legal basado en los textos provistos.
   c) Si aplica, pasos procedimentales.
   d) Lista de artículos citados.

3. **TONO**: Profesional, empático y claro para no abogados.

4. **SI NO HAY INFORMACIÓN SUFICIENTE**: Indícalo claramente.

RESPUESTA:`;
}

function extraerFuentesCitadas(articulos, respuesta) {
  const fuentes = [];
  const regexArticulo = /Art[íi]culo\s+(\d+)/gi;
  const coincidencias = [...respuesta.matchAll(regexArticulo)];
  
  coincidencias.forEach(match => {
    const numArt = match[1];
    const encontrado = articulos.find(a => a.numero_articulo === numArt);
    
    if (encontrado && encontrado.leyes) {
      fuentes.push({
        ley: encontrado.leyes.nombre,
        articulo: numArt
      });
    }
  });
  
  return [...new Map(fuentes.map(f => [`${f.ley}-${f.articulo}`, f])).values()];
}

function generarRespuestaSinResultados(pregunta, esArticuloEspecifico) {
  if (esArticuloEspecifico) {
    return `No encontré el artículo específico que mencionas. Verifica el número o la ley en la Gaceta Oficial.`;
  }
  
  return `No encontré información precisa con esos términos. Intenta usar lenguaje más formal (ej: en vez de "choque", usa "accidente de tránsito"; en vez de "casa", usa "inmueble").`;
}

function formatearRespuestaFinal(respuestaIA, fuentesCitadas) {
  let respuesta = respuestaIA;
  
  if (fuentesCitadas.length > 0) {
    respuesta += "\n\n📚 **Normas consultadas:**";
    fuentesCitadas.forEach(f => {
      respuesta += `\n• ${f.ley}, Art. ${f.articulo}`;
    });
  }
  
  respuesta += "\n\n---\n";
  respuesta += "⚖️ **Aviso Legal**: Orientación general. Consulta a un abogado para tu caso específico.\n";
  respuesta += "🆘 Emergencias: Defensoría del Pueblo (0800-333-3637).";
  
  return respuesta;
}

app.listen(PORT, () => {
  console.log(`🚀 LexnaVe v4.1 activo en puerto ${PORT}`);
  console.log(`📚 Base: 4,525 artículos | Query Flexible Activa`);
});
