import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { realtime: { transport: WebSocket } }
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ========== BÚSQUEDA ESPECÍFICA (Prioridad Alta) ==========
async function buscarArticuloEspecifico(leyId, numArticulo) {
    try {
        // Convertimos el número a string limpio
        const cleanNum = numArticulo.toString().trim();
        
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido')
            .eq('ley_id', parseInt(leyId))
            .eq('numero_articulo', cleanNum); // Sin .limit(1) si hay duplicados, pero debería haber uno

        if (error) {
            console.error("Error SQL:", error);
            return null;
        }
        
        return data.map(art => ({
            id: art.id,
            texto: `Artículo ${art.numero_articulo}: ${art.contenido}`,
            ley_id: leyId
        }));
    } catch (e) { return null; }
}

async function obtenerArticulosPorLey(leyId) {
    try {
        // Limitamos a 3 para no saturar el contexto
        let { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido')
            .eq('ley_id', leyId)
            .limit(3);
        
        return (data || []).map(art => ({
            id: art.id,
            texto: `Artículo ${art.numero_articulo}: ${art.contenido}`,
            ley_id: leyId
        }));
    } catch (e) { return []; }
}

/**
 * ENDPOINT PRINCIPAL
 */
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    console.log(`📨 Pregunta: ${pregunta}`);

    try {
        // 1. Clasificación Procesal
        const promptClasificacion = `Analiza: "${pregunta}". 
            Responde un JSON estricto con: ley_ids (array de números), articulo_num (número o null).
            Leyes disponibles: 1:CRBV, 2:LPH, 3:CCV, 4:CCom, 5:COPP, 6:CP, 7:CPC, 8:Arrendamiento, 9:Violencia, 10:Comercial, 11:Registros.`;
        const resClasificacion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: promptClasificacion }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0,
            response_format: { type: "json_object" }
        });

        // 1. Clasificación (Se mantiene igual, recibiendo un array de IDs)
        const metadata = JSON.parse(resClasificacion.choices[0].message.content);
        console.log(`⚖️ Metadata:`, metadata);

        // 2. RECUPERACIÓN MULTI-LEY
        let articulosFiltrados = [];
        const leyesAUsar = metadata.ley_ids || []; // Asegúrate de que esto sea un array [1, 2, ...]

        // A. PRIORIDAD ALTA: Si el usuario pide un artículo específico, buscarlo primero
        // Asumimos que si pide un artículo, también indica la ley asociada (ley_id o ley_ids[0])
        const leyPrincipal = metadata.ley_id || (leyesAUsar.length > 0 ? leyesAUsar[0] : null);
        
        if (metadata.articulo_num && leyPrincipal) {
            const artEspecifico = await buscarArticuloEspecifico(leyPrincipal, metadata.articulo_num);
            if (artEspecifico) {
                articulosFiltrados = artEspecifico;
            }
        }

        // B. RECUPERACIÓN GENERAL (En paralelo para todas las leyes detectadas)
        // Solo buscamos contexto general si no encontramos el artículo o si la búsqueda fue abierta
        if (articulosFiltrados.length === 0 && leyesAUsar.length > 0) {
            console.log(`🔍 Buscando contexto en leyes: ${leyesAUsar.join(', ')}`);
            
            // Ejecutamos las búsquedas de todas las leyes simultáneamente
            const promesasBusqueda = leyesAUsar.map(leyId => obtenerArticulosPorLey(leyId));
            const resultados = await Promise.all(promesasBusqueda);
            
            // Aplanamos el resultado y limitamos para no sobrecargar el prompt
            articulosFiltrados = resultados.flat().slice(0, 15);
        }

        // 3. Generación de Respuesta (System Prompt)
        // ... (Tu código actual de Groq sigue aquí usando el articulosFiltrados ya lleno)
        // 3. Prompt Final con instrucción estricta de citación
        const systemPrompt = `Eres LexnaVe, experta en leyes venezolanas.
        REGLA DE ORO: Si el usuario pide un artículo y está en el contexto, cítalo textualmente.
        Si NO está en el contexto, indícalo claramente y no inventes.
        Responde con un tono profesional, pedagógico y empático.`;

        const promptFinal = `Contexto legal: ${JSON.stringify(articulosFiltrados)}
        Consulta: "${pregunta}"`;

        const responseFinal = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2
        });

        res.json({ respuesta: responseFinal.choices[0].message.content });

    } catch (error) {
        console.error(error);
        res.status(500).json({ respuesta: "Error procesando tu consulta." });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 LexnaVe activo en puerto ${PORT}`));
