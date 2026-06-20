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
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .limit(50);

        if (error) {
            console.error("Error obteniendo artículos:", error);
            return [];
        }

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
    Analiza la siguiente consulta legal de un ciudadano venezolano y clasifícala en formato JSON.
    
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
        "ley_id": número de la ley principal (o null si no aplica),
        "articulo_num": número de artículo si se menciona específicamente (o null),
        "tema": "descripción breve del tema legal"
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
        console.log(`📋 Clasificación: Ley ${result.ley_id}, Artículo ${result.articulo_num || 'N/A'}, Tema: ${result.tema}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, articulo_num: null, tema: null };
    }
}

// ========== GROQ: SELECCIONAR ARTÍCULOS RELEVANTES ==========
async function seleccionarArticulosRelevantes(pregunta, articulos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';

    // Si hay pocos artículos, pasarlos todos
    if (articulos.length <= 20) {
        console.log(`📚 Solo ${articulos.length} artículos, pasando todos al modelo`);
        return articulos;
    }

    const prompt = `
    Eres un Juez experto en derecho venezolano. De la siguiente lista de artículos de la ${leyNombre}, selecciona los que son RELEVANTES para responder la pregunta del ciudadano.

    Pregunta: "${pregunta}"

    Artículos disponibles:
    ${articulos.map((a, i) => `${i+1}. Artículo ${a.numero_articulo}: ${a.contenido.substring(0, 300)}...`).join('\n')}

    Responde SOLO con un arreglo JSON de los números de los artículos seleccionados.
    Ejemplo: [5, 14, 18]
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
            console.log('⚠️ No se seleccionaron artículos, usando los primeros 5');
            return articulos.slice(0, 5);
        }

        const articulosSeleccionados = articulos.filter((_, index) => 
            seleccionados.includes(index + 1) || seleccionados.includes(articulos[index].id)
        );

        console.log(`📊 Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);
        return articulosSeleccionados.length > 0 ? articulosSeleccionados : articulos.slice(0, 5);
    } catch (error) {
        console.error("Error en selección de artículos:", error);
        return articulos.slice(0, 5);
    }
}

// ========== GROQ: GENERAR RESPUESTA FINAL ==========
async function generarRespuesta(pregunta, articulosSeleccionados, leyId, metadata) {
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
        let articuloNum = clasificacion.articulo_num;

        // Si no detectó ley, buscar en todas
        if (!leyId) {
            console.log('⚠️ No se detectó ley específica. Buscando en todas...');
            // Buscar en todas las leyes (1-11)
            for (let id = 1; id <= 11; id++) {
                const articulos = await obtenerTodosLosArticulos(id);
                if (articulos.length > 0) {
                    const seleccionados = await seleccionarArticulosRelevantes(pregunta, articulos, id);
                    if (seleccionados.length > 0) {
                        leyId = id;
                        console.log(`✅ Ley encontrada: ${LEY_MAP[id]}`);
                        break;
                    }
                }
            }
        }

        if (!leyId) {
            return res.json({
                respuesta: "⚠️ No pude identificar la ley aplicable a tu consulta. Por favor, reformula tu pregunta o consulta con un abogado."
            });
        }

        // 2. OBTENER TODOS LOS ARTÍCULOS DE LA LEY
        const todosLosArticulos = await obtenerTodosLosArticulos(leyId);
        
        if (todosLosArticulos.length === 0) {
            return res.json({
                respuesta: `⚠️ No tengo artículos de ${LEY_MAP[leyId]} en mi base de datos.`
            });
        }

        console.log(`📚 Total artículos de ${LEY_MAP[leyId]}: ${todosLosArticulos.length}`);

        // 3. FILTRAR ARTÍCULOS RELEVANTES CON GROQ
        const articulosRelevantes = await seleccionarArticulosRelevantes(pregunta, todosLosArticulos, leyId);

        if (articulosRelevantes.length === 0) {
            return res.json({
                respuesta: `⚠️ No encontré artículos relevantes en ${LEY_MAP[leyId]} para tu consulta.`
            });
        }

        console.log(`📊 Artículos relevantes: ${articulosRelevantes.map(a => a.numero_articulo).join(', ')}`);

        // 4. GENERAR RESPUESTA FINAL
        let respuesta = await generarRespuesta(pregunta, articulosRelevantes, leyId, clasificacion);

        // 5. VALIDAR CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosRelevantes);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Regenerando respuesta...');
            respuesta = await generarRespuesta(pregunta, articulosRelevantes, leyId, clasificacion);
            
            // Verificar nuevamente
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta, articulosRelevantes);
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
