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

// Mapeo de temas a leyes relevantes para priorizar búsquedas
const TEMAS_A_LEYES = {
  'divorcio': ['Código Civil', 'Constitución'],
  'custodia': ['Código Civil', 'LOPNNA'],
  'pensión': ['Código Civil', 'LOTTT'],
  'alimentos': ['Código Civil', 'LOPNNA'],
  'herencia': ['Código Civil'],
  'sucesión': ['Código Civil'],
  'contrato': ['Código Civil', 'Código de Comercio'],
  'compra': ['Código Civil', 'Código de Comercio'],
  'venta': ['Código Civil', 'Código de Comercio'],
  'despido': ['LOTTT', 'Constitución'],
  'laboral': ['LOTTT', 'Constitución'],
  'trabajo': ['LOTTT', 'Constitución'],
  'prestaciones': ['LOTTT'],
  'vacaciones': ['LOTTT'],
  'penal': ['Código Penal', 'COPP'],
  'delito': ['Código Penal', 'COPP'],
  'carcel': ['Código Penal', 'COPP'],
  'prisión': ['Código Penal', 'COPP'],
  'procedimiento': ['Código de Procedimiento Civil', 'COPP'],
  'demanda': ['Código de Procedimiento Civil'],
  'juicio': ['Código de Procedimiento Civil', 'COPP'],
  'propiedad': ['Código Civil', 'Ley de Propiedad Horizontal'],
  'apartamento': ['Ley de Propiedad Horizontal'],
  'condominio': ['Ley de Propiedad Horizontal'],
  'mercantil': ['Código de Comercio'],
  'empresa': ['Código de Comercio'],
  'sociedad': ['Código de Comercio']
};

// Palabras clave legales venezolanas
const PALABRAS_CLAVE_LEGALES = [
  'divorcio', 'custodia', 'pensión', 'alimentos', 'herencia', 'sucesión',
  'contrato', 'despido', 'laboral', 'penal', 'delito', 'demanda',
  'propiedad', 'arrendamiento', 'consumidor', 'tránsito', 'familia',
  'menor', 'violencia', 'género', 'trabajo', 'prestaciones', 'vacaciones',
  'seguro social', 'ivss', 'lopti', 'lopcymat', 'código civil', 'código penal',
  'constitución', 'tribunal', 'juez', 'sentencia', 'recurso', 'amparo',
  'copa', 'copp', 'lotta', 'lot tt'
];

