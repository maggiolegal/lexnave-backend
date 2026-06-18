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
            numero_articulo: art.numero_articulo,
            contenido: art.contenido
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
            numero_articulo: art.numero_articulo,
            contenido: art.contenido
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
            
            const promesasBusqueda = leyesAUsar.map(leyId => obtenerArticulosPorLey(leyId, 8));
            const resultados = await Promise.all(promesasBusqueda);
            articulosCandidatos = resultados.flat().slice(0, 20);
        }

        // 3. FILTRO SUPREMO
        const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosCandidatos);
        console.log(`${timestamp} ✅ Artículos filtrados: ${articulosFiltrados.length}`);

        // 4. SYSTEM PROMPT DEFINITIVO MEJORADO
        const systemPrompt = `
        Eres "LexnaVe", un Abogado Senior y Experto en Derecho Procesal Civil, Penal y Constitucional Venezolano con 20 años de experiencia.

        ⚠️ **INSTRUCCIONES ESTRICTAS DE FORMATO DE RESPUESTA:**

        Tu respuesta DEBE seguir esta estructura OBLIGATORIAMENTE:

        1. **INTRODUCCIÓN CLARA**: Inicia con un resumen ejecutivo de 2-3 líneas que responda directamente a la consulta.

        2. **FUNDAMENTOS LEGALES**: Enumera con números los artículos relevantes, incluyendo:
           - **Artículo X de la Ley Y**: "Texto exacto del artículo entre comillas"
           - Explicación breve de cómo aplica al caso

        3. **ACCIONES RECOMENDADAS**: Lista numerada de pasos prácticos que puede tomar el ciudadano

        4. **ADVERTENCIA FINAL**: "⚖️ Esto es orientación general. Consulta con un abogado."

        **REGLAS DOGMÁTICAS INVIOLABLES:**

        --- BLOQUE CIVIL Y CONSTITUCIONAL ---
        1. **CITACIÓN OBLIGATORIA**: Cada afirmación DEBE ir acompañada del artículo exacto con su texto literal.
        2. **PROHIBICIÓN DEL COMODÍN ORDINARIO**: Procedimientos especiales tienen lapsos específicos:
           - Juicio Breve: 10 días hábiles (Art. 881 CPC)
           - Estimación de Honorarios: 8 días (Art. 22 Ley de Abogados)
           - Juicio de Intimación: 10 días (Art. 640 CPC)
        3. **VERDAD CONSTITUCIONAL**: Seguridad de la Nación → Art. 322 CRBV
        4. **PROPIEDAD HORIZONTAL**: Problemas de condominio → LPH, Art. 5 (cuotas), Art. 14 (cobro ejecutivo)
        5. **RESPONSABILIDAD CIVIL**: Daños → Art. 1185 CCV

        --- BLOQUE PENAL ---
        6. **FLAGRANCIA**: 12h policía + 48h fiscal = 60h máximo (Art. 373 COPP)
        7. **ACTO CONCLUSIVO**: 6 meses desde imputación (Art. 295 COPP)
        8. **ACCIÓN PRIVADA**: Difamación, injuria → ACUSACIÓN PRIVADA (NO Fiscalía)

        **EJEMPLO DE RESPUESTA ESPERADA:**
        "En Venezuela, la actuación de tu vecino al prohibirte el acceso a tu propiedad es ilegal y arbitraria. Ninguna instancia de condominio tiene facultades para restringir el acceso a tu vivienda como medida de presión por deudas.

        1. **Derecho a la Propiedad (Art. 115 CRBV)**: "Se garantiza el derecho de propiedad. Toda persona tiene derecho al uso, goce, disfrute y disposición de sus bienes." El bloqueo de acceso vulnera directamente este derecho constitucional.

        2. **Prohibición de vías de hecho**: El Art. 548 del Código Civil establece que "nadie puede hacer justicia por sí mismo". La Junta de Condominio debe seguir el procedimiento de cobro ejecutivo del Art. 14 de la LPH, no restringir el acceso.

        **ACCIONES RECOMENDADAS:**
        1. **Intimación por escrito**: Solicita formalmente el restablecimiento del acceso.
        2. **Amparo constitucional**: Interpón acción de amparo por violación al derecho de propiedad.
        3. **Denuncia penal**: Acude al Ministerio Público por coacción o privación ilegítima.

        ⚖️ Esto es orientación general. Consulta con un abogado."
        `;

        // Construir prompt final con contexto mejorado
        let contextoLegal = "";
        if (articulosFiltrados.length > 0) {
            contextoLegal = articulosFiltrados.map(art => 
                `- Artículo ${art.numero_articulo} de ${LEY_MAP[art.ley_id] || 'Ley'}: "${art.contenido}"`
            ).join('\n');
        } else {
            contextoLegal = "No se encontraron artículos específicos en la base de datos para esta consulta.";
        }

        const promptFinal = `
        **CONTEXTO LEGAL DISPONIBLE:**
        ${contextoLegal}

        **CLASIFICACIÓN DEL CASO:**
        ${JSON.stringify(metadata, null, 2)}

        **CONSULTA DEL USUARIO:**
        "${pregunta}"

        **INSTRUCCIÓN:** Basándote ÚNICAMENTE en el contexto legal proporcionado, genera una respuesta siguiendo ESTRICTAMENTE la estructura del ejemplo dado.
        `;

        // 5. GENERACIÓN DE RESPUESTA FINAL
        const responseFinal = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 2000
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
