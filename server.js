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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================== CONSULTAR DICCIONARIO ====================
async function buscarEnDiccionario(pregunta) {
  const palabrasClave = pregunta.toLowerCase().split(/\s+/).filter(p => p.length > 3).slice(0, 5);
  if (palabrasClave.length === 0) return null;
  
  for (const palabra of palabrasClave) {
    const { data, error } = await supabase
      .from("diccionario")
      .select("termino, definicion")
      .ilike("termino", `%${palabra}%`)
      .limit(1);
    
    if (data && data.length > 0 && !error) {
      console.log(`📖 Diccionario encontrado: ${data[0].termino}`);
      return data[0];
    }
  }
  return null;
}

// ==================== BUSCAR EN LEYES ====================
async function buscarEnLeyes(pregunta) {
  // Extraer términos importantes
  const terminos = pregunta.toLowerCase()
    .replace(/[¿?¡!.,;:()]/g, '')
    .split(/\s+/)
    .filter(p => p.length > 3 && !['como', 'para', 'por', 'con', 'sin', 'una', 'me', 'te', 'le', 'lo', 'la', 'el', 'los', 'las', 'mi', 'tu', 'su', 'y', 'o', 'pero', 'mas', 'a', 'ante', 'bajo', 'cabe', 'contra', 'de', 'desde', 'durante', 'en', 'entre', 'hacia', 'hasta', 'mediante', 'segun', 'so', 'sobre', 'tras', 'versus', 'via', 'que', 'dice', 'dijo', 'hace', 'hizo', 'todos', 'todas', 'ente', 'sera', 'seran', 'puede', 'pueden', 'debe', 'deben', 'través', 'solo', 'sino', 'mismo', 'misma', 'tales', 'cual', 'cuya', 'cuyo', 'segun', 'sin', 'bajo', 'entre', 'hasta', 'desde', 'pepe', 'qué', 'hago', 'hacen', 'hacer', 'más', 'muy', 'poco', 'mucho', 'bien', 'mal', 'ahora', 'después', 'antes', 'siempre', 'nunca', 'también', 'tampoco', 'donde', 'adonde', 'quien', 'quienes', 'cuyo', 'cuya', 'cuyos', 'cuyas', 'esto', 'eso', 'aquello', 'este', 'ese', 'aquel', 'estos', 'esos', 'aquellos', 'esta', 'esa', 'aquella', 'estas', 'esas', 'aquellas'])
    .slice(0, 6);
  
  if (terminos.length === 0) return [];
  
  // Construir búsqueda OR con ilike
  let query = supabase
    .from("articulos")
    .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
  
  for (const term of terminos) {
    query = query.or(`contenido.ilike.%${term}%`);
  }
  
  const { data, error } = await query.limit(8);
  
  if (error || !data || data.length === 0) return [];
  
  // Calcular relevancia y priorizar
  return data.map(art => {
    let score = 0;
    const contenidoLow = art.contenido.toLowerCase();
    for (const term of terminos) {
      if (contenidoLow.includes(term)) score++;
    }
    return { ...art, score, nombre_ley: art.leyes?.nombre || "Ley venezolana" };
  }).sort((a, b) => b.score - a.score);
}

// ==================== GENERAR RESPUESTA CON GROQ ====================
async function generarRespuestaGroq(pregunta, contexto, esDiccionario = false) {
  const tipoFuente = esDiccionario ? "del DICCIONARIO JURÍDICO" : "de los ARTÍCULOS DE LEY";
  
  const prompt = `Eres LexnaVe, una abogada venezolana experta. Responde basándote ESTRICTAMENTE en la información proporcionada ${tipoFuente}.

INFORMACIÓN ENCONTRADA:
${contexto}

PREGUNTA DEL USUARIO: "${pregunta}"

INSTRUCCIONES:
1. SOLO usa la información proporcionada.
2. Si es del diccionario, explica el término claramente.
3. Si son artículos de ley, cítalos explícitamente.
4. Da pasos prácticos según corresponda.
5. Incluye al final: "⚖️ Esto es una guía informativa. Consulta con un abogado para tu caso específico."

RESPUESTA:`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 800
    })
  });
  
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No se pudo generar una respuesta.";
}

// ==================== ENDPOINT PRINCIPAL ====================
app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend v7.0', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // CASO 1: Búsqueda por artículo específico
    const regexArt = /art[íi]culo\s+(\d+)(?:\s+(?:del|de la|de)\s+([a-záéíóúñ\s]+))?/i;
    const matchArt = pregunta.match(regexArt);
    
    if (matchArt) {
      const numArt = matchArt[1];
      let leyNombre = matchArt[2] || '';
      leyNombre = leyNombre.toLowerCase().trim();
      
      let query = supabase.from("articulos").select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`).eq("numero_articulo", numArt);
      
      if (leyNombre) {
        query = query.ilike("leyes.nombre", `%${leyNombre}%`);
      }
      
      const { data, error } = await query.limit(3);
      
      if (data && data.length > 0) {
        const articulos = data.map(a => ({ ...a, nombre_ley: a.leyes?.nombre || "Ley" }));
        const contexto = articulos.map(a => `📜 ${a.nombre_ley}\nArtículo ${a.numero_articulo}: ${a.contenido.substring(0, 800)}`).join('\n\n');
        const respuesta = await generarRespuestaGroq(pregunta, contexto, false);
        return res.json({ respuesta });
      }
    }
    
    // CASO 2: Buscar en diccionario jurídico primero
    console.log("📖 Buscando en diccionario jurídico...");
    const definicion = await buscarEnDiccionario(pregunta);
    
    if (definicion) {
      console.log("✅ Diccionario encontrado");
      const contexto = `📚 TÉRMINO JURÍDICO: ${definicion.termino}\nDEFINICIÓN: ${definicion.definicion.substring(0, 800)}`;
      const respuesta = await generarRespuestaGroq(pregunta, contexto, true);
      return res.json({ respuesta });
    }
    
    // CASO 3: Buscar en artículos de leyes
    console.log("⚖️ Buscando en artículos de leyes...");
    const articulos = await buscarEnLeyes(pregunta);
    
    if (articulos.length > 0) {
      const contexto = articulos.slice(0, 4).map(a => 
        `📜 ${a.nombre_ley}\nArtículo ${a.numero_articulo}: ${a.contenido.substring(0, 800)}`
      ).join('\n\n');
      const respuesta = await generarRespuestaGroq(pregunta, contexto, false);
      return res.json({ respuesta });
    }
    
    // CASO 4: No se encontró nada
    res.json({ respuesta: "No encontré información sobre tu consulta en el diccionario jurídico ni en las leyes. Intenta con otras palabras o pregunta por un artículo específico (ej: 'artículo 1185 del código civil')." });
    
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 LexnaVe Backend v7.0 activo en puerto ${PORT}`));
