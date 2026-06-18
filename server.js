import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

const app = express();
app.use(cors());
app.use(express.json());

// ========== INICIALIZACIÓN DE SERVICIOS ==========
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { realtime: { transport: WebSocket } }
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ========== MAPEO DE LEYES ==========
const LEY_MAP = {
    1: "Constitución de la República Bolivariana de Venezuela",
    2: "Ley de Propiedad Horizontal",
    3: "Código Civil",
    4: "Código de Comercio",
    5: "Código Orgánico Procesal Penal",
    6: "Código Penal",
    7: "Código de Procedimiento Civil",
    8: "Ley de Arrendamientos Inmobiliarios",
    9: "Ley Orgánica sobre el Derecho de las Mujeres a una Vida Libre de Violencia",
    10: "Ley de Comercialización de Hidrocarburos",
    11: "Ley de Registros"
};

// ========== UTILIDADES ==========
function safeJsonParse(rawText) {
    try {
        return JSON.parse(rawText.trim());
    } catch (e) {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0].trim());
            } catch (innerError) {
                throw new Error(`Imposible parsear JSON: ${innerError.message}`);
            }
        }
        throw e;
    }
}

// ========== FUNCIONES DE BÚSQUEDA EN SUPABASE ==========
async function buscarArticuloEspecifico(leyId, numArticulo) {
    try {
        const cleanNum = numArticulo.toString().trim();
        
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .eq('numero_articulo', cleanNum);

        if (error) {
            console.error("Error SQL:", error);
            return [];
        }
        
        return (data || []).map(art => ({
            id: art.id,
            texto: `Artículo ${art.numero_articulo} (${LEY_MAP[art.ley_id] || 'Ley'}: ${art.contenido})`,
            ley_id: art.ley_id,
            numero_articulo: art.numero_articulo
        }));
    } catch (e) {
        console.error("Error en búsqueda específica:", e);
        return [];
    }
}

async function obtenerArticulosPorLey(leyId, limite = 5) {
    try {
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .limit(limite);
        
        if (error) {
            console.error("Error obteniendo artículos:", error);
            return [];
        }
        
        return (data || []).map(art => ({
            id: art.id,
            texto: `Artículo ${art.numero_articulo} (${LEY_MAP[art.ley_id] || 'Ley'}): ${art.contenido}`,
            ley_id: art.ley_id,
            numero_articulo: art.numero_articulo
        }));
    } catch (e) {
        console.error("Error en obtención de artículos:", e);
        return [];
    }
}

