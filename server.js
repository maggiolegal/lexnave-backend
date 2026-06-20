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

// ========== OBTENER TODOS LOS NÚMEROS DE ARTÍCULOS DE UNA LEY ==========
async function obtenerNumerosDeArticulos(leyId) {
    try {
        const { data, error } = await supabase
            .from('articulos')
            .select('numero_articulo, id')
            .eq('ley_id', parseInt(leyId));

        if (error) {
            console.error("Error obteniendo números de artículos:", error);
            return [];
        }

        console.log(`📚 Total artículos en ${LEY_MAP[leyId]}: ${data.length}`);
        return data.map(a => ({
            numero: a.numero_articulo,
            id: a.id
        }));
    } catch (e) {
        console.error("Error en obtenerNumerosDeArticulos:", e);
        return [];
    }
}

// ========== OBTENER ARTÍCULOS COMPLETOS POR NÚMEROS ==========
async function obtenerArticulosPorNumeros(leyId, numeros) {
    try {
        if (!numeros || numeros.length === 0) return [];
        
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .in('numero_articulo', numeros);

        if (error) {
            console.error("Error obteniendo artículos por números:", error);
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
        console.error("Error en obtenerArticulosPorNumeros:", e);
        return [];
    }
}

// ========== ETAPA 1: GROQ SELECCIONA POSIBLES NÚMEROS ==========
async function seleccionarNumerosCandidatos(pregunta, numeros, leyId) {
    if (!numeros || numeros.length === 0) return [];

    const leyNombre = LEY_MAP[leyId] || 'Ley';
    console.log(`📚 ETAPA 1 - Groq analizando ${numeros.length} números de ${leyNombre}...`);

    // Preparar lista de números (limitada para no saturar)
    const listaNumeros = numeros.slice(0, 200).map(n => n.numero).join(', ');
    const total = numeros.length;

    const prompt = `
    Eres un Juez experto en derecho venezolano. La siguiente lista contiene los números de artículos de la ${leyNombre} (total: ${total} artículos).

    Tu tarea es:
    1. Analizar la pregunta del ciudadano.
    2. De la lista de números de artículos, seleccionar los que PODRÍAN contener la respuesta.
    3. Piensa en qué temas trata cada artículo según su número (ej: 571-577 → servidumbres, 373 → flagrancia, 1969 → prescripción).
    4. Selecciona los 10-15 números más prometedores.

    Pregunta del ciudadano: "${pregunta}"

    Números de artículos disponibles (mostrados parcialmente):
    ${listaNumeros}

    Responde SOLO con un arreglo JSON de números de artículos seleccionados (máximo 15).
    Ejemplo: [571, 572, 573, 574, 575, 576, 577]
    Si ningún número parece relevante, responde: []
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        const seleccionados = Array.isArray(result) ? result : (result.ids || result.articulos || result.numeros || []);

        if (seleccionados.length === 0) {
            console.log('⚠️ Groq no seleccionó números candidatos');
            return [];
        }

        console.log(`📊 ETAPA 1 - Números seleccionados: ${seleccionados.slice(0, 20).join(', ')}`);
        return seleccionados.slice(0, 15);

    } catch (error) {
        console.error("❌ Error en selección de números:", error.message);
        // Fallback: devolver los primeros 15 números
        return numeros.slice(0, 15).map(n => n.numero);
    }
}

// ========== ETAPA 2: GROQ SELECCIONA EL ARTÍCULO EXACTO ==========
async function seleccionarArticuloExacto(pregunta, articulos, leyId) {
    if (!articulos || articulos.length === 0) return [];

    const leyNombre = LEY_MAP[leyId] || 'Ley';
    console.log(`📚 ETAPA 2 - Groq analizando ${articulos.length} artículos completos...`);

    // Construir lista de artículos completos
    let listaArticulos = "";
    for (let i = 0; i < articulos.length; i++) {
        const a = articulos[i];
        const texto = a.contenido.substring(0, 600);
        listaArticulos += `${i+1}. Artículo ${a.numero_articulo}: ${texto}...\n`;
    }

    const prompt = `
    Eres un Juez experto en derecho venezolano. De la siguiente lista de artículos completos de la ${leyNombre}, selecciona el ARTÍCULO EXACTO que responde a la pregunta del ciudadano.

    ⚠️ INSTRUCCIONES IMPORTANTES:
    1. Lee COMPLETAMENTE cada artículo.
    2. Selecciona el que responde DIRECTAMENTE a la pregunta.
    3. Si la pregunta es sobre servidumbres de luces, busca artículos que hablen de distancias, muros, ventanas, luces.
    4. Si la pregunta es sobre detención, busca artículos que mencionen plazos, horas, presentación ante juez.
    5. Si la pregunta es sobre prescripción, busca artículos que mencionen años, plazos, interrupción.
    6. Responde SOLO con un arreglo JSON de números de artículos (máximo 3).
    7. Si no encuentras un artículo que responda, NO inventes. Responde con [].

    Pregunta del ciudadano: "${pregunta}"

    Artículos completos:
    ${listaArticulos}

    Responde SOLO con un arreglo JSON. Ejemplos:
    - [571]
    - [337, 338]
    - [373]
    - []
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
            console.log('⚠️ Groq no seleccionó ningún artículo exacto');
            return [];
        }

        // Mapear números seleccionados a artículos completos
        const articulosSeleccionados = [];
        for (const numArt of seleccionados) {
            const numStr = numArt.toString();
            const encontrado = articulos.find(a => 
                a.numero_articulo.toString() === numStr ||
                a.numero_articulo.toString().replace(/\D/g, '') === numStr
            );
            if (encontrado) {
                articulosSeleccionados.push(encontrado);
                console.log(`✅ Artículo seleccionado: ${encontrado.numero_articulo}`);
            } else {
                console.log(`⚠️ Artículo ${numArt} no encontrado en los artículos completos`);
            }
        }

        return articulosSeleccionados;

    } catch (error) {
        console.error("❌ Error en selección exacta:", error.message);
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

        console.log(`🔍 ETAPA 1 - Groq seleccionando números candidatos...`);

        // 2. OBTENER TODOS LOS NÚMEROS DE ARTÍCULOS
        const todosLosNumeros = await obtenerNumerosDeArticulos(leyId);

        if (todosLosNumeros.length === 0) {
            return res.json({
                respuesta: `⚠️ No tengo artículos de ${LEY_MAP[leyId]} en mi base de datos.`
            });
        }

        // 3. ETAPA 1: GROQ SELECCIONA NÚMEROS CANDIDATOS
        let numerosCandidatos = await seleccionarNumerosCandidatos(
            pregunta,
            todosLosNumeros,
            leyId
        );

        // Si Groq no seleccionó números, usar los primeros 15
        if (numerosCandidatos.length === 0) {
            console.log('⚠️ Groq no seleccionó números. Usando los primeros 15...');
            numerosCandidatos = todosLosNumeros.slice(0, 15).map(n => n.numero);
        }

        // 4. OBTENER ARTÍCULOS COMPLETOS DE LOS NÚMEROS SELECCIONADOS
        const articulosCompletos = await obtenerArticulosPorNumeros(leyId, numerosCandidatos);

        if (articulosCompletos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes para tu consulta. Te recomiendo consultar con un abogado especializado."
            });
        }

        console.log(`📊 ETAPA 1 - ${articulosCompletos.length} artículos completos obtenidos`);

        // 5. ETAPA 2: GROQ SELECCIONA EL ARTÍCULO EXACTO
        const articulosSeleccionados = await seleccionarArticuloExacto(
            pregunta,
            articulosCompletos,
            leyId
        );

        if (articulosSeleccionados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes para tu consulta. Te recomiendo consultar con un abogado especializado."
            });
        }

        console.log(`📊 ETAPA 2 - Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);

        // 6. GENERAR RESPUESTA FINAL
        let respuesta = await generarRespuesta(
            pregunta,
            articulosSeleccionados,
            leyId
        );

        // 7. VALIDAR CITAS
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
