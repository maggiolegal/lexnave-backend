import { createClient } from '@supabase/supabase-js';
import { pipeline } from '@xenova/transformers';
console.log("🚀 INICIANDO PROCESO DE LLENADO DE EMBEDDINGS - VERSIÓN 2");
// Configuración
const SUPABASE_URL = "https://dhcacnfuummsgpxujpjz.supabase.co";
const SUPABASE_KEY = "sb_publishable_pIYUap3GDuL7xqwP0CCCWA_WrUPp1aN"; // <--- PEGA TU CLAVE AQUÍ

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function generarYGuardarEmbeddings() {
  console.log("🧠 Cargando modelo local...");
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  
  console.log("📥 Obteniendo artículos sin embedding...");
  const { data: articulos, error } = await supabase
    .from('articulos')
    .select('id, contenido')
    .is('embedding', null) 
    .limit(100); 

  if (error) {
    console.error("Error al obtener artículos:", error);
    return;
  }

  console.log(`🔄 Procesando ${articulos.length} artículos...`);

  for (const art of articulos) {
    try {
      // Generar vector
      const output = await extractor(art.contenido, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);

      // Guardar en Supabase
      const { error: updateError } = await supabase
        .from('articulos')
        .update({ embedding: embedding })
        .eq('id', art.id);

      if (updateError) throw updateError;
      console.log(`✅ Artículo ${art.id} actualizado.`);
      
    } catch (err) {
      console.error(`❌ Error en artículo ${art.id}:`, err);
    }
  }
  
  console.log("🎉 Proceso finalizado.");
}

generarYGuardarEmbeddings();
