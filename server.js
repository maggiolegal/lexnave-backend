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

// ========== NORMALIZAR TEXTO (ELIMINAR TILDES Y CARACTERES ESPECIALES) ==========
function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Elimina tildes
        .replace(/[^a-z0-9 ]/g, '');      // Elimina caracteres especiales
}

// ========== FORZAR ARTÍCULOS POR TEMA (COMPLETO) ==========
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
    
    // ===== Código Civil (Ley 3) =====
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
    
    // ===== CPC - PROCEDIMIENTO ORDINARIO =====
    'procedimiento ordinario': ['340', '341', '342', '344', '345', '346', '347', '348', '395', '396', '397', '398', '399', '400', '511', '243', '244', '245'],
    'juicio ordinario': ['340', '341', '342', '344', '345', '346', '347', '348', '395', '396', '397', '398', '399', '400', '511', '243', '244', '245'],
    'ordinario': ['340', '341', '342', '344', '345', '346', '347', '348', '395', '396', '397', '398', '399', '400', '511', '243', '244', '245'],
    'demanda': ['340'],
    'requisitos demanda': ['340'],
    'libelo': ['340'],
    'admisión': ['341', '342'],
    'emplazamiento': ['218', '219', '220', '221', '222'],
    'citacion': ['218', '219', '220', '221', '222'],
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
    
    // ===== CPC - PROCEDIMIENTO ORAL =====
    'procedimiento oral': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'oral': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    'lapsos': ['859', '860', '861', '862', '863', '864', '865', '866', '867', '868', '869'],
    
    // ===== CPC - PROCEDIMIENTO BREVE =====
    'procedimiento breve': ['881', '882', '883', '884', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894'],
    'breve': ['881', '882', '883', '884', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894'],
    
    // ===== CPC - INTIMACIÓN =====
    'intimacion': ['640', '641', '642', '643', '644', '645', '646', '647', '648', '649', '650', '651', '652'],
    'cobro': ['640', '641', '642'],
    
    // ===== CPC - INTERDICTOS =====
    'interdicto': ['782', '783', '784', '785', '786', '787', '788', '789', '790'],
    'posesion': ['782', '783', '784', '785'],
    'daño temido': ['786', '787', '788'],
    
    // ===== CPC - MEDIDAS PREVENTIVAS =====
    'medidas preventivas': ['585', '586', '587', '588', '589', '590'],
    'medidas cautelares': ['585', '586', '587', '588', '589', '590'],
    'secuestro': ['585', '586', '587'],
    
    // ===== CPC - VÍA EJECUTIVA =====
    'via ejecutiva': ['630', '631', '632', '633', '634', '635', '636', '637', '638', '639'],
    'ejecutivo': ['630', '631', '632', '633', '634', '635', '636', '637', '638', '639'],
    'ejecucion forzosa': ['523', '524', '525', '526'],
    
    // ===== COPP =====
    'flagrancia': ['373'],
    'detencion': ['373', '374', '375'],
    'fianza': ['244', '245'],
    'medidas cautelares': ['236', '237', '238'],
    'privacion libertad': ['236', '237', '238'],
    'libertad provisional': ['242', '243', '244'],
    'arresto domiciliario': ['236', '237', '238'],
    'presentacion juez': ['373'],
    'aprehension': ['373', '374'],
    'plazo detencion': ['373'],
    'acto conclusivo': ['295'],
    'apelacion': ['438', '439'],
    'recurso': ['438', '439', '440', '441', '442', '443'],
    'casacion': ['443', '444', '445'],
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
    
    // ===== CRBV =====
    'derechos humanos': ['19', '20', '21', '22', '23'],
    'derecho a la vida': ['43'],
    'derecho a la libertad': ['44', '45', '46'],
    'integridad personal': ['46'],
    'debido proceso': ['49'],
    'derecho a la defensa': ['49'],
    'libertad de expresion': ['57'],
    'libertad de transito': ['50'],
    'libertad de reunion': ['52'],
    'libertad de asociacion': ['52'],
    'derecho a la informacion': ['58'],
    'derecho al trabajo': ['87', '88', '89', '90', '91', '92'],
    'derecho a la salud': ['83', '84'],
    'derecho a la educacion': ['102', '103', '104'],
    'derecho a la vivienda': ['82'],
    'derecho a la seguridad social': ['86'],
    'derecho a la alimentacion': ['84'],
    'derecho al agua': ['84'],
    'derecho al ambiente': ['127'],
    'derecho a la cultura': ['98', '99'],
    'derecho al deporte': ['111'],
    'derecho de los pueblos indigenas': ['119', '120', '121', '122', '123'],
    'derecho a la igualdad': ['21'],
    'derecho a la no discriminacion': ['21'],
    'amparo': ['26', '27', '49'],
    'habeas corpus': ['27'],
    'derecho a la propiedad': ['115'],
    'derecho a la familia': ['75', '76', '77', '78', '79', '80', '81'],
    'derecho de los niños': ['78', '79'],
    'derecho de los adolescentes': ['79'],
    'derecho de los adultos mayores': ['80'],
    'derecho de las personas con discapacidad': ['81'],
    'derecho a la mujer': ['88', '89'],
    'poder legislativo': ['186', '187', '188', '189', '190', '191', '192', '193', '194', '195'],
    'asamblea nacional': ['186', '187', '188', '189', '190', '191', '192', '193', '194', '195'],
    'poder ejecutivo': ['226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236'],
    'presidente': ['226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236'],
    'vicepresidente': ['238', '239', '240'],
    'ministros': ['241', '242', '243', '244'],
    'poder judicial': ['253', '254', '255', '256', '257', '258', '259', '260', '261', '262'],
    'tribunal supremo de justicia': ['253', '254', '255', '256', '257', '258', '259', '260', '261', '262'],
    'poder ciudadano': ['273', '274', '275', '276', '277', '278', '279', '280', '281'],
    'consejo moral republicano': ['273', '274', '275', '276'],
    'fiscalia': ['284', '285', '286', '287', '288', '289', '290', '291', '292', '293'],
    'contraloria': ['287', '288', '289', '290', '291', '292', '293'],
    'defensoria del pueblo': ['280', '281', '282', '283'],
    'poder electoral': ['292', '293', '294', '295', '296', '297', '298'],
    'cne': ['292', '293', '294', '295', '296', '297', '298'],
    'gobernador': ['160', '161', '162', '163'],
    'consejo legislativo': ['162', '163'],
    'sistema socioeconomico': ['299', '300', '301', '302', '303', '304', '305', '306', '307', '308'],
    'banco central de venezuela': ['318', '319', '320', '321'],
    'seguridad de la nacion': ['322', '323', '324', '325', '326', '327', '328', '329', '330', '331', '332', '333', '334', '335', '336'],
    'seguridad nacional': ['322', '323', '324', '325', '326', '327', '328', '329', '330', '331', '332', '333', '334', '335', '336'],
    'defensa nacional': ['322', '323', '324', '325', '326', '327', '328', '329', '330', '331', '332', '333', '334', '335', '336'],
    'estado de excepcion': ['337', '338', '339', '340'],
    'estados de excepcion': ['337', '338', '339', '340'],
    'fuerzas armadas': ['328', '329', '330', '331', '332', '333', '334', '335', '336'],
    'seguridad ciudadana': ['55', '56'],
    'control constitucional': ['334', '335', '336'],
    'inconstitucionalidad': ['334', '335', '336'],
    'reforma constitucional': ['341', '342', '343', '344', '345', '346', '347', '348', '349', '350'],
    'enmienda': ['341', '342', '343', '344', '345'],
    'asamblea nacional constituyente': ['347', '348', '349', '350'],
    
    // ===== Ley Violencia Mujer (Ley 9) =====
    'violencia mujer': ['1', '2', '3', '4', '5'],
    'medidas proteccion': ['1', '2', '3'],
    
    // ===== LPH (Ley 2) =====
    'propiedad horizontal': ['5', '7', '8', '9', '14'],
    'cuotas mantenimiento': ['14', '7', '5'],
    
    // ===== Código de Comercio (Ley 4) =====
    'letra cambio': ['410'],
    'pagare': ['410'],
    'cheque': ['410']
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
async function buscarPorSimilitud(pregunta, leyId = null, limite = 50) {
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
        
        console.log(`🔍 Búsqueda vectorial (ley ${leyId || 'todas'}): ${data?.length || 0} resultados`);
        
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

// ========== BÚSQUEDA POR TEXTO (FALLBACK) ==========
async function buscarPorTexto(pregunta, leyId = null, limite = 50) {
    try {
        const query = supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id');
        
        if (leyId) {
            query.eq('ley_id', parseInt(leyId));
        }
        
        query.limit(limite);
        
        const { data, error } = await query.execute();
        
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
    
    === CRITERIOS COMPLETOS ===
    
    LEY 1 - CONSTITUCIÓN: constitución, amparo, derechos humanos, seguridad de la nación, presidente, asamblea nacional, tribunal supremo
    
    LEY 2 - LPH: propiedad horizontal, condominio, vecino, cuotas mantenimiento
    
    LEY 3 - CÓDIGO CIVIL: matrimonio, divorcio, paternidad, filiación, alimentos, herencia, testamento, servidumbre, contrato, arrendamiento, prescripción, daños, accidente, responsabilidad
    
    LEY 4 - COMERCIO: letra cambio, pagaré, cheque, comercio, sociedad mercantil
    
    LEY 5 - COPP: detención, flagrancia, fianza, medidas cautelares, fiscal, juez, juicio oral, audiencia preliminar, acto conclusivo
    
    LEY 6 - CÓDIGO PENAL: hurto, robo, homicidio, lesiones, estafa, corrupción, peculado, penas
    
    LEY 7 - CPC: demanda, juicio, procedimiento, pruebas, embargo, intimación, interdicto, procedimiento oral, procedimiento breve, ejecución, apelación, ordinario
    
    LEY 8 - ARRENDAMIENTO VIVIENDA: arrendamiento vivienda, desalojo
    
    LEY 9 - VIOLENCIA MUJER: violencia mujer, medidas protección
    
    LEY 10 - ARRENDAMIENTO COMERCIAL: arrendamiento comercial, local comercial
    
    LEY 11 - REGISTROS: registro, notaría, protocolización

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
        console.log(`📋 Clasificación (70B): Ley ${result.ley_id}`);
        return result;
    } catch (error) {
        console.warn("⚠️ Clasificación falló, usando fallback por keywords...");
        const lower = pregunta.toLowerCase();
        
        if (lower.includes('constitución') || lower.includes('amparo') || lower.includes('seguridad de la nación')) return { ley_id: 1 };
        if (lower.includes('hurto') || lower.includes('robo') || lower.includes('homicidio') || 
            lower.includes('lesiones') || lower.includes('pena') || lower.includes('delito')) return { ley_id: 6 };
        if (lower.includes('detención') || lower.includes('flagrancia') || lower.includes('fiscal') || 
            lower.includes('juez') || lower.includes('juicio oral') || lower.includes('audiencia preliminar')) return { ley_id: 5 };
        if (lower.includes('paternidad') || lower.includes('divorcio') || lower.includes('matrimonio') || 
            lower.includes('herencia') || lower.includes('testamento') || lower.includes('contrato') ||
            lower.includes('prescripcion') || lower.includes('daños') || lower.includes('accidente')) return { ley_id: 3 };
        if (lower.includes('demanda') || lower.includes('juicio') || lower.includes('procedimiento') ||
            lower.includes('pruebas') || lower.includes('embargo') || lower.includes('intimación') ||
            lower.includes('interdicto') || lower.includes('oral') || lower.includes('breve') || 
            lower.includes('ordinario') || lower.includes('ejecución')) return { ley_id: 7 };
        if (lower.includes('violencia mujer') || lower.includes('violencia género')) return { ley_id: 9 };
        if (lower.includes('letra') || lower.includes('comercio') || lower.includes('pagare')) return { ley_id: 4 };
        if (lower.includes('propiedad horizontal') || lower.includes('condominio')) return { ley_id: 2 };
        if (lower.includes('arrendamiento vivienda') || lower.includes('desalojo')) return { ley_id: 8 };
        if (lower.includes('registro') || lower.includes('notaría')) return { ley_id: 11 };
        
        return { ley_id: 3 };
    }
}

// ========== FORZAR ARTÍCULOS EN CANDIDATOS ==========
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

// ========== RESPUESTA CON 70B ==========
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
    
    const mejores = candidatos.slice(0, 15);
    
    let contextoLegal = "";
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        const texto = a.contenido.substring(0, 350);
        contextoLegal += `\nArt. ${a.numero_articulo}: ${texto}...\n`;
    }
    
    let instruccionForzada = "";
    if (articulosForzados.length > 0) {
        instruccionForzada = `\n⚠️ DEBES citar el(los) artículo(s) ${articulosForzados.join(', ')} en tu respuesta.`;
    }
    
    const systemPrompt = `
Eres "LexnaVe", asistente jurídico experto en leyes venezolanas.

⚠️ INSTRUCCIONES ESTRICTAS:
1. Extrae palabras clave de la pregunta.
2. Lee todos los artículos del contexto.
3. Selecciona el artículo con MÁS coincidencias con las palabras clave.
4. Cita el artículo TEXTUALMENTE entre comillas.
5. NO inventes artículos. Si no encuentras, di "No tengo información suficiente".${instruccionForzada}

ESTRUCTURA OBLIGATORIA:
1. INTRODUCCIÓN (2 líneas)
2. "Según el Artículo X de la Ley Y: [texto literal]"
3. Explicación breve
4. ACCIONES RECOMENDADAS (3 pasos)
5. ⚖️ Esto es orientación general. Consulta con un abogado.
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
            temperature: 0.2,
            max_tokens: 800
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
        return false;
    }
    
    const idsContexto = [];
    for (const art of candidatos) {
        const num = art.numero_articulo.toString().replace(/\D/g, '');
        if (num) idsContexto.push(parseInt(num));
    }
    
    const invalidos = articulosMencionados.filter(a => !idsContexto.includes(a));
    if (invalidos.length > 0) {
        console.log(`⚠️ Artículos alucinados: ${invalidos.join(', ')}`);
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
        
        let articulosEncontrados = await buscarPorSimilitud(pregunta, leyId, 50);
        articulosEncontrados = await forzarArticulosClave(pregunta, articulosEncontrados, leyId);

        if (articulosEncontrados.length === 0) {
            console.log('🔄 Buscando en todas las leyes...');
            articulosEncontrados = await buscarPorSimilitud(pregunta, null, 50);
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
            console.log('⚠️ Regenerando...');
            const masCandidatos = await buscarPorSimilitud(pregunta, leyId, 80);
            if (masCandidatos.length > articulosEncontrados.length) {
                respuesta = await generarRespuestaDirecta(pregunta, masCandidatos, leyId);
                const citasValidas2 = await verificarCitasEnRespuesta(respuesta, masCandidatos);
                if (!citasValidas2) {
                    return res.json({
                        respuesta: "⚠️ No tengo información suficiente. Consulta con un abogado."
                    });
                }
            } else {
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
