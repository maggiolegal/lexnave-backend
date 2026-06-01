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

// Palabras clave legales venezolanas para mejorar la búsqueda
const PALABRAS_CLAVE_LEGALES = [
  'divorcio', 'custodia', 'pensión', 'alimentos', 'herencia', 'sucesión',
  'contrato', 'despido', 'laboral', 'penal', 'delito', 'demanda',
  'propiedad', 'arrendamiento', 'consumidor', 'tránsito', 'familia',
  'menor', 'violencia', 'género', 'trabajo', 'prestaciones', 'vacaciones',
  'seguro social', 'ivss', 'lopti', 'lopcymat', 'código civil', 'código penal',
  'constitución', 'tribunal', 'juez', 'sentencia', 'recurso', 'amparo'
];

app.get('/', (req, res) => {
  res.json({ 
    message: 'LexnaVe Backend funcionando',
    version: '2.0',
    especialidad: 'Derecho Venezolano'
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
    
    // 1. MEJORA: Búsqueda semántica más inteligente
    const palabrasClave = extraerPalabrasClave(pregunta);
    const queryBusqueda = construirQueryBusqueda(palabrasClave);
    
    console.log("📝 Query de búsqueda:", queryBusqueda);
    
    // Búsqueda en Supabase con mejor configuración
    const { data: articulos, error } = await supabase
      .from("articulos")
      .select(`
        id, 
        numero_articulo, 
        contenido, 
        ley_id,
        leyes (nombre, tipo_ley)
      `)
      .textSearch("contenido", queryBusqueda, {
        type: "websearch",
        config: "spanish"
      })
      .order('ley_id')
      .limit(8); // Aumentamos a 8 para tener más contexto
    
    if (error) {
      console.error("❌ Error específico de Supabase:", error);
      return res.json({ 
        respuesta: "Error en base de datos. Por favor, intenta nuevamente.", 
        articulos: [] 
      });
    }
    
    console.log(`📊 Artículos encontrados: ${articulos ? articulos.length : 0}`);
    
    // 2. MEJORA: Filtrar y priorizar artículos relevantes
    const resultados = filtrarYPriorizarArticulos(articulos || [], pregunta);
    
    console.log(`✅ Artículos relevantes después del filtrado: ${resultados.length}`);
    
    // 3. MEJORA: Generar respuesta con Groq usando prompt profesional
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
              content: "Eres LexnaVe, una asistente legal especializada en derecho venezolano. Tu objetivo es proporcionar orientación jurídica clara, precisa y basada exclusivamente en la legislación venezolana vigente."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.2,
          max_tokens: 1000,
          top_p: 0.9
        })
      });
      
      const groqData = await groqRes.json();
      
      if (groqData.choices && groqData.choices[0]) {
        respuesta = groqData.choices[0].message.content;
        
        // Extraer fuentes citadas
        fuentesCitadas = extraerFuentesCitadas(resultados, respuesta);
      } else {
        console.error("❌ Error en respuesta de Groq:", groqData);
        respuesta = "⚠️ Hubo un error al procesar tu consulta. Por favor, intenta nuevamente.";
      }
      
    } else {
      respuesta = generarRespuestaSinResultados(pregunta);
    }
    
    // 4. MEJORA: Formatear respuesta final
    const respuestaFinal = formatearRespuestaFinal(respuesta, fuentesCitadas, resultados.length > 0);
    
    res.json({ 
      respuesta: respuestaFinal, 
      articulos: resultados.slice(0, 5), // Limitamos a 5 para no saturar
      meta: {
        total_articulos_encontrados: resultados.length,
        consulta_procesada: true
      }
    });
    
  } catch (error) {
    console.error("❌ Error crítico en backend:", error.message);
    res.status(500).json({ 
      respuesta: "Lo sentimos, hubo un error técnico. Por favor, intenta nuevamente más tarde.", 
      articulos: [] 
    });
  }
});

// === FUNCIONES AUXILIARES MEJORADAS ===

