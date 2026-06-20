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

// ========== OBTENER TODOS LOS ARTÍCULOS DE UNA LEY ==========
async function obtenerTodosLosArticulos(leyId) {
    try {
        // Obtener todos los artículos de la ley (sin límite)
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId));

        if (error) {
            console.error("Error obteniendo artículos:", error);
            return [];
        }

        console.log(`📚 Total artículos de ${LEY_MAP[leyId]}: ${data.length}`);
        
        return (data || []).map(art => ({
            id: art.id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido,
            ley_id: art.ley_id,
            ley_nombre: LEY_MAP[art.ley_id] || 'Ley'
        }));
    } catch (e) {
        console.error("Error en obtenerTodosLosArticulos:", e);
        return [];
    }
}

// ========== GROQ: CLASIFICAR CONSULTA ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
    CRITERIOS DE CLASIFICACIÓN:
    - "Prescripción", "daños", "perjuicios", "responsabilidad civil", "accidente" → Código Civil (Ley 3)
    - "Contrato", "arrendamiento", "alquiler" → Código Civil (Ley 3)
    - "Propiedad horizontal", "condominio", "vecino" → LPH (Ley 2)
    - "Constitución", "derechos humanos", "amparo", "estado de excepción" → CRBV (Ley 1)
    - "Comercio", "sociedad", "empresa" → Código de Comercio (Ley 4)
    - "Procesal", "procedimiento", "juicio" → CPC (Ley 7)
    - "Detención", "flagrancia", "penal", "delito" → COPP (Ley 5)
    - "Arrendamiento vivienda" → Ley 8
    - "Violencia mujer" → Ley 9

    Leyes disponibles:
    1: CRBV (Constitución)
    2: LPH (Ley de Propiedad Horizontal)
    3: CCV (Código Civil)
    4: CCom (Código de Comercio)
    5: COPP (Código Orgánico Procesal Penal)
    6: CP (Código Penal)
    7: CPC (Código de Procedimiento Civil)
    8: Arrendamiento Vivienda
    9: Violencia Mujer
    10: Arrendamiento Comercial
    11: Registros

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {
        "ley_id": número de la ley principal,
        "articulo_num": número de artículo si se menciona específicamente (o null),
        "tema": "descripción breve del tema legal",
        "confianza": "alta/media/baja"
    }
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id} (${LEY_MAP[result.ley_id] || 'Desconocida'}), Confianza: ${result.confianza}, Tema: ${result.tema}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, articulo_num: null, tema: null, confianza: 'baja' };
    }
}

// ========== GROQ: SELECCIONAR ARTÍCULO EXACTO DE TODOS ==========
async function seleccionarArticuloExacto(pregunta, articulos, leyId) {
    if (!articulos || articulos.length === 0) return [];

    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    // Si hay pocos artículos, pasarlos todos
    if (articulos.length <= 200) {
        console.log(`📚 ${articulos.length} artículos, pasando todos a Groq para análisis`);
    } else {
        console.log(`📚 ${articulos.length} artículos, Groq analizará todos`);
    }

    // Construir lista de artículos para Groq (con límite de caracteres)
    let listaArticulos = "";
    for (let i = 0; i < articulos.length; i++) {
        const a = articulos[i];
        const texto = a.contenido.substring(0, 500);
        listaArticulos += `${i+1}. Artículo ${a.numero_articulo}: ${texto}...\n`;
        if (listaArticulos.length > 15000) break; // Limitar para no exceder tokens
    }

    const prompt = `
    Eres un Juez experto en derecho venezolano. La siguiente lista contiene TODOS los artículos de la ${leyNombre} (${articulos.length} artículos en total).

    Tu tarea es:
    1. Leer TODOS los artículos.
    2. Identificar el ARTÍCULO EXACTO que responde a la pregunta del ciudadano.
    3. Si hay varios artículos relevantes, selecciona el MÁS IMPORTANTE (el que responde directamente).

    Pregunta del ciudadano: "${pregunta}"

    Lista de artículos (mostrados parcialmente):
    ${listaArticulos}

    Responde SOLO con un arreglo JSON de los números de los artículos seleccionados (máximo 3).
    Ejemplo: [373] o [337, 338, 339]
    Si ningún artículo responde la pregunta, responde: []
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        const seleccionados = Array.isArray(result) ? result : (result.ids || result.articulos || []);

        if (seleccionados.length === 0) {
            console.log('⚠️ Groq no seleccionó ningún artículo');
            return [];
        }

        // Mapear números seleccionados a artículos completos
        const articulosSeleccionados = [];
        for (const numArt of seleccionados) {
            // Buscar por número de artículo (puede ser string o número)
            const encontrado = articulos.find(a => 
                a.numero_articulo.toString() === numArt.toString() ||
                a.numero_articulo.toString().replace(/\D/g, '') === numArt.toString()
            );
            if (encontrado) {
                articulosSeleccionados.push(encontrado);
            }
        }

        console.log(`📊 Artículos seleccionados por Groq: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);
        return articulosSeleccionados;

    } catch (error) {
        console.error("Error en selección de artículos:", error);
        return [];
    }
}

