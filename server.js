import express from 'express';
import cors from 'cors';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import { pipeline } from '@xenova/transformers';

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

// ========== NORMALIZAR TEXTO ==========
function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, '');
}

// ========== ARTÍCULOS CLAVE ==========
const FORZAR_ARTICULOS = {
    'hurto': ['451', '452', '453'],
    'robo': ['455', '456', '457'],
    'homicidio': ['405', '406', '409'],
    'lesiones': ['413', '414', '415'],
    'estafa': ['461', '462'],
    'corrupcion': ['60', '61', '62'],
    'peculado': ['63', '64'],
    'cohecho': ['67', '68'],
    'secuestro': ['460'],
    'extorsion': ['460'],
    'prescripcion': ['1969', '1950', '1951', '1952'],
    'plazo': ['1969'],
    'divorcio': ['185', '186', '187'],
    'matrimonio': ['82', '83', '84', '85', '86', '87', '88'],
    'paternidad': ['210', '211', '212', '215'],
    'filiacion': ['210', '211', '212'],
    'alimentos': ['282', '283', '284'],
    'herencia': ['991', '992', '993', '994'],
    'testamento': ['991', '992', '993', '994'],
    'servidumbre': ['571', '572', '573', '574', '575', '576', '577'],
    'luz natural': ['571', '572', '573', '574'],
    'muro': ['571', '572', '573'],
    'contrato': ['1137', '1140', '1145'],
    'arrendamiento': ['1576', '1577', '1578'],
    'accidente': ['1185', '1190', '1810'],
    'choque': ['1185', '1190', '1810'],
    'daños': ['1185', '1190', '1810', '1969'],
    'perjuicios': ['1185', '1190', '1810', '1969'],
    'responsabilidad': ['1185', '1190'],
    'daño': ['1185', '1190', '1810'],
    'procedimiento oral': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'oral': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'lapsos': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'procedimiento breve': ['881', '882', '883', '884', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894'],
    'breve': ['881', '882', '883', '884', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894'],
    'intimacion': ['640', '641', '642', '643', '644', '645', '646', '647', '648', '649', '650', '651', '652'],
    'cobro': ['640', '641', '642'],
    'interdicto': ['782', '783', '784', '785', '786', '787', '788', '789', '790'],
    'posesion': ['782', '783', '784', '785'],
    'daño temido': ['786', '787', '788'],
    'medidas preventivas': ['585', '586', '587', '588', '589', '590'],
    'medidas cautelares': ['585', '586', '587', '588', '589', '590'],
    'secuestro': ['585', '586', '587'],
    'via ejecutiva': ['630', '631', '632', '633', '634', '635', '636', '637', '638', '639'],
    'ejecutivo': ['630', '631', '632', '633', '634', '635', '636', '637', '638', '639'],
    'demanda': ['340'],
    'requisitos demanda': ['340'],
    'libelo': ['340'],
    'citacion': ['218', '219', '220', '221', '222'],
    'emplazamiento': ['218', '219', '220', '221', '222'],
    'contestacion': ['344', '345', '346'],
    'cuestiones previas': ['346', '347', '348'],
    'pruebas': ['395', '396', '397', '398', '399', '400'],
    'lapso probatorio': ['395', '396', '397'],
    'testigos': ['478', '479', '480', '481', '482', '483'],
    'experticia': ['451', '452', '453'],
    'inspeccion': ['454', '455'],
    'informes': ['511'],
    'sentencia': ['243', '244', '245'],
    'ejecucion sentencia': ['523', '524', '525', '526'],
    'ejecucion': ['523', '524', '525', '526'],
    'embargo': ['585', '586', '587'],
    'remate': ['530', '531', '532'],
    'subasta': ['530', '531', '532'],
    'apelacion': ['288', '289', '290', '291'],
    'recurso': ['288', '289', '290', '291', '312', '313'],
    'casacion': ['312', '313'],
    'flagrancia': ['373'],
    'detencion': ['373', '374', '375'],
    'fianza': ['244', '245'],
    'privacion libertad': ['236', '237', '238'],
    'libertad provisional': ['242', '243', '244'],
    'arresto domiciliario': ['236', '237', '238'],
    'presentacion juez': ['373'],
    'acto conclusivo': ['295'],
    'juicio oral': ['332', '333', '334', '335', '336', '337', '338'],
    'audiencia preliminar': ['309', '310', '311', '312'],
    'fase preparatoria': ['295'],
    'investigacion': ['295', '296', '297', '298'],
    'imputacion': ['295'],
    'fiscalia': ['295', '373'],
    'derecho defensa': ['8', '9', '10'],
    'presuncion inocencia': ['8'],
    'debido proceso penal': ['8', '9'],
    'derecho silencio': ['8', '9', '10'],
    'procedimiento abreviado': ['372', '373'],
    'procedimiento ordinario penal': ['373'],
    'homicidio': ['405', '406'],
    'violacion': ['374', '375'],
    'secuestro': ['374', '375'],
    'robo': ['374', '375'],
    'hurto': ['374', '375'],
    'lesiones': ['374', '375'],
    'seguridad de la nacion': ['322'],
    'amparo': ['26', '27', '49'],
    'derecho propiedad': ['115'],
    'estado excepcion': ['337', '338', '339'],
    'propiedad horizontal': ['5', '7', '8', '9', '14'],
    'cuotas mantenimiento': ['14', '7', '5'],
    'letra cambio': ['410'],
    'pagare': ['410'],
    'cheque': ['410'],
    'violencia mujer': ['1', '2', '3', '4', '5'],
    'medidas proteccion': ['1', '2', '3']
};

// ========== MODELO DE EMBEDDING LOCAL ==========
let embedder = null;

async function initEmbedder() {
    if (!embedder) {
        console.log('🔄 Cargando modelo de embeddings...');
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        console.log('✅ Modelo de embeddings cargado');
    }
    return embedder;
}

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

// ========== GENERAR EMBEDDING ==========
async function generarEmbedding(texto) {
    try {
        const model = await initEmbedder();
        const textoTruncado = texto.length > 500 ? texto.substring(0, 500) : texto;
        const result = await model(textoTruncado, { pooling: 'mean', normalize: true });
        const embedding = Array.from(result.data);
        console.log(`✅ Embedding generado: ${embedding.length} dimensiones`);
        return embedding;
    } catch (error) {
        console.error('❌ Error generando embedding:', error.message);
        return null;
    }
}

// ========== BUSCAR POR SIMILITUD ==========
async function buscarPorSimilitud(pregunta, leyId = null, limite = 30) {
    try {
        const embedding = await generarEmbedding(pregunta);
        
        if (!embedding) {
            console.log('📝 Embedding no disponible, usando búsqueda por texto (fallback)');
            return buscarPorTexto(pregunta, leyId, limite);
        }
        
        const { data, error } = await supabase.rpc('match_articles', {
            query_embedding: embedding,
            match_ley_id: leyId || 0,
            match_threshold: 0.15,
            match_count: limite
        });
        
        if (error) {
            console.error('❌ Error en búsqueda vectorial:', error);
            return buscarPorTexto(pregunta, leyId, limite);
        }
        
        console.log(`🔍 Búsqueda vectorial: ${data?.length || 0} resultados`);
        
        return (data || []).map(art => ({
            id: art.id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido,
            ley_id: art.ley_id,
            ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
            similitud: art.similarity || 0
        }));
        
    } catch (e) {
        console.error('❌ Error en búsqueda vectorial:', e.message);
        return buscarPorTexto(pregunta, leyId, limite);
    }
}

// ========== BÚSQUEDA POR TEXTO ==========
async function buscarPorTexto(pregunta, leyId = null, limite = 30) {
    try {
        const query = supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id');
        
        if (leyId) {
            query.eq('ley_id', parseInt(leyId));
        }
        
        const { data, error } = await query.limit(limite);
        
        if (error) {
            console.error('❌ Error en búsqueda por texto:', error);
            return [];
        }
        
        console.log(`📝 Búsqueda por texto: ${data?.length || 0} resultados`);
        
        return (data || []).map(art => ({
            id: art.id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido,
            ley_id: art.ley_id,
            ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
            similitud: 0
        }));
        
    } catch (e) {
        console.error('❌ Error en búsqueda por texto:', e.message);
        return [];
    }
}

// ========== BUSCAR ARTÍCULO POR NÚMERO ==========
async function buscarArticuloPorNumero(leyId, numeroArticulo) {
    try {
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .ilike('numero_articulo', `%${numeroArticulo}%`)
            .maybeSingle();
        
        if (data && !error) {
            return {
                id: data.id,
                numero_articulo: data.numero_articulo,
                contenido: data.contenido,
                ley_id: data.ley_id,
                ley_nombre: LEY_MAP[data.ley_id] || 'Ley',
                similitud: 0.99
            };
        }
        return null;
    } catch (e) {
        console.error(`❌ Error buscando artículo ${numeroArticulo}:`, e.message);
        return null;
    }
}

// ========== CLASIFICACIÓN CON 70B ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Clasifica la consulta legal. Responde SOLO con JSON: {"ley_id": número}
    
    CRITERIOS:
    - CONSTITUCIÓN: constitución, amparo, derechos humanos, seguridad de la nación, presidente
    - CÓDIGO CIVIL: matrimonio, divorcio, paternidad, alimentos, herencia, testamento, contrato, servidumbre, prescripción, daños, accidente
    - CÓDIGO PENAL: hurto, robo, homicidio, lesiones, estafa, corrupción
    - COPP: detención, flagrancia, fianza, fiscal, juez, juicio oral
    - CPC: demanda, juicio, procedimiento, pruebas, embargo, intimación, interdicto, oral, breve, ordinario
    - LPH: propiedad horizontal, condominio, vecino
    - COMERCIO: letra cambio, pagaré, cheque
    - VIOLENCIA MUJER: violencia mujer
    - ARRENDAMIENTO VIVIENDA: arrendamiento vivienda, desalojo
    - REGISTROS: registro, notaría

    Consulta: "${pregunta}"
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" },
            max_tokens: 50
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id}`);
        return result;
    } catch (error) {
        console.warn("⚠️ Clasificación falló, usando fallback...");
        const lower = pregunta.toLowerCase();
        if (lower.includes('constitución') || lower.includes('amparo')) return { ley_id: 1 };
        if (lower.includes('hurto') || lower.includes('robo') || lower.includes('homicidio')) return { ley_id: 6 };
        if (lower.includes('detención') || lower.includes('flagrancia') || lower.includes('fiscal')) return { ley_id: 5 };
        if (lower.includes('divorcio') || lower.includes('matrimonio') || lower.includes('paternidad') || 
            lower.includes('herencia') || lower.includes('contrato') || lower.includes('prescripcion')) return { ley_id: 3 };
        if (lower.includes('demanda') || lower.includes('juicio') || lower.includes('procedimiento') ||
            lower.includes('pruebas') || lower.includes('oral') || lower.includes('breve')) return { ley_id: 7 };
        if (lower.includes('violencia mujer')) return { ley_id: 9 };
        if (lower.includes('letra') || lower.includes('comercio')) return { ley_id: 4 };
        if (lower.includes('propiedad horizontal') || lower.includes('condominio')) return { ley_id: 2 };
        if (lower.includes('arrendamiento vivienda')) return { ley_id: 8 };
        if (lower.includes('registro') || lower.includes('notaría')) return { ley_id: 11 };
        return { ley_id: 3 };
    }
}

// ========== FORZAR ARTÍCULOS ==========
async function forzarArticulosClave(pregunta, candidatos, leyId) {
    const preguntaNormalizada = normalizarTexto(pregunta);
    const articulosForzados = [];
    
    for (const [tema, articulos] of Object.entries(FORZAR_ARTICULOS)) {
        const temaNormalizado = normalizarTexto(tema);
        if (preguntaNormalizada.includes(temaNormalizado)) {
            console.log(`🔑 Tema detectado: "${tema}"`);
            for (const numArt of articulos) {
                const articulo = await buscarArticuloPorNumero(leyId, numArt);
                if (articulo) {
                    articulosForzados.push(articulo);
                }
            }
            break;
        }
    }
    
    if (articulosForzados.length > 0) {
        const idsForzados = new Set(articulosForzados.map(a => a.id));
        const existentes = candidatos.filter(a => !idsForzados.has(a.id));
        return [...articulosForzados, ...existentes];
    }
    
    return candidatos;
}

// ========== RESPUESTA CON 70B (CONTROLADA) ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    const articulosForzados = [];
    const lower = pregunta.toLowerCase();
    for (const [tema, articulos] of Object.entries(FORZAR_ARTICULOS)) {
        const temaNormalizado = normalizarTexto(tema);
        if (normalizarTexto(lower).includes(temaNormalizado)) {
            articulosForzados.push(...articulos);
            break;
        }
    }
    
    // Tomar los 10 mejores (reducido de 15)
    const mejores = candidatos.slice(0, 10);
    
    let contextoLegal = "";
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        const texto = a.contenido.substring(0, 300);
        contextoLegal += `\nArtículo ${a.numero_articulo}: ${texto}...\n`;
    }
    
    // Instrucción anti-alucinación
    let instruccionForzada = "";
    if (articulosForzados.length > 0) {
        instruccionForzada = `\n⚠️ SOLAMENTE puedes citar los artículos ${articulosForzados.join(', ')}. NO cites ningún otro artículo.`;
    }
    
    const systemPrompt = `
Eres "LexnaVe", asistente jurídico experto en leyes venezolanas.

⚠️ REGLA DE ORO:
1. SOLO puedes citar artículos que estén EXPLÍCITAMENTE en el contexto.
2. ${instruccionForzada || 'Cita el artículo que mejor responda la pregunta.'}
3. NO inventes artículos. Si no encuentras, di "No tengo información suficiente".
4. Cita el artículo TEXTUALMENTE entre comillas.

ESTRUCTURA:
1. INTRODUCCIÓN (2 líneas)
2. "Según el Artículo X de la Ley Y: [texto literal]"
3. Explicación breve
4. ACCIONES RECOMENDADAS (3 pasos)
5. ⚖️ Consulta con un abogado.
`;

    const promptFinal = `
CONTEXTO (${leyNombre}):
${contextoLegal}

PREGUNTA: "${pregunta}"

INSTRUCCIÓN: Responde con la estructura indicada.${instruccionForzada}
`;

    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            max_tokens: 700
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error generando respuesta:", error);
        return "⚠️ Error al generar la respuesta. Intenta de nuevo.";
    }
}

// ========== VALIDAR CITAS ==========
async function verificarCitasEnRespuesta(respuesta, candidatos) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulosMencionados = [...new Set([...matches].map(m => parseInt(m[1])))];
    
    if (articulosMencionados.length === 0) {
        console.log('⚠️ No se encontraron citas');
        return true; // Si no hay citas, no hay alucinaciones
    }
    
    const idsContexto = [];
    for (const art of candidatos) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }
    
    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));
    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados: ${invalidos.join(', ')}`);
        console.log(`📚 Artículos disponibles: ${idsContexto.join(', ')}`);
        return false;
    }
    
    console.log(`✅ Artículos citados existen en el contexto`);
    return true;
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id || 3;

        console.log(`🔍 Buscando en ${LEY_MAP[leyId]}`);
        
        let articulosEncontrados = await buscarPorSimilitud(pregunta, leyId, 30);
        articulosEncontrados = await forzarArticulosClave(pregunta, articulosEncontrados, leyId);

        if (articulosEncontrados.length === 0) {
            console.log('🔄 Buscando en todas las leyes...');
            articulosEncontrados = await buscarPorSimilitud(pregunta, null, 30);
            if (articulosEncontrados.length > 0) {
                leyId = articulosEncontrados[0].ley_id;
            }
        }

        if (articulosEncontrados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes. Consulta con un abogado."
            });
        }

        console.log(`📚 ${articulosEncontrados.length} artículos encontrados`);

        let respuesta = await generarRespuestaDirecta(pregunta, articulosEncontrados, leyId);

        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosEncontrados);

        if (!citasValidas) {
            console.log('⚠️ Regenerando con más control...');
            respuesta = await generarRespuestaDirecta(pregunta, articulosEncontrados, leyId);
            
            const citasValidas2 = await verificarCitasEnRespuesta(respuesta, articulosEncontrados);
            if (!citasValidas2) {
                return res.json({
                    respuesta: "⚠️ No tengo información suficiente. Consulta con un abogado."
                });
            }
        }

        res.json({ respuesta });

    } catch (error) {
        console.error(`❌ Error:`, error);
        res.status(500).json({
            respuesta: "⚠️ Error en el servidor. Intenta de nuevo."
        });
    }
});

// ========== INICIO DEL SERVIDOR ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
});