function extraerPalabrasClave(pregunta) {
  const stopWords = ["me", "quiero", "tengo", "la", "el", "los", "las", "un", "una", "de", "del", "como", "en", "qué", "que", "por", "para", "con", "sin", "sobre", "entre"];
  
  // Convertir a minúsculas y dividir
  let palabras = pregunta.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .split(/\s+/)
    .filter(p => !stopWords.includes(p) && p.length > 2);
  
  // Agregar palabras clave legales si están presentes
  const palabrasLegalesEncontradas = PALABRAS_CLAVE_LEGALES.filter(keyword => 
    pregunta.toLowerCase().includes(keyword)
  );
  
  // Combinar y eliminar duplicados
  const todasPalabras = [...new Set([...palabras, ...palabrasLegalesEncontradas])];
  
  return todasPalabras.slice(0, 10); // Máximo 10 palabras clave
}

function construirQueryBusqueda(palabrasClave) {
  if (palabrasClave.length === 0) return "";
  
  // Usar operadores booleanos para mejor precisión
  // Palabras obligatorias con +, opcionales sin nada
  const palabrasObligatorias = palabrasClave.slice(0, 3);
  const palabrasOpcionales = palabrasClave.slice(3);
  
  let query = palabrasObligatorias.map(p => `+${p}`).join(" ");
  
  if (palabrasOpcionales.length > 0) {
    query += " " + palabrasOpcionales.join(" ");
  }
  
  return query;
}

