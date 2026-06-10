import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || "https://dhcacnfuummsgpxujpjz.supabase.co",
  process.env.SUPABASE_KEY // Usa SERVICE_ROLE KEY
);

async function generarFigurasJuridicas(contenidoArticulo) {
  const prompt = `Eres un experto en derecho venezolano. Identifica las 3-5 FIGURAS JURÍDICAS DOGMÁTICAS más precisas que definen este artículo legal. Responde SOLO con los términos separados por comas, sin explicaciones ni markdown.

ARTÍCULO: "${contenidoArticulo.substring(0, 500)}..."

FIGURAS:`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}` 
      },
      body: JSON.stringify({ 
        model: "llama-3.1-8b-instant", 
        messages: [{ role: "user", content: prompt }], 
        temperature: 0.0 
      })
    });
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ Error generando figuras:", error);
    return null;
  }
}

async function enriquecerTodosLosArticulos() {
  console.log("🚀 Iniciando enriquecimiento semántico masivo...");
  
  // Obtener TODOS los artículos de TODAS las leyes
  const { data: articulos, error } = await supabase
    .from('articulos')
    .select('id, contenido, numero_articulo, leyes(nombre)')
    .limit(10000); // Ajusta según volumen total

  if (error || !articulos?.length) {
    console.error("❌ Error obteniendo artículos:", error);
    return;
  }

  console.log(`📦 Procesando ${articulos.length} artículos...`);
  let procesados = 0;

  for (const art of articulos) {
    try {
      // Generar figuras dogmáticas
      const figuras = await generarFigurasJuridicas(art.contenido);
      
      if (!figuras) {
        console.warn(`⚠️ Saltando Art. ${art.numero_articulo} (${art.leyes?.nombre}): Fallo en IA`);
        continue;
      }

      // Crear texto enriquecido
      const textoEnriquecido = `[FIGURAS_JURIDICAS: ${figuras}] ${art.contenido}`;

      // Actualizar en Supabase (esto dispara regeneración automática del embedding si tienes trigger)
      const { error: updateError } = await supabase
        .from('articulos')
        .update({ contenido_enriquecido: textoEnriquecido }) // Campo nuevo o sobrescribe 'contenido'
        .eq('id', art.id);

      if (updateError) throw updateError;

      procesados++;
      console.log(`✅ [${procesados}/${articulos.length}] Art. ${art.numero_articulo} ${art.leyes?.nombre}: ${figuras}`);
      
      // Pausa breve para no saturar API de Groq
      await new Promise(r => setTimeout(r, 200)); 

    } catch (err) {
      console.error(`❌ Error en Art. ${art.numero_articulo}:`, err.message);
    }
  }

  console.log(`🎉 Enriquecimiento completado: ${procesados}/${articulos.length} artículos procesados.`);
}

// Ejecutar
enriquecerTodosLosArticulos();
