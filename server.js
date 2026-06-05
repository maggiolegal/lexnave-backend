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
  console.error("❌ Faltan variables de entorno");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === DICCIONARIO DE TRADUCCIÓN COLOQUIAL A JURÍDICO (MEJORADO) ===
const TRADUCTOR_COLOQUIAL_JURIDICO = {
  'casa': 'inmueble vivienda bien raiz propiedad',
  'carro': 'vehiculo automotor transporte',
  'auto': 'vehiculo automotor transporte',
  'choque': 'accidente transito colision siniestro',
  'chocó': 'accidente transito colision siniestro',
  'golpeó': 'accidente transito colision siniestro',
  'golpeado': 'accidente transito colision siniestro',
  'daño': 'perjuicio menoscabo indemnizacion responsabilidad ilicito',
  'daños': 'perjuicio menoscabo indemnizacion responsabilidad ilicito',
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
  'ruido': 'molestias servidumbres uso disfrute',
  'pegar': 'agresion lesiones violencia fisica golpear maltrato',
  'golpe': 'agresion lesiones violencia fisica',
  'robar': 'hurto robo apropiacion',
  'deuda': 'pago credito obligacion cobro'
};

// === FUNCIÓN MEJORADA: Expandir pregunta con sinónimos ===
function expandirPregunta(pregunta) {
  let preguntaExpandida = pregunta.toLowerCase();
  
  for (const [coloquial, juridico] of Object.entries(TRADUCTOR_COLOQUIAL_JURIDICO)) {
    if (pregunta.toLowerCase().includes(coloquial)) {
      preguntaExpandida += " " + juridico;
      console.log(`📝 Expandido "${coloquial}" → "${juridico}"`);
    }
  }
  
  // Palabras adicionales clave para accidentes de tránsito
  if (pregunta.toLowerCase().includes('carro') || pregunta.toLowerCase().includes('auto') || pregunta.toLowerCase().includes('choque')) {
    preguntaExpandida += " responsabilidad civil extracontractual daños y perjuicios indemnizacion";
  }
  
  return preguntaExpandida;
}

// === FUNCIÓN PRINCIPAL DE BÚSQUEDA ===
async function buscarArticulos(preguntaOriginal) {
  const preguntaExpandida = expandirPregunta(preguntaOriginal);
  console.log("🔍 Pregunta original:", preguntaOriginal);
  console.log("📝 Pregunta expandida:", preguntaExpandida);
  
  // Extraer palabras clave
  const stopWords = ["que","como","para","por","con","sin","una","me","te","le","lo","la","el","los","las","mi","tu","su","y","o","pero","mas","a","ante","bajo","cabe","contra","de","desde","durante","en","entre","hacia","hasta","mediante","segun","so","sobre","tras","versus","via","hago","puedo","debo","tengo","quiero"];
  
  const palabras = preguntaExpandida
    .split(/\s+/)
    .filter(p => p.length > 3 && !stopWords.includes(p))
    .slice(0, 12);
  
  console.log("🔑 Palabras clave:", palabras);
  
  if (palabras.length === 0) return [];
  
  // Construir query de búsqueda
  const query = palabras.map(p => `+${p}`).join(' ');
  
  const { data, error } = await supabase
    .from("articulos")
    .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`)
    .textSearch("contenido", query, { type: "websearch", config: "spanish" })
    .limit(12);
  
  if (error) {
    console.error("❌ Error en búsqueda:", error);
    return [];
  }
  
  console.log(`📊 Artículos encontrados: ${data?.length || 0}`);
  
  // Priorizar artículos relevantes
  const priorizados = (data || []).map(art => {
    let score = 0;
    const contenido = art.contenido.toLowerCase();
    
    if (contenido.includes('responsabilidad civil')) score += 10;
    if (contenido.includes('daños y perjuicios')) score += 10;
    if (contenido.includes('indemnizacion')) score += 8;
    if (contenido.includes('accidente')) score += 8;
    if (contenido.includes('vehiculo')) score += 5;
    
    palabras.forEach(p => {
      if (contenido.includes(p.toLowerCase())) score += 2;
    });
    
    return { ...art, score };
  });
  
  priorizados.sort((a, b) => b.score - a.score);
  
  return priorizados.slice(0, 6);
}

// === ENDPOINT PRINCIPAL ===
app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend funcionando', version: '5.0' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    
    if (!pregunta || pregunta.trim().length < 3) {
      return res.json({ 
        respuesta: "Por favor, formula una pregunta más específica sobre derecho venezolano." 
      });
    }
    
    console.log("=".repeat(50));
    console.log("📨 Pregunta recibida:", pregunta);
    
    // 1. Buscar artículos
    const articulos = await buscarArticulos(pregunta);
    
    if (articulos.length === 0) {
      return res.json({
        respuesta: "No encontré artículos relacionados con tu consulta. Intenta usar palabras más técnicas (ej: 'accidente de tránsito' en lugar de 'choque', 'responsabilidad civil' en lugar de 'quien paga')."
      });
    }
    
    // 2. Construir contexto para Groq
    let contexto = "";
    articulos.forEach((art, idx) => {
      const nombreLey = art.leyes?.nombre || "Ley venezolana";
      contexto += `\n[${idx + 1}] ${nombreLey}\nArtículo ${art.numero_articulo}: ${art.contenido.substring(0, 800)}\n`;
    });
    
    // 3. Prompt para Groq
    const prompt = `Eres LexnaVe, una abogada venezolana experta. Responde basándote ESTRICTAMENTE en los artículos proporcionados.

PREGUNTA DEL USUARIO: "${pregunta}"

ARTÍCULOS ENCONTRADOS (ÚNICA FUENTE VÁLIDA):
${contexto}

INSTRUCCIONES:
1. SOLO usa la información de los artículos mostrados.
2. Cita explícitamente los artículos que uses.
3. Si la pregunta es sobre un accidente de tránsito, prioriza el artículo 1185 del Código Civil si está disponible.
4. Da pasos prácticos basados en los artículos.
5. Incluye al final: "⚖️ Esto es una guía informativa. Consulta con un abogado."

RESPUESTA:`;

    // 4. Llamar a Groq
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1000
      })
    });
    
    const groqData = await groqRes.json();
    let respuesta = "";
    
    if (groqData.choices && groqData.choices[0]) {
      respuesta = groqData.choices[0].message.content;
    } else {
      console.error("❌ Error en Groq:", groqData);
      respuesta = "Error al procesar tu consulta. Intenta nuevamente.";
    }
    
    // 5. Agregar fuentes
    const fuentes = [...new Set(articulos.map(a => `${a.leyes?.nombre || "Ley"} Art. ${a.numero_articulo}`))];
    if (fuentes.length > 0) {
      respuesta += "\n\n📚 **Normas consultadas:**\n" + fuentes.map(f => `• ${f}`).join("\n");
    }
    
    respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta a un abogado para tu caso específico.\n🆘 Emergencias: Defensoría del Pueblo (0800-333-3637).";
    
    res.json({ respuesta, articulos: articulos.map(a => ({ id: a.id, numero_articulo: a.numero_articulo, ley: a.leyes?.nombre })) });
    
  } catch (error) {
    console.error("❌ Error crítico:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente más tarde." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 LexnaVe Backend v5.0 activo en puerto ${PORT}`);
});
