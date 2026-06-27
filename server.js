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

// ========== ARTÍCULOS CLAVE POR TEMA ==========
const FORZAR_ARTICULOS = {
    // ===== Código Penal (Ley 6) =====
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
    'pena': ['451', '455', '405', '406'],
    'prision': ['451', '455', '405', '406'],
    
    // ===== Código Civil (Ley 3) =====
    'prescripcion': ['1969', '1950', '1951', '1952'],
    'plazo': ['1969'],
    'divorcio': ['185', '186', '187'],
    'separacion': ['185', '186', '187'],
    'matrimonio': ['82', '83', '84', '85', '86', '87', '88'],
    'paternidad': ['210', '211', '212', '215'],
    'filiacion': ['210', '211', '212'],
    'alimentos': ['282', '283', '284'],
    'herencia': ['991', '992', '993', '994'],
    'testamento': ['991', '992', '993', '994'],
    'sucesion': ['991', '992', '993', '994'],
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
    'propiedad': ['545', '546', '547'],
    'posesion': ['771', '772', '773'],
    'usucapion': ['1977', '1978'],
    
    // ===== CPC =====
    'procedimiento oral': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'oral': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'lapsos': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'procedimiento breve': ['881', '882', '883', '884', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894'],
    'breve': ['881', '882', '883', '884', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894'],
    'intimacion': ['640', '641', '642'],
    'cobro': ['640', '641', '642'],
    'interdicto': ['782', '783', '784', '785'],
    'posesion': ['782', '783', '784', '785'],
    'demanda': ['340'],
    'requisitos demanda': ['340'],
    'libelo': ['340'],
    'citacion': ['218', '219', '220', '221', '222'],
    'emplazamiento': ['218', '219', '220', '221', '222'],
    'contestacion': ['344', '345', '346'],
    'pruebas': ['395', '396', '397', '398', '399', '400'],
    'lapso probatorio': ['395', '396', '397'],
    'testigos': ['478', '479', '480', '481', '482', '483'],
    'sentencia': ['243', '244', '245'],
    'ejecucion': ['523', '524', '525', '526'],
    'embargo': ['585', '586', '587'],
    'apelacion': ['288', '289', '290', '291'],
    'casacion': ['312', '313'],
    'via ejecutiva': ['630', '631', '632', '633', '634', '635', '636', '637', '638', '639'],
    'ejecutivo': ['630', '631', '632', '633', '634', '635', '636', '637', '638', '639'],
    'medidas preventivas': ['585', '586', '587', '588', '589', '590'],
    'medidas cautelares': ['585', '586', '587', '588', '589', '590'],
    'secuestro': ['585', '586', '587'],
    
    // ===== COPP =====
    'flagrancia': ['373'],
    'detencion': ['373', '374', '375'],
    'fianza': ['244', '245'],
    'medidas cautelares': ['236', '237', '238'],
    'privacion libertad': ['236', '237', '238'],
    'libertad provisional': ['242', '243', '244'],
    'presentacion juez': ['373'],
    'acto conclusivo': ['295'],
    'juicio oral': ['332', '333', '334', '335', '336', '337', '338'],
    'audiencia preliminar': ['309', '310', '311', '312'],
    'procedimiento abreviado': ['372', '373'],
    'derecho defensa': ['8', '9', '10'],
    'presuncion inocencia': ['8'],
    'debido proceso penal': ['8', '9'],
    'apelacion': ['438', '439'],
    'casacion': ['443', '444', '445'],
    
    // ===== CRBV =====
    'derechos humanos': ['19', '20', '21', '22', '23'],
    'derecho a la vida': ['43'],
    'derecho a la libertad': ['44', '45', '46'],
    'debido proceso': ['49'],
    'derecho a la defensa': ['49'],
    'libertad de expresion': ['57'],
    'libertad de transito': ['50'],
    'derecho al trabajo': ['87', '88', '89', '90', '91', '92'],
    'derecho a la salud': ['83', '84'],
    'derecho a la educacion': ['102', '103', '104'],
    'derecho a la vivienda': ['82'],
    'derecho a la seguridad social': ['86'],
    'derecho al ambiente': ['127'],
    'amparo': ['26', '27', '49'],
    'habeas corpus': ['27'],
    'derecho a la propiedad': ['115'],
    'derecho a la familia': ['75', '76', '77', '78', '79', '80', '81'],
    'derecho de los niños': ['78', '79'],
    'derecho de los adultos mayores': ['80'],
    'derecho de las personas con discapacidad': ['81'],
    'derecho a la mujer': ['88', '89'],
    'seguridad de la nacion': ['322'],
    'estado de excepcion': ['337', '338', '339'],
    'control constitucional': ['334', '335', '336'],
    'inconstitucionalidad': ['334', '335', '336'],
    'presidente': ['226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236'],
    'asamblea nacional': ['186', '187', '188', '189', '190', '191', '192', '193', '194', '195'],
    'tribunal supremo': ['253', '254', '255', '256', '257', '258', '259', '260', '261', '262'],
    'poder ciudadano': ['273', '274', '275', '276', '277', '278', '279', '280', '281'],
    'fiscalia': ['284', '285', '286', '287', '288', '289', '290', '291', '292', '293'],
    'contraloria': ['287', '288', '289', '290', '291', '292', '293'],
    'defensoria pueblo': ['280', '281', '282', '283'],
    'cne': ['292', '293', '294', '295', '296', '297', '298'],
    'poder electoral': ['292', '293', '294', '295', '296', '297', '298'],
    'gobernador': ['160', '161', '162', '163'],
    'reforma constitucional': ['341', '342', '343', '344', '345', '346', '347', '348', '349', '350'],
    'enmienda': ['341', '342', '343', '344', '345'],
    
    // ===== LPH =====
    'propiedad horizontal': ['5', '7', '8', '9', '14'],
    'condominio': ['5', '7', '8', '9', '14'],
    'vecino': ['5', '7', '8', '9', '14'],
    'cuotas mantenimiento': ['14', '7', '5'],
    'administrador': ['18', '19', '20', '21'],
    'junta condominio': ['18', '19'],
    'asamblea copropietarios': ['18', '19', '22', '23', '24'],
    'cosas comunes': ['5', '8', '11'],
    'gastos comunes': ['11', '12', '13', '14'],
    'documento condominio': ['26', '27', '28', '29'],
    'sanciones': ['39', '40', '41', '42', '43', '44', '45', '46', '47'],
    'ruido': ['3', '8'],
    'molestias': ['3', '8'],
    
    // ===== Comercio =====
    'letra cambio': ['410'],
    'pagare': ['410'],
    'cheque': ['410'],
    'endoso': ['410', '411', '412'],
    'aval': ['410', '411', '412'],
    'protesto': ['413', '414'],
    'sociedad mercantil': ['200', '201', '202'],
    'sociedad anonima': ['200', '201', '202'],
    'empresa': ['2', '5', '10'],
    'comerciante': ['2', '5', '10'],
    'acto comercio': ['2', '5', '10'],
    
    // ===== Violencia Mujer =====
    'violencia mujer': ['1', '2', '3', '4', '5'],
    'violencia genero': ['1', '2', '3', '4', '5'],
    'violencia domestica': ['1', '2', '3', '4', '5'],
    'medidas proteccion': ['1', '2', '3'],
    'violencia psicologica': ['1', '2', '3'],
    'violencia fisica': ['1', '2', '3'],
    'violencia sexual': ['1', '2', '3'],
    'violencia patrimonial': ['1', '2', '3'],
    'acoso sexual': ['1', '2', '3'],
    
    // ===== Arrendamiento Vivienda =====
    'arrendamiento vivienda': ['1', '2', '3', '4', '5'],
    'desalojo': ['20', '21', '22'],
    'canon': ['1', '2', '3'],
    'contrato arrendamiento': ['1', '2', '3'],
    
    // ===== Registros =====
    'registro': ['1', '2', '3'],
    'notaría': ['1', '2', '3'],
    'protocolizacion': ['1', '2', '3'],
    'registro publico': ['1', '2', '3']
};

// ========== MODELO DE EMBEDDING ==========
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
            console.log('📝 Embedding no disponible, usando búsqueda por texto');
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
            console.log(`✅ Artículo ${numeroArticulo} encontrado: "${data.numero_articulo}"`);
            return {
                id: data.id,
                numero_articulo: data.numero_articulo,
                contenido: data.contenido,
                ley_id: data.ley_id,
                ley_nombre: LEY_MAP[data.ley_id] || 'Ley',
                similitud: 0.99
            };
        }
        console.log(`❌ Artículo ${numeroArticulo} NO encontrado en ley ${leyId}`);
        return null;
    } catch (e) {
        console.error(`❌ Error buscando artículo ${numeroArticulo}:`, e.message);
        return null;
    }
}