// ========== FILTRO SUPREMO CON GROQ ==========
async function filtrarArticulosRelevantes(pregunta, articulosCandidatos) {
    if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
    
    const promptFiltro = `
    Actúa como un estricto Juez de Admisión. Evalúa cuáles de los siguientes artículos de la ley venezolana tienen relación directa y útil para responder la pregunta del ciudadano.
    
    Pregunta: "${pregunta}"
    
    Artículos Candidatos:
    ${JSON.stringify(articulosCandidatos, null, 2)}
    
    Responde ÚNICAMENTE con un arreglo JSON que contenga los IDs de los artículos admitidos. No agregues saludos, introducciones ni bloques de código markdown.
    Ejemplo de salida: [1, 3, 7]
    `;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: promptFiltro }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        
        const responseText = chatCompletion.choices[0]?.message?.content || "";
        const parsedResponse = safeJsonParse(responseText);
        
        const idsAdmitidos = Array.isArray(parsedResponse) ? parsedResponse : (parsedResponse.ids || []);
        
        if (idsAdmitidos.length > 0) {
            return articulosCandidatos.filter(art => idsAdmitidos.includes(art.id));
        }
        return articulosCandidatos.slice(0, 3);
    } catch (error) {
        console.error("❌ Error en filtro supremo:", error.message);
        return articulosCandidatos.slice(0, 4);
    }
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. CLASIFICACIÓN PROCESAL
        const promptClasificacion = `
        Analiza la siguiente consulta legal de un ciudadano venezolano y clasifícala en formato JSON estricto.
        Leyes disponibles: 1:CRBV, 2:LPH, 3:CCV, 4:CCom, 5:COPP, 6:CP, 7:CPC, 8:Arrendamiento, 9:Violencia, 10:Comercial, 11:Registros.
        
        Consulta: "${pregunta}"

        Campos obligatorios en el JSON:
        {
            "needs_clarification": boolean,
            "clarification_question": string o null,
            "ley_ids": [array de números de leyes relevantes],
            "legal_intent": "string descriptivo de la acción judicial",
            "articulo_num": number o null,
            "text_keywords": ["array", "de", "palabras", "clave"]
        }
        `;

        const resClasificacion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: promptClasificacion }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
        console.log(`${timestamp} ⚖️ Clasificación:`, JSON.stringify(metadata, null, 2));

        // Verificar si necesita aclaración
        if (metadata.needs_clarification && metadata.clarification_question) {
            return res.json({ 
                respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` 
            });
        }

        // 2. RECUPERACIÓN DE ARTÍCULOS
        let articulosCandidatos = [];
        const leyesAUsar = metadata.ley_ids || [];
        
        // A. BÚSQUEDA ESPECÍFICA (Prioridad Alta)
        const leyPrincipal = leyesAUsar.length > 0 ? leyesAUsar[0] : null;
        
        if (metadata.articulo_num && leyPrincipal) {
            console.log(`🔍 Buscando artículo específico ${metadata.articulo_num} en ley ${leyPrincipal}`);
            const artEspecifico = await buscarArticuloEspecifico(leyPrincipal, metadata.articulo_num);
            if (artEspecifico.length > 0) {
                articulosCandidatos = artEspecifico;
            }
        }

        // B. BÚSQUEDA GENERAL (si no se encontró artículo específico)
        if (articulosCandidatos.length === 0 && leyesAUsar.length > 0) {
            console.log(`🔍 Buscando contexto en leyes: ${leyesAUsar.join(', ')}`);
            
            const promesasBusqueda = leyesAUsar.map(leyId => obtenerArticulosPorLey(leyId, 5));
            const resultados = await Promise.all(promesasBusqueda);
            articulosCandidatos = resultados.flat().slice(0, 15);
        }

        // 3. FILTRO SUPREMO
        const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosCandidatos);
        console.log(`${timestamp} ✅ Artículos filtrados: ${articulosFiltrados.length}`);

        // 4. SYSTEM PROMPT DEFINITIVO
        const systemPrompt = `
        Eres "LexnaVe", un ultra-meticuloso Abogado Senior y Experto en Derecho Procesal Civil, Penal y Constitucional Venezolano. 
        Tu misión es orientar al ciudadano con absoluta precisión técnica, pulcritud en los lapsos procesales y un tono firme, pedagógico y profesional.

        ⚠️ REGLAS DOGMÁTICAS INVIOLABLES:

        --- BLOQUE CIVIL Y CONSTITUCIONAL ---
        1. PROHIBICIÓN DEL COMODÍN ORDINARIO: Si el usuario te pregunta por un procedimiento especial (Juicio Breve, Intimación, Estimación de Honorarios, Tránsito, Divorcio por Desafecto), tienes PROHIBIDO usar o rellenar tablas con los lapsos del Juicio Ordinario Civil.
        2. VERDAD CONSTITUCIONAL: La Seguridad de la Nación está consagrada expresamente en el Título VII, Artículo 322 de la CRBV.
        3. PROPIEDAD HORIZONTAL Y MERCANTIL: Problemas de edificios → Ley de Propiedad Horizontal. Pagarés, comerciantes → Código de Comercio.
        4. EXACTITUD EN CONCEPTOS PROCESALES CIVILES: La "Promoción de Pruebas" NO es para presentar la demanda.
        5. PROTOCOLO ANTE VACÍOS CIVILES:
           - Procedimiento Breve (Art. 881 CPC): 10 días de despacho para promover y evacuar.
           - Estimación de Honorarios: Objeción por moderación → 8 días de despacho.
           - Juicio de Intimación (Art. 640 CPC): 10 días de despacho para pagar u oponerse.
           - Divorcio por Desafecto: Jurisdicción voluntaria, audiencia simple.
           - Choque de Carros: Art. 1185 CCV, requiere Acta de Choque.

        --- BLOQUE PENAL Y PROCESAL PENAL ---
        6. MATEMÁTICA ESTRICTA EN FLAGRANCIA (Art. 373 COPP):
           - Detención en flagrancia: 12 horas para poner a disposición del MP.
           - Fiscal: 48 horas para presentar ante Juez de Control.
           - Tiempo total máximo: 60 horas desde la aprehensión.
        7. DURACIÓN DE FASE PREPARATORIA (Art. 295 COPP):
           - Una vez imputado: 6 meses para acto conclusivo.
           - PROHIBIDO afirmar que son 30 días.
        8. FILTRO INVIOLABLE DE PROCEDIBILIDAD (Art. 25 y 391 COPP):
           - Delitos de Acción Privada (Difamación, Injuria): NO acudir a Fiscalía.
           - Única vía: ACUSACIÓN PRIVADA ante Tribunal de Juicio, con abogado.
        9. MECANISMOS DE INICIO DEL PROCESO (Arts. 267 y 274 COPP):
           - DENUNCIA: Notificación informativa ante policía o Fiscalía.
           - QUERELLA: Acto formal de la víctima ante Juez de Control.

        ESTRUCTURA DE TU RESPUESTA:
        - Diseña secciones limpias usando encabezados markdown.
        - Usa tablas solo si conoces los números exactos de días.
        - Cierra siempre con: "⚖️ Esto es orientación general. Consulta con un abogado."
        `;

        const promptFinal = `
        Contexto Legal Seleccionado desde Supabase (Artículos Admitidos):
        ${JSON.stringify(articulosFiltrados, null, 2)}

        Clasificación Interna del Caso:
        ${JSON.stringify(metadata, null, 2)}

        Consulta del Usuario a Resolver:
        "${pregunta}"
        `;

        // 5. GENERACIÓN DE RESPUESTA FINAL
        const responseFinal = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3
        });

        res.json({ respuesta: responseFinal.choices[0]?.message?.content });

    } catch (error) {
        console.error(`❌ Error crítico:`, error);
        res.status(500).json({ 
            respuesta: "⚠️ Se produjo un error procesal en el servidor de LexnaVe. Por favor, reintente su consulta." 
        });
    }
});

// ========== INICIO DEL SERVIDOR ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
});
