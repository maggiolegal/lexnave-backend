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

// Diccionario de traducción
const TRADUCTOR = {
  'choque': 'accidente transito colision',
  'carro': 'vehiculo automotor',
  'auto': 'vehiculo automotor',
  'golpe': 'accidente colision',
  'daño': 'perjuicio indemnizacion',
  'daños': 'perjuicio indemnizacion'
};

function expandirPregunta(pregunta) {
  let expandida = pregunta.toLowerCase();
  for (const [col, jur] of Object.entries(TRADUCTOR)) {
    if (expandida.includes(col)) expandida += " " + jur;
  }
  if (pregunta.toLowerCase().includes('carro') || pregunta.toLowerCase().includes('choque')) {
    expandida += " responsabilidad civil extracontractual";
  }
  return expandida;
}

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend v5.1', status: 'ok' });
});

app.post('/api/consultar', async (req, res) => {
  try {
    const { pregunta } = req.body;
    console.log("📨 Pregunta:", pregunta);
    
    // Detectar si es artículo específico
    const regexArt = /art[íi]culo\s+(\d+)/i;
    const matchArt = pregunta.match(regexArt);
    
    if (matchArt) {
      const numArt = matchArt[1];
      const { data } = await supabase
        .from("articulos")
        .select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`)
        .eq("numero_articulo", numArt)
        .limit(5);
      
      if (data && data.length > 0) {
        const articulos = data.map(a => ({ ...a, nombre_ley: a.leyes?.nombre || "Ley" }));
        const contexto = articulos.map(a => `📜 ${a.nombre_ley}\nArtículo ${a.numero_articulo}: ${a.contenido.substring(0, 800)}`).join('\n');
        
        const prompt = `Eres LexnaVe, abogada venezolana. Responde SOLO con el texto del artículo.\n\n${contexto}\n\nPregunta: "${pregunta}"`;
        
        const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.1 })
        });
        const groqData = await groqRes.json();
        const respuesta = groqData.choices?.[0]?.message?.content || "Artículo encontrado pero error al procesar.";
        
        return res.json({ respuesta });
      }
    }
    
    // Búsqueda normal con ILIKE (fallback)
    const expandida = expandirPregunta(pregunta);
    const palabras = expandida.split(/\s+/).filter(p => p.length > 3).slice(0, 8);
    
    if (palabras.length === 0) {
      return res.json({ respuesta: "No entendí tu consulta. Intenta ser más específico." });
    }
    
    // Construir query OR con ilike
    let query = supabase.from("articulos").select(`id, numero_articulo, contenido, ley_id, leyes (nombre)`);
    for (const p of palabras) {
      query = query.or(`contenido.ilike.%${p}%`);
    }
    const { data } = await query.limit(10);
    
    if (!data || data.length === 0) {
      return res.json({ respuesta: "No encontré artículos relacionados. Intenta con palabras más técnicas como 'accidente de tránsito', 'responsabilidad civil', 'daños y perjuicios'." });
    }
    
    const articulos = data.map(a => ({ ...a, nombre_ley: a.leyes?.nombre || "Ley" }));
    const contexto = articulos.map(a => `📜 ${a.nombre_ley}\nArtículo ${a.numero_articulo}: ${a.contenido.substring(0, 800)}`).join('\n');
    
    const prompt = `Eres LexnaVe, abogada venezolana. Responde basándote ESTRICTAMENTE en los artículos.\n\n${contexto}\n\nPregunta: "${pregunta}"\n\nInstrucciones: Cita los artículos. Da pasos prácticos. Incluye aviso legal.`;
    
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.2 })
    });
    const groqData = await groqRes.json();
    let respuesta = groqData.choices?.[0]?.message?.content || "Error al generar respuesta.";
    
    const fuentes = [...new Set(articulos.map(a => `${a.leyes?.nombre || "Ley"} Art. ${a.numero_articulo}`))];
    respuesta += "\n\n📚 **Normas consultadas:**\n" + fuentes.map(f => `• ${f}`).join("\n");
    respuesta += "\n\n---\n⚖️ **Aviso Legal**: Orientación general. Consulta con un abogado.\n🆘 Emergencias: Defensoría del Pueblo (0800-333-3637).";
    
    res.json({ respuesta });
    
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ respuesta: "Error técnico. Intenta nuevamente." });
  }
});

app.listen(PORT, () => console.log(`🚀 Backend activo en puerto ${PORT}`));