// ========== CLASIFICACIÓN ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la consulta.

    REGLAS:
    - Divorcio, matrimonio, hijos, alimentos, herencia, contrato, daños, accidente → Ley 3 (Código Civil)
    - Hurto, robo, homicidio, delito, pena → Ley 6 (Código Penal)
    - Detención, flagrancia, fiscal, juez, imputado → Ley 5 (COPP)
    - Demanda, juicio, procedimiento, pruebas, embargo → Ley 7 (CPC)
    - Propiedad horizontal, condominio, vecino, cuotas → Ley 2 (LPH)
    - Constitución, amparo, derechos humanos → Ley 1 (CRBV)
    - Letra de cambio, comercio, sociedad → Ley 4 (Comercio)
    - Violencia, maltrato, mujer → Ley 9
    - Arrendamiento vivienda, desalojo → Ley 8
    - Registro, notaría → Ley 11

    Consulta: "${pregunta}"
    Responde SOLO con JSON: {"ley_id": número}
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
        if (lower.includes('divorcio') || lower.includes('matrimonio') || lower.includes('hijo') || 
            lower.includes('herencia') || lower.includes('contrato') || lower.includes('accidente') ||
            lower.includes('daños') || lower.includes('prescripcion')) return { ley_id: 3 };
        if (lower.includes('hurto') || lower.includes('robo') || lower.includes('delito') || 
            lower.includes('pena') || lower.includes('homicidio')) return { ley_id: 6 };
        if (lower.includes('detención') || lower.includes('flagrancia') || lower.includes('fiscal') || 
            lower.includes('juez') || lower.includes('imputado')) return { ley_id: 5 };
        if (lower.includes('demanda') || lower.includes('juicio') || lower.includes('procedimiento') ||
            lower.includes('pruebas') || lower.includes('embargo') || lower.includes('intimación')) return { ley_id: 7 };
        if (lower.includes('condominio') || lower.includes('propiedad horizontal') || lower.includes('vecino')) return { ley_id: 2 };
        if (lower.includes('constitución') || lower.includes('amparo') || lower.includes('derechos')) return { ley_id: 1 };
        if (lower.includes('letra') || lower.includes('cheque') || lower.includes('comercio')) return { ley_id: 4 };
        if (lower.includes('violencia') || lower.includes('maltrato') || lower.includes('mujer')) return { ley_id: 9 };
        if (lower.includes('desalojo') || lower.includes('arrendamiento vivienda')) return { ley_id: 8 };
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

