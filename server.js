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
    10: "Ley de regulación del arrendamiento inmobiliario para el uso comercial",
    11: "Ley de Registros y Notarías"
};

// ========== MAPEO FORZADO DE LEYES POR PALABRAS CLAVE ==========
const KEYWORD_LEY_MAP = {
    // Propiedad Horizontal (Ley 2) - PRIORIDAD ALTA
    'vecino': 2,
    'vecinos': 2,
    'edificio': 2,
    'condominio': 2,
    'apartamento': 2,
    'propiedad horizontal': 2,
    'cuotas de mantenimiento': 2,
    'junta de condominio': 2,
    'administrador del edificio': 2,
    'mantenimiento': 2,
    'ascensor': 2,
    'áreas comunes': 2,
    'mi apartamento': 2,
    'mi vivienda': 2,
    'propietario': 2,
    'propietarios': 2,
    'condominio': 2,
    'edificio': 2,
    'copropietario': 2,
    'copropietarios': 2,
    
    // Código Civil (Ley 3)
    'contrato': 3,
    'arrendamiento': 3,
    'alquiler': 3,
    'daños y perjuicios': 3,
    'responsabilidad civil': 3,
    'propiedad': 3,
    'posesión': 3,
    'inquilino': 3,
    'arrendador': 3,
    'herencia': 3,
    'testamento': 3,
    'sucesión': 3,
    
    // Código de Comercio (Ley 4)
    'pagare': 4,
    'letra de cambio': 4,
    'comerciante': 4,
    'cheque': 4,
    'sociedad mercantil': 4,
    'empresa': 4,
    
    // Código Orgánico Procesal Penal (Ley 5)
    'detenido': 5,
    'flagrancia': 5,
    'imputado': 5,
    'fiscal': 5,
    'penal': 5,
    'delito': 5,
    'crimen': 5,
    'homicidio': 5,
    'robo': 5,
    'hurto': 5,
    'lesiones': 5,
    
    // Código Penal (Ley 6)
    'robo': 6,
    'hurto': 6,
    'homicidio': 6,
    'lesiones': 6,
    'estafa': 6,
    'fraude': 6,
    
    // Código de Procedimiento Civil (Ley 7)
    'demanda': 7,
    'juicio': 7,
    'procedimiento': 7,
    'tribunal': 7,
    'sentencia': 7,
    'apelación': 7,
    'recurso': 7,
    'ejecución': 7,
    
    // Ley de Arrendamientos (Ley 8)
    'alquiler': 8,
    'arrendatario': 8,
    'canon': 8,
    'desalojo': 8,
    'contrato de arrendamiento': 8,
    
    // Violencia contra la Mujer (Ley 9)
    'violencia': 9,
    'mujer': 9,
    'mujeres': 9,
    'género': 9,
    'maltrato': 9,
    
    // Arrendamiento Comercial (Ley 10)
    'local comercial': 10,
    'arrendamiento comercial': 10,
    'negocio': 10,
    
    // Registros y Notarías (Ley 11)
    'registro': 11,
    'notaría': 11,
    'notario': 11,
    'registrador': 11,
    'documento': 11,
    'escritura': 11
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

// ========== VALIDACIÓN DE CITAS EN RESPUESTA ==========
async function verificarCitasEnRespuesta(respuesta, articulosContexto) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulosMencionados = [...new Set([...matches].map(m => parseInt(m[1])))];
    
    if (articulosMencionados.length === 0) {
        console.log('⚠️ No se encontraron citas de artículos en la respuesta');
        return false;
    }
    
    const idsContexto = articulosContexto.map(a => parseInt(a.numero_articulo));
    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));
    
    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados detectados: ${invalidos.join(', ')}`);
        return false;
    }
    
    console.log(`✅ Todos los artículos citados (${articulosMencionados.join(', ')}) existen en el contexto`);
    return true;
}

// ========== VALIDACIÓN DE EXISTENCIA DE ARTÍCULOS ==========
async function validarArticuloExiste(leyId, numArticulo) {
    try {
        const { data, error } = await supabase
            .from('articulos')
            .select('id, contenido, numero_articulo')
            .eq('ley_id', parseInt(leyId))
            .eq('numero_articulo', numArticulo.toString().trim())
            .maybeSingle();
        
        if (error || !data) {
            return { existe: false, contenido: null, numero: null };
        }
        return { 
            existe: true, 
            contenido: data.contenido,
            numero: data.numero_articulo
        };
    } catch (e) {
        console.error("Error validando artículo:", e);
        return { existe: false, contenido: null, numero: null };
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

async function obtenerArticulosPorLey(leyId, limite = 8) {
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
            const filtrados = articulosCandidatos.filter(art => idsAdmitidos.includes(art.id));
            if (filtrados.length < 3 && articulosCandidatos.length >= 3) {
                console.log(`⚠️ Filtro devolvió solo ${filtrados.length} artículos, usando top 5`);
                return articulosCandidatos.slice(0, 5);
            }
            return filtrados;
        }
        return articulosCandidatos.slice(0, 5);
    } catch (error) {
        console.error("❌ Error en filtro supremo:", error.message);
        return articulosCandidatos.slice(0, 5);
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

        // 2. FORZAR LEY SEGÚN PALABRAS CLAVE (PRIORIDAD ALTA)
        let leyesForzadas = [];
        const palabrasEnPregunta = pregunta.toLowerCase();
        
        // Recorrer todas las palabras clave y forzar las leyes correspondientes
        for (const [keyword, leyId] of Object.entries(KEYWORD_LEY_MAP)) {
            if (palabrasEnPregunta.includes(keyword.toLowerCase())) {
                if (!leyesForzadas.includes(leyId)) {
                    leyesForzadas.push(leyId);
                    console.log(`🔧 Forzando ley ${leyId} (${LEY_MAP[leyId]}) por palabra clave "${keyword}"`);
                }
            }
        }
        
        // Si se forzaron leyes, reemplazar ley_ids con las forzadas
        if (leyesForzadas.length > 0) {
            // Priorizar Propiedad Horizontal (2) sobre Arrendamiento (8)
            if (leyesForzadas.includes(2) && leyesForzadas.includes(8)) {
                // Eliminar Arrendamiento (8) si Propiedad Horizontal (2) está presente
                leyesForzadas = leyesForzadas.filter(id => id !== 8);
                console.log(`⚖️ Priorizando Propiedad Horizontal (2) sobre Arrendamiento (8)`);
            }
            metadata.ley_ids = leyesForzadas;
            console.log(`🔧 Leyes forzadas finales: ${metadata.ley_ids.join(', ')}`);
        }

        // 3. RECUPERACIÓN DE ARTÍCULOS
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
            
            const promesasBusqueda = leyesAUsar.map(leyId => obtenerArticulosPorLey(leyId, 10));
            const resultados = await Promise.all(promesasBusqueda);
            articulosCandidatos = resultados.flat().slice(0, 25);
        }

        // Si no se encontraron artículos, responder con mensaje
        if (articulosCandidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
            });
        }

        // 4. FILTRO SUPREMO
        const articulosFiltrados = await filtrarArticulosRelevantes(pregunta, articulosCandidatos);
        console.log(`${timestamp} ✅ Artículos filtrados: ${articulosFiltrados.length}`);

        // 5. SYSTEM PROMPT DEFINITIVO CON ANTI-ALUCINACIÓN
        const systemPrompt = `
        Eres "LexnaVe", un Abogado Senior y Experto en Derecho Procesal Civil, Penal y Constitucional Venezolano con 20 años de experiencia.

        ⚠️ **REGLA DE ORO - PROHIBICIÓN ABSOLUTA DE ALUCINACIÓN:**

        1. **SOLO PUEDES CITAR** artículos que aparezcan EXPLÍCITAMENTE en el "CONTEXTO LEGAL DISPONIBLE" que se te proporciona.
        2. **SI UN ARTÍCULO NO ESTÁ EN EL CONTEXTO**, no lo menciones bajo ninguna circunstancia.
        3. **SI EL USUARIO ES PROPIETARIO** (dice "mi apartamento", "mi vivienda"), NO uses leyes de arrendamiento. Usa Propiedad Horizontal y Código Civil.
        4. **SI NO ENCUENTRAS INFORMACIÓN SUFICIENTE**, responde textualmente: 
           "No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."

        **ESTRUCTURA OBLIGATORIA DE RESPUESTA:**

        1. **INTRODUCCIÓN**: Resumen ejecutivo de 2-3 líneas que responda directamente la consulta.
        2. **FUNDAMENTOS LEGALES** (SOLO artículos del contexto):
           - "Según el Artículo X de la Ley Y: [texto LITERAL del contexto]"
           - "Este artículo aplica porque [explicación breve]"
        3. **ACCIONES RECOMENDADAS**: Lista numerada de pasos prácticos que puede tomar el ciudadano.
        4. **ADVERTENCIA FINAL**: "⚖️ Esto es orientación general. Consulta con un abogado."

        **REGLAS DOGMÁTICAS INVIOLABLES:**

        --- BLOQUE CIVIL Y CONSTITUCIONAL ---
        - **Propiedad Horizontal (Ley 2)**: Problemas de vecinos, condominio, cuotas de mantenimiento, acceso a vivienda.
        - **Código Civil (Ley 3)**: Contratos, responsabilidad civil, propiedad, posesión, prohibición de vías de hecho.
        - **Art. 115 CRBV**: "Se garantiza el derecho de propiedad. Toda persona tiene derecho al uso, goce, disfrute y disposición de sus bienes."
        - **Art. 548 CCV**: "Nadie puede hacerse justicia por sí mismo."
        - **Art. 14 LPH**: Cobro ejecutivo de cuotas de mantenimiento.
        - **Art. 5 LPH**: Obligación de contribuir con gastos comunes.

        --- BLOQUE PENAL ---
        - **Flagrancia (Art. 373 COPP)**: 12h policía + 48h fiscal = 60h máximo.
        - **Acto conclusivo (Art. 295 COPP)**: 6 meses desde imputación.
        - **Acción Privada (Arts. 25 y 391 COPP)**: Difamación, injuria → ACUSACIÓN PRIVADA (NO Fiscalía).

        **EJEMPLO DE RESPUESTA CORRECTA:**
        "En Venezuela, la prohibición de acceso a tu apartamento es ilegal. La Ley de Propiedad Horizontal no autoriza a los vecinos a tomar justicia por su propia mano.

        1. **Derecho de Propiedad (Art. 115 CRBV)**: 'Se garantiza el derecho de propiedad. Toda persona tiene derecho al uso, goce y disfrute de sus bienes.'

        2. **Prohibición de Vías de Hecho (Art. 548 CCV)**: 'Nadie puede hacerse justicia por sí mismo.' Tu vecino debe seguir el procedimiento legal establecido en el Art. 14 de la LPH para cobrar deudas.

        **ACCIONES RECOMENDADAS:**
        1. Envía una carta formal exigiendo el restablecimiento del acceso.
        2. Interpone acción de amparo constitucional.
        3. Denuncia ante el Ministerio Público por coacción.

        ⚖️ Esto es orientación general. Consulta con un abogado."
        `;

        // Construir contexto legal con citas literales
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

        **INSTRUCCIÓN IMPORTANTE:** 
        Basándote ÚNICAMENTE en el contexto legal proporcionado, genera una respuesta siguiendo ESTRICTAMENTE la estructura del ejemplo. 
        Si el contexto no contiene información suficiente, responde: "No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
        `;

        // 6. GENERACIÓN DE RESPUESTA FINAL
        const responseFinal = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 2500
        });

        let respuesta = responseFinal.choices[0]?.message?.content;

        // 7. VALIDACIÓN DE CITAS EN LA RESPUESTA
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosFiltrados);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Usando respuesta de fallback.');
            return res.json({
                respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
            });
        }

        res.json({ respuesta });

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