function filtrarYPriorizarArticulos(articulos, pregunta) {
  if (!articulos || articulos.length === 0) return [];
  
  // Priorizar artículos de leyes fundamentales
  const leyesFundamentales = [
    'Constitución de la República Bolivariana de Venezuela',
    'Código Civil',
    'Código Penal',
    'Ley Orgánica del Trabajo'
  ];
  
  // Score de relevancia simple basado en coincidencias de palabras
  const palabrasPregunta = pregunta.toLowerCase().split(/\s+/);
  
  const articulosConScore = articulos.map(art => {
    let score = 0;
    const contenidoLower = art.contenido.toLowerCase();
    
    // Verificar si es ley fundamental
    if (art.leyes && leyesFundamentales.some(ley => art.leyes.nombre?.includes(ley))) {
      score += 10;
    }
    
    // Contar coincidencias de palabras clave
    palabrasPregunta.forEach(palabra => {
      if (palabra.length > 3 && contenidoLower.includes(palabra)) {
        score += 1;
      }
    });
    
    return { ...art, score };
  });
  
  // Ordenar por score descendente y tomar los mejores
  return articulosConScore
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function construirContextoLegal(articulos) {
  let contexto = "";
  
  articulos.forEach((art, index) => {
    const nombreLey = art.leyes?.nombre || "Ley venezolana";
    const tipoLey = art.leyes?.tipo_ley || "";
    
    contexto += `\n[${index + 1}] ${nombreLey} ${tipoLey ? `(${tipoLey})` : ''}\n`;
    contexto += `Artículo ${art.numero_articulo}: ${art.contenido}\n`;
    contexto += `---\n`;
  });
  
  return contexto;
}

function crearPromptProfesional(pregunta, contextoLegal) {
  return `
CONTEXTO LEGAL VENEZOLANO:
${contextoLegal}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES PARA RESPONDER:

1. **BASE LEGAL**: Responde BASÁNDOTE EXCLUSIVAMENTE en los artículos proporcionados arriba. NO inventes normas ni cites artículos que no estén en el contexto.

2. **ESTRUCTURA DE RESPUESTA**:
   - Comienza con una respuesta directa y clara a la pregunta
   - Explica brevemente el fundamento legal
   - Cita los artículos específicos que aplican
   - Si hay procedimientos mencionados, descríbelos paso a paso

3. **TONO Y ESTILO**:
   - Usa lenguaje claro y accesible para ciudadanos comunes
   - Sé profesional pero empático
   - Evita tecnicismos innecesarios o explícalos cuando los uses

4. **LIMITACIONES**:
   - Si los artículos proporcionados NO responden completamente la pregunta, dilo claramente
   - NO proporciones asesoramiento legal personalizado
   - NO predigas resultados de casos específicos
   - SIEMPRE incluye el disclaimer final

5. **FORMATO**:
   - Usa párrafos cortos y claros
   - Usa viñetas para listar puntos importantes
   - Destaca números de artículos y nombres de leyes

RESPUESTA:`;
}

function extraerFuentesCitadas(articulos, respuesta) {
  // Extraer referencias a artículos mencionados en la respuesta
  const fuentes = [];
  const regexArticulo = /Art[íi]culo\s+(\d+)/gi;
  const coincidencias = [...respuesta.matchAll(regexArticulo)];
  
  coincidencias.forEach(match => {
    const numArticulo = match[1];
    const articuloEncontrado = articulos.find(a => a.numero_articulo === numArticulo);
    
    if (articuloEncontrado && articuloEncontrado.leyes) {
      fuentes.push({
        ley: articuloEncontrado.leyes.nombre,
        articulo: numArticulo
      });
    }
  });
  
  // Eliminar duplicados
  return [...new Map(fuentes.map(item => [`${item.ley}-${item.articulo}`, item])).values()];
}

function generarRespuestaSinResultados(pregunta) {
  // Detectar si es una pregunta legal válida
  const esPreguntaLegal = PALABRAS_CLAVE_LEGALES.some(keyword => 
    pregunta.toLowerCase().includes(keyword)
  );
  
  if (esPreguntaLegal) {
    return `No encontré información específica en mi base de datos para tu consulta sobre "${pregunta}". 

Esto puede deberse a que:
• La norma no está cargada aún en nuestro sistema
• Necesitas usar términos más específicos

Te sugiero:
1. Reformular tu pregunta con palabras clave como: divorcio, custodia, contrato, despido, etc.
2. Consultar directamente el texto de la ley en gaceta oficial
3. Buscar asesoría de un abogado especializado

Recuerda que las leyes venezolanas se encuentran en la Gaceta Oficial de la República Bolivariana de Venezuela.`;
  } else {
    return `Parece que tu consulta no está relacionada con derecho venezolano. 

LexnaVe está especializada en proporcionar orientación sobre:
• Derecho de familia (divorcio, custodia, pensiones)
• Derecho laboral (despidos, prestaciones, contratos)
• Derecho civil (contratos, propiedad, herencias)
• Derecho penal (delitos, procedimientos)
• Derecho constitucional y administrativo

Por favor, formula una pregunta específica sobre alguno de estos temas.`;
  }
}

function formatearRespuestaFinal(respuestaIA, fuentesCitadas, hayResultados) {
  let respuestaFormateada = respuestaIA;
  
  // Agregar fuentes si existen
  if (fuentesCitadas.length > 0) {
    respuestaFormateada += "\n\n📚 **Fuentes legales consultadas:**";
    fuentesCitadas.forEach(fuente => {
      respuestaFormateada += `\n• ${fuente.ley} - Artículo ${fuente.articulo}`;
    });
  }
  
  // Agregar disclaimer obligatorio
  respuestaFormateada += "\n\n---\n";
  respuestaFormateada += "⚖️ **Importante**: LexnaVe proporciona orientación legal general basada en la legislación venezolana vigente. Esta información no constituye asesoramiento legal personalizado. Para tu caso específico, te recomendamos consultar con un abogado colegiado en Venezuela.\n";
  respuestaFormateada += "📞 En caso de emergencia legal, contacta al Defensor del Pueblo o busca asistencia jurídica gratuita en tribunales venezolanos.";
  
  return respuestaFormateada;
}

app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend v2.0 iniciado en puerto ${PORT}`);
  console.log(`📍 Especializado en Derecho Venezolano`);
});