// ========== GROQ: GENERAR RESPUESTA FINAL ==========
async function generarRespuesta(pregunta, articulosSeleccionados, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';

    let contextoLegal = "";
    if (articulosSeleccionados.length > 0) {
        contextoLegal = articulosSeleccionados.map(a => 
            `Artículo ${a.numero_articulo} de ${a.ley_nombre || leyNombre}: "${a.contenido}"`
        ).join('\n\n');
    } else {
        contextoLegal = "No se encontraron artículos relevantes para esta consulta.";
    }

    const systemPrompt = `
Eres "LexnaVe", un asistente jurídico especializado en leyes venezolanas.

⚠️ REGLAS ABSOLUTAS:
1. SOLO puedes citar artículos que estén en el CONTEXTO LEGAL que se te proporciona.
2. Cada afirmación debe ir acompañada de: "Según el Artículo X de la Ley Y: [texto literal entre comillas]"
3. NO puedes inventar, interpretar ni dar opiniones personales.
4. Si el contexto no contiene información suficiente, responde: "No tengo información suficiente en mi base de datos para responder esta consulta."

ESTRUCTURA DE RESPUESTA:
1. INTRODUCCIÓN: Resumen de 2-3 líneas
2. FUNDAMENTOS LEGALES: Artículos con texto literal
3. ACCIONES RECOMENDADAS: Pasos prácticos (basados en la ley)
4. ADVERTENCIA: "⚖️ Esto es orientación general. Consulta con un abogado."
`;

    const promptFinal = `
CONTEXTO LEGAL:
${contextoLegal}

CONSULTA DEL USUARIO:
"${pregunta}"

INSTRUCCIÓN: Genera una respuesta siguiendo ESTRICTAMENTE la estructura y reglas indicadas.
`;

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 3000
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return "⚠️ Se produjo un error al generar la respuesta. Por favor, intenta de nuevo.";
    }
}

// ========== VALIDACIÓN DE CITAS ==========
async function verificarCitasEnRespuesta(respuesta, articulosContexto) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulosMencionados = [...new Set([...matches].map(m => parseInt(m[1])))];

    if (articulosMencionados.length === 0) {
        console.log('⚠️ No se encontraron citas de artículos en la respuesta');
        return false;
    }

    const idsContexto = [];
    for (const art of articulosContexto) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }

    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));

    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados detectados: ${invalidos.join(', ')}`);
        return false;
    }

    console.log(`✅ Todos los artículos citados (${articulosMencionados.join(', ')}) existen en el contexto`);
    return true;
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. CLASIFICAR CONSULTA
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id;

        if (!leyId) {
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable a tu consulta. Por favor, reformula tu pregunta o consulta con un abogado."
            });
        }

        // 2. OBTENER TODOS LOS ARTÍCULOS DE LA LEY
        console.log(`🔍 Obteniendo todos los artículos de ${LEY_MAP[leyId]}...`);
        const todosLosArticulos = await obtenerTodosLosArticulos(leyId);

        if (todosLosArticulos.length === 0) {
            return res.json({
                respuesta: `⚠️ No tengo artículos de ${LEY_MAP[leyId]} en mi base de datos.`
            });
        }

        // 3. GROQ SELECCIONA EL ARTÍCULO EXACTO DE TODOS
        const articulosSeleccionados = await seleccionarArticuloExacto(
            pregunta, 
            todosLosArticulos, 
            leyId
        );

        if (articulosSeleccionados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes para tu consulta. Te recomiendo consultar con un abogado especializado."
            });
        }

        console.log(`📊 Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);

        // 4. GENERAR RESPUESTA FINAL
        let respuesta = await generarRespuesta(
            pregunta, 
            articulosSeleccionados, 
            leyId
        );

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosSeleccionados);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Regenerando respuesta...');
            respuesta = await generarRespuesta(
                pregunta, 
                articulosSeleccionados, 
                leyId
            );
            
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta, articulosSeleccionados);
            if (!citasValidas2) {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
                });
            }
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
