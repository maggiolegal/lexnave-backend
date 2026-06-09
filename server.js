import { createClient } from '@supabase/supabase-js';
import { pipeline } from '@xenova/transformers';
import ws from 'ws';

console.log("🚀 INICIANDO PROCESO DE LLENADO COMPLETO DE EMBEDDINGS");

const SUPABASE_URL = "https://dhcacnfuummsgpxujpjz.supabase.co";
const SUPABASE_KEY = "sb_publishable_pIYUap3GDuL7xqwP0CCCWA_WrUPp1aN"; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { transport: ws }
});

let totalProcesados = 0;

async function generarYGuardarEmbeddings() {
  console.log("🧠 Cargando modelo local...");
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  
  console.log("📥 Obteniendo TODOS los artículos sin embedding...");
  
  // Quitamos el .limit(100) para traer todos los que falten
  const { data: articulos, error } = await supabase
    .from('articulos')
    .select('id, contenido')
    .is('embedding', null); 

  if (error) {
    console.error("Error al obtener artículos:", error);
    return;
  }

  if (!articulos || articulos.length === 0) {
    console.log("✅ ¡Todos los artículos ya tienen embeddings!");
    return;
  }

  console.log(`🔄 Iniciando procesamiento de ${articulos.length} artículos restantes...`);

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
      
      totalProcesados++;
      // Mostramos progreso cada 10 artículos para no llenar tanto el log
      if (totalProcesados % 10 === 0) {
        console.log(`📊 Progreso: ${totalProcesados} artículos procesados.`);
      }
      
    } catch (err) {
      console.error(`❌ Error en artículo ${art.id}:`, err.message);
    }
  }
  
  console.log(`🎉 PROCESO FINALIZADO. Total actualizados en esta sesión: ${totalProcesados}`);
}

generarYGuardarEmbeddings();