// ========== GENERAR RESPUESTA ==========
async function generarRespuesta(pregunta, articulos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    const mejores = articulos.slice(0, 5);
    
    let contextoLegal = "";
    const numerosArticulos = [];
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        numerosArticulos.push(a.numero_articulo);
        const texto = a.contenido.substring(0, 300);
        contextoLegal += `\n--- Artículo ${a.numero_articulo} ---\n${texto}...\n`;
    }
    
    let instruccion = "";
    if (numerosArticulos.length > 0) {
        instruccion = `\n⚠️ SOLO puedes citar los artículos ${numerosArticulos.join(', ')}. No cites ningún otro artículo. Si citas otro, tu respuesta será inválida.`;
    }
    
    const systemPrompt = `
Eres "LexnaVe", un asistente jurídico venezolano.

⚠️ REGLA DE ORO:
1. SOLO puedes citar los artículos que están en el CONTEXTO.
2. ${instruccion}
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

INSTRUCCIÓN: Responde con la estructura indicada.
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
        return null;
    }
}

// ========== VALIDAR Y LIMPIAR CITAS ==========
function limpiarRespuesta(respuesta, articulos) {
    const regex = /Art(?:ículo)?\.?\s*(\d+)/gi;
    const matches = respuesta.matchAll(regex);
    const articulosMencionados = [...new Set([...matches].map(m => parseInt(m[1])))];
    
    if (articulosMencionados.length === 0) {
        return respuesta;
    }
    
    const idsContexto = [];
    for (const art of articulos) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }
    
    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));
    
    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados: ${invalidos.join(', ')}`);
        console.log(`📚 Artículos disponibles: ${idsContexto.join(', ')}`);
        
        // Si hay alucinaciones, construir respuesta fallback con los artículos correctos
        const numeros = articulos.slice(0, 3).map(a => a.numero_articulo).join(', ');
        return `Según el Código Civil, los artículos relevantes son: ${numeros}. Consulta con un abogado para un análisis detallado.`;
    }
    
    console.log(`✅ Artículos citados existen en el contexto`);
    return respuesta;
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
        
        let articulos = await buscarPorSimilitud(pregunta, leyId, 30);
        articulos = await forzarArticulosClave(pregunta, articulos, leyId);

        if (articulos.length === 0) {
            console.log('🔄 Buscando en todas las leyes...');
            articulos = await buscarPorSimilitud(pregunta, null, 30);
            if (articulos.length > 0) {
                leyId = articulos[0].ley_id;
            }
        }

        if (articulos.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes. Consulta con un abogado."
            });
        }

        console.log(`📚 ${articulos.length} artículos encontrados`);

        let respuesta = await generarRespuesta(pregunta, articulos, leyId);

        if (respuesta) {
            respuesta = limpiarRespuesta(respuesta, articulos);
        }

        res.json({ respuesta: respuesta || "⚠️ No tengo información suficiente. Consulta con un abogado." });

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