app.get('/', (req, res) => {
  res.json({ 
    message: 'LexnaVe Backend funcionando',
    version: '3.0',
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
      // Búsqueda normal por contenido
      const palabrasClave = extraerPalabrasClave(pregunta);
      const leyesRelevantes = identificarLeyesRelevantes(pregunta);
      
      console.log("📝 Palabras clave:", palabrasClave);
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
        .limit(10);
      
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
  // Patrones: "artículo 223", "art 223", "articulo 223 del cpc"
  const regexArticulo = /(?:art[íi]culo|art\.?)\s+(\d+)(?:\s+(?:del|de la|de)\s+([a-záéíóúñ\s]+))?/i;
  const match = pregunta.match(regexArticulo);
  
  if (match) {
    const numero = match[1];
    let ley = match[2] ? match[2].trim() : null;
    
    // Normalizar nombres de leyes
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
  
  // Si se especificó la ley, filtrar por ella
  if (ley) {
    query = query.ilike("leyes.nombre", `%${ley}%`);
  }
  
  return await query.limit(5);
}

function extraerPalabrasClave(pregunta) {
  const stopWords = ["me", "quiero", "tengo", "la", "el", "los", "las", "un", "una", "de", "del", "como", "en", "qué", "que", "por", "para", "con", "sin", "sobre", "entre", "hago", "puedo", "debo"];
  
  let palabras = pregunta.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")
    .split(/\s+/)
    .filter(p => !stopWords.includes(p) && p.length > 2);
  
  const palabrasLegales = PALABRAS_CLAVE_LEGALES.filter(keyword => 
    pregunta.toLowerCase().includes(keyword)
  );
  
  return [...new Set([...palabras, ...palabrasLegales])].slice(0, 8);
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

function construirQueryBusqueda(palabrasClave) {
  if (palabrasClave.length === 0) return "";
  
  const obligatorias = palabrasClave.slice(0, 3);
  const opcionales = palabrasClave.slice(3);
  
  let query = obligatorias.map(p => `+${p}`).join(" ");
  
  if (opcionales.length > 0) {
    query += " " + opcionales.join(" ");
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
    
    // Coincidencias de palabras
    palabrasPregunta.forEach(palabra => {
      if (palabra.length > 3 && contenido.includes(palabra)) {
        score += 2;
      }
    });
    
    // Bonus por coincidencia exacta de términos legales
    PALABRAS_CLAVE_LEGALES.forEach(keyword => {
      if (pregunta.toLowerCase().includes(keyword) && contenido.includes(keyword)) {
        score += 3;
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

1. **FUNDAMENTO EXCLUSIVO**: Tu respuesta debe basarse ÚNICAMENTE en los artículos mostrados arriba. NO inventes normas, NO cites artículos que no estén presentes.

2. **ESTRUCTURA OBLIGATORIA**:
   a) Respuesta directa (2-3 líneas máximo)
   b) Fundamento legal (explica qué dicen los artículos)
   c) Procedimiento (si aplica, paso a paso)
   d) Artículos aplicables (lista clara)

3. **TONO**: 
   - Claro y accesible para ciudadanos sin formación legal
   - Profesional pero empático
   - Explica tecnicismos cuando los uses

4. **SI NO HAY INFORMACIÓN SUFICIENTE**:
   - Dilo claramente: "Los artículos disponibles no proporcionan información suficiente sobre..."
   - Sugiere consultar la ley completa o un abogado

5. **FORMATO**:
   - Párrafos cortos
   - Viñetas para listas
   - Números de artículos en **negrita**

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
    return `No encontré el artículo específico que mencionas en mi base de datos actual.

Esto puede deberse a:
• El artículo tiene una numeración diferente en la versión cargada
• La ley no está completamente indexada

Te recomiendo:
1. Verificar el número de artículo en la Gaceta Oficial
2. Consultar el texto completo de la ley en: www.gacetaoficial.gob.ve
3. Buscar asesoría legal profesional

¿Puedes reformular tu pregunta describiendo el tema legal en lugar del número de artículo?`;
  }
  
  const esLegal = PALABRAS_CLAVE_LEGALES.some(k => pregunta.toLowerCase().includes(k));
  
  if (esLegal) {
    return `No encontré información específica para: "${pregunta}"

Sugerencias:
• Usa términos más específicos: "divorcio causal", "despido injustificado", "pensión alimentaria"
• Menciona la ley si la conoces: "¿Qué dice el Código Civil sobre...?"
• Describe tu situación con más detalle

Recuerda: LexnaVe consulta más de 4,500 artículos de las principales leyes venezolanas.`;
  }
  
  return `Tu consulta parece estar fuera del ámbito legal venezolano.

LexnaVe responde preguntas sobre:
✓ Derecho de Familia (divorcio, custodia, alimentos)
✓ Derecho Laboral (despidos, prestaciones, contratos)
✓ Derecho Civil (contratos, propiedad, herencias)
✓ Derecho Penal (delitos, procedimientos)
✓ Derecho Mercantil (sociedades, títulos valores)
✓ Derecho Procesal (demandas, recursos, juicios)

Por favor, formula una pregunta específica sobre estos temas.`;
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
  respuesta += "⚖️ **Aviso Legal**: LexnaVe ofrece orientación general basada en legislación venezolana vigente. No constituye asesoramiento legal personalizado. Para tu caso específico, consulta con un abogado colegiado en Venezuela.\n";
  respuesta += "🆘 Emergencias: Defensoría del Pueblo (0800-333-3637) o tribunales de tu localidad.";
  
  return respuesta;
}

app.listen(PORT, () => {
  console.log(`🚀 LexnaVe v3.0 activo en puerto ${PORT}`);
  console.log(`📚 Base: 4,525 artículos de 7 leyes venezolanas`);
});
