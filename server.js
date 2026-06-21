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

// ========== ARTÍCULOS CLAVE POR LEY ==========
const ARTICULOS_CLAVE = {
    // ===== LEY 1: CRBV =====
    1: {
        'amparo': ['26', '27', '49'],
        'derecho propiedad': ['115'],
        'estado excepcion': ['337', '338', '339'],
        'debido proceso': ['49'],
        'derechos humanos': ['19', '20', '21', '22', '23'],
        'libertad expresion': ['57'],
        'libertad transito': ['50'],
        'derecho trabajo': ['87', '88', '89'],
        'derecho salud': ['83', '84'],
        'derecho educacion': ['102', '103'],
        'derecho vivienda': ['82'],
        'derecho alimentacion': ['84'],
        'derecho agua': ['84'],
        'derecho ambiente': ['127'],
        'derecho cultura': ['98', '99'],
        'derecho deporte': ['111'],
        'derecho seguridad social': ['86'],
        'derecho familia': ['75', '76', '77'],
        'derecho niños': ['78', '79'],
        'derecho adultos mayores': ['80'],
        'derecho discapacidad': ['81'],
        'derecho pueblos indígenas': ['119', '120', '121'],
        'derecho mujer': ['88', '89']
    },
    
    // ===== LEY 2: LPH =====
    2: {
        'propiedad horizontal': ['5', '7', '8', '9', '14'],
        'condominio': ['5', '7', '8', '9', '14'],
        'cuotas mantenimiento': ['14', '7', '5'],
        'administrador': ['18', '19', '20', '21'],
        'junta condominio': ['18', '19'],
        'asamblea copropietarios': ['18', '19', '22', '23', '24'],
        'cosas comunes': ['5', '8', '11'],
        'gastos comunes': ['11', '12', '13', '14'],
        'documento condominio': ['26', '27', '28', '29'],
        'reparaciones': ['22', '23', '24'],
        'sanciones': ['39', '40', '41', '42', '43', '44', '45', '46', '47']
    },
    
    // ===== LEY 3: CÓDIGO CIVIL =====
    3: {
        // PRIORIDAD ALTA (temas específicos primero)
        'servidumbre luces': ['571', '572', '573', '574', '575', '576', '577'],
        'servidumbre vistas': ['571', '572', '573', '574', '575', '576', '577'],
        'luz natural': ['571', '572', '573', '574'],
        'muro': ['571', '572', '573'],
        'pared medianera': ['571', '572'],
        'distancia construccion': ['571', '572', '573'],
        'servidumbre': ['571', '572', '573', '574', '575', '576', '577'],
        
        // PRIORIDAD MEDIA
        'vias de hecho': ['548'],
        'prescripcion': ['1969', '1950', '1951', '1952'],
        'plazo prescripcion': ['1969'],
        'interrupcion prescripcion': ['1969'],
        'contrato': ['1137', '1140', '1145'],
        'arrendamiento': ['1576', '1577', '1578'],
        'matrimonio': ['82', '83', '84', '85', '86', '87', '88'],
        'divorcio': ['185', '186', '187'],
        'separacion': ['185', '186', '187'],
        'filiacion': ['210', '211', '212'],
        'patria potestad': ['262', '263', '264'],
        'alimentos': ['282', '283', '284'],
        'herencia': ['991', '992', '993', '994'],
        'testamento': ['991', '992', '993', '994'],
        'sucesion': ['991', '992', '993', '994'],
        'albacea': ['971', '972', '973'],
        'legitima': ['994', '995', '996'],
        'usucapion': ['1977', '1978'],
        'propiedad': ['545', '546', '547'],
        'posesion': ['771', '772', '773'],
        'accesion': ['571', '572', '573'],
        'obligaciones': ['1137', '1138', '1139'],
        'pago': ['1300', '1301', '1302'],
        'incumplimiento': ['1137', '1138', '1139'],
        
        // PRIORIDAD BAJA (genéricos)
        'daños y perjuicios': ['1185', '1190', '1810', '1969'],
        'accidente transito': ['1185', '1810', '1969'],
        'responsabilidad civil': ['1185', '1190']
    },
    
    // ===== LEY 4: CÓDIGO DE COMERCIO =====
    4: {
        'letra cambio': ['410'],
        'requisitos letra': ['410'],
        'pagare': ['410'],
        'cheque': ['410'],
        'endoso': ['410', '411', '412'],
        'aval': ['410', '411', '412'],
        'protesto': ['413', '414'],
        'vencimiento': ['413', '414'],
        'aceptacion': ['411', '412'],
        'sociedad mercantil': ['200', '201', '202'],
        'sociedad anonima': ['200', '201', '202'],
        'empresa': ['2', '5', '10'],
        'comerciante': ['2', '5', '10'],
        'acto comercio': ['2', '5', '10'],
        'compraventa mercantil': ['2', '5', '10'],
        'seguro': ['2', '5', '10'],
        'cuenta corriente': ['2', '5', '10']
    },
    
    // ===== LEY 5: COPP =====
    5: {
        'flagrancia': ['373'],
        'detencion': ['373', '374', '375'],
        'presentacion juez': ['373'],
        'aprehension': ['373', '374'],
        'plazo detencion': ['373'],
        'medidas cautelares': ['236', '237', '238'],
        'privacion libertad': ['236', '237', '238'],
        'libertad provisional': ['242', '243', '244'],
        'fianza': ['244', '245'],
        'caución': ['244', '245'],
        'arresto domiciliario': ['236', '237', '238'],
        'presentacion periodica': ['242', '243', '244'],
        'procedimiento abreviado': ['372', '373'],
        'procedimiento ordinario': ['373'],
        'juicio oral': ['332', '333', '334'],
        'audiencia preliminar': ['309', '310'],
        'acto conclusivo': ['295'],
        'fase preparatoria': ['295'],
        'investigacion': ['295', '296'],
        'imputacion': ['295'],
        'fiscalia': ['295', '373'],
        'homicidio': ['405', '406'],
        'violacion': ['374', '375'],
        'secuestro': ['374', '375'],
        'robo': ['374', '375'],
        'hurto': ['374', '375'],
        'lesiones': ['374', '375'],
        'derecho defensa': ['8', '9', '10'],
        'presuncion inocencia': ['8'],
        'debido proceso penal': ['8', '9'],
        'derecho silencio': ['8', '9', '10'],
        'apelacion': ['438', '439'],
        'recurso': ['438', '439'],
        'casacion': ['438', '439']
    },
    
    // ===== LEY 6: CÓDIGO PENAL =====
    6: {
        'hurto': ['451', '452', '453'],
        'robo': ['455', '456', '457'],
        'robo agravado': ['456', '457'],
        'hurto agravado': ['452', '453'],
        'estafa': ['461', '462'],
        'fraude': ['461', '462'],
        'apropiacion indebida': ['465', '466'],
        'daño a propiedad': ['451', '452', '453'],
        'homicidio': ['405', '406'],
        'homicidio calificado': ['406'],
        'homicidio culposo': ['409'],
        'lesiones': ['413', '414'],
        'lesiones graves': ['414'],
        'lesiones culposas': ['415'],
        'violacion': ['374', '375'],
        'abuso sexual': ['375', '376'],
        'acoso sexual': ['375', '376'],
        'violencia': ['413', '414'],
        'secuestro': ['460'],
        'extorsion': ['460'],
        'coaccion': ['460'],
        'amenaza': ['460'],
        'privacion libertad': ['460'],
        'corrupcion': ['60', '61', '62'],
        'peculado': ['63', '64'],
        'malversacion': ['63', '64'],
        'concusion': ['65', '66'],
        'cohecho': ['67', '68'],
        'prevaricacion': ['70', '71'],
        'narcotrafico': ['460'],
        'falsificacion': ['450'],
        'falsedad': ['450'],
        'perjurio': ['450'],
        'falso testimonio': ['450'],
        'contrabando': ['460'],
        'tráfico drogas': ['460'],
        'legitimacion capitales': ['460'],
        'lavado dinero': ['460'],
        'pena': ['451', '455', '405', '406'],
        'prision': ['451', '455', '405', '406'],
        'presidio': ['451', '455', '405', '406'],
        'arresto': ['451', '455', '405', '406'],
        'multa': ['451', '455', '405', '406'],
        'reincidencia': ['26'],
        'atenuantes': ['27', '28', '29'],
        'agravantes': ['30', '31'],
        'eximentes': ['27', '28', '29']
    },
    
    // ===== LEY 7: CPC =====
    7: {
        'intimacion': ['640', '641', '642'],
        'procedimiento breve': ['881', '882', '883'],
        'ejecucion': ['650', '651', '652'],
        'procedimiento civil': ['340', '341', '342'],
        'demanda': ['340'],
        'juicio': ['340', '341'],
        'apelacion': ['340', '341'],
        'recurso': ['340', '341'],
        'medidas preventivas': ['585', '586', '587'],
        'embargo': ['585', '586', '587'],
        'secuestro': ['585', '586', '587'],
        'pruebas': ['395', '396', '397'],
        'testigos': ['395', '396', '397'],
        'documentos': ['395', '396', '397'],
        'confesion': ['395', '396', '397'],
        'citacion': ['174', '175', '176'],
        'notificacion': ['174', '175', '176'],
        'emplazamiento': ['174', '175', '176']
    },
    
    // ===== LEY 8: ARRENDAMIENTO VIVIENDA =====
    8: {
        'arrendamiento vivienda': ['1', '2', '3', '4', '5'],
        'canon': ['1', '2', '3'],
        'desalojo': ['20', '21', '22'],
        'contrato arrendamiento': ['1', '2', '3'],
        'derechos arrendatario': ['1', '2', '3'],
        'obligaciones arrendador': ['1', '2', '3']
    },
    
    // ===== LEY 9: VIOLENCIA MUJER =====
    9: {
        'violencia mujer': ['1', '2', '3'],
        'violencia genero': ['1', '2', '3'],
        'violencia domestica': ['1', '2', '3'],
        'violencia intrafamiliar': ['1', '2', '3'],
        'medidas proteccion': ['1', '2', '3']
    },
    
    // ===== LEY 10: ARRENDAMIENTO COMERCIAL =====
    10: {
        'arrendamiento comercial': ['1', '2', '3'],
        'local comercial': ['1', '2', '3'],
        'canon comercial': ['1', '2', '3']
    },
    
    // ===== LEY 11: REGISTROS =====
    11: {
        'registro': ['1', '2', '3'],
        'notaría': ['1', '2', '3'],
        'registro publico': ['1', '2', '3'],
        'protocolizacion': ['1', '2', '3']
    }
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

// ========== BÚSQUEDA POR SIMILITUD ==========
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

// ========== BUSCAR ARTÍCULO CLAVE ==========
async function buscarArticuloClave(leyId, numeroArticulo) {
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
                similitud: 0.95
            };
        }
        return null;
    } catch (e) {
        console.error(`❌ Error buscando artículo ${numeroArticulo}:`, e.message);
        return null;
    }
}

// ========== BÚSQUEDA HÍBRIDA CON PRIORIDAD DE TEMAS ==========
async function buscarArticulosHibrido(pregunta, leyId, limite = 50) {
    let resultados = [];
    let articulosClaveEncontrados = [];
    
    const preguntaLower = pregunta.toLowerCase();
    
    // 1. BUSCAR ARTÍCULOS CLAVE CON PRIORIDAD
    if (leyId && ARTICULOS_CLAVE[leyId]) {
        const temasDeLaLey = ARTICULOS_CLAVE[leyId];
        
        // Definir prioridad de temas (más específicos primero)
        const prioridadTemas = [
            'servidumbre luces',
            'servidumbre vistas',
            'luz natural',
            'muro',
            'pared medianera',
            'distancia construccion',
            'servidumbre',
            'vias de hecho',
            'flagrancia',
            'detencion',
            'presentacion juez',
            'letra cambio',
            'requisitos letra',
            'propiedad horizontal',
            'cuotas mantenimiento',
            'amparo',
            'estado excepcion',
            'daños y perjuicios',
            'responsabilidad civil',
            'hurto',
            'robo',
            'homicidio'
        ];
        
        // Ordenar temas según prioridad
        const temasOrdenados = Object.keys(temasDeLaLey).sort((a, b) => {
            const indexA = prioridadTemas.indexOf(a);
            const indexB = prioridadTemas.indexOf(b);
            const pesoA = indexA !== -1 ? prioridadTemas.length - indexA : 0;
            const pesoB = indexB !== -1 ? prioridadTemas.length - indexB : 0;
            return pesoB - pesoA;
        });
        
        let temaEncontrado = false;
        
        for (const tema of temasOrdenados) {
            const articulos = temasDeLaLey[tema];
            // Verificar si el tema está en la pregunta (exacto o por palabras)
            const temaEnPregunta = preguntaLower.includes(tema) || 
                tema.split(' ').some(palabra => preguntaLower.includes(palabra));
            
            if (temaEnPregunta) {
                console.log(`🔑 Tema detectado en ley ${leyId}: "${tema}" (prioridad alta)`);
                
                for (const numArt of articulos) {
                    const articulo = await buscarArticuloClave(leyId, numArt);
                    if (articulo) {
                        articulosClaveEncontrados.push(articulo);
                        console.log(`✅ Artículo clave encontrado: Art. ${numArt} de ${LEY_MAP[leyId]}`);
                    }
                }
                temaEncontrado = true;
                break;
            }
        }
        
        // Si no se detectó ningún tema específico, usar el primero de la lista
        if (!temaEncontrado && Object.keys(temasDeLaLey).length > 0) {
            const primerTema = Object.keys(temasDeLaLey)[0];
            console.log(`⚠️ Usando tema por defecto: "${primerTema}"`);
            for (const numArt of temasDeLaLey[primerTema]) {
                const articulo = await buscarArticuloClave(leyId, numArt);
                if (articulo) {
                    articulosClaveEncontrados.push(articulo);
                }
            }
        }
    }
    
    // 2. BÚSQUEDA VECTORIAL
    const vectoriales = await buscarPorSimilitud(pregunta, leyId, limite);
    console.log(`📊 Vectorial en ley ${leyId}: ${vectoriales.length} resultados`);
    
    // 3. COMBINAR
    if (articulosClaveEncontrados.length > 0) {
        const idsClave = new Set(articulosClaveEncontrados.map(a => a.id));
        const vectorialesFiltrados = vectoriales.filter(a => !idsClave.has(a.id));
        resultados = [...articulosClaveEncontrados, ...vectorialesFiltrados];
        console.log(`📊 Híbrido: ${resultados.length} resultados (${articulosClaveEncontrados.length} clave + ${vectorialesFiltrados.length} vectorial)`);
    } else {
        resultados = vectoriales;
    }
    
    // 4. SI AÚN HAY POCOS RESULTADOS, BUSCAR POR TEXTO
    if (resultados.length < 5) {
        console.log('🔍 Pocos resultados. Activando búsqueda textual...');
        const textuales = await buscarPorTexto(pregunta, leyId, 20);
        const idsExistentes = new Set(resultados.map(a => a.id));
        const textualesFiltrados = textuales.filter(a => !idsExistentes.has(a.id));
        resultados = [...resultados, ...textualesFiltrados];
    }
    
    return resultados;
}

// ========== GROQ: CLASIFICAR CONSULTA ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Eres un experto en derecho venezolano. Clasifica la siguiente consulta legal.
    
    CRITERIOS DE CLASIFICACIÓN:
    - "Servidumbre", "luz natural", "muro", "pared medianera" → Código Civil (Ley 3)
    - "Prescripción", "plazo", "daños", "perjuicios", "responsabilidad civil" → Código Civil (Ley 3)
    - "Hurto", "robo", "pena", "prisión", "delito" → Código Penal (Ley 6)
    - "Detención", "flagrancia", "fiscal", "juez" → COPP (Ley 5)
    - "Letra de cambio", "comercio", "sociedad", "empresa" → Código de Comercio (Ley 4)
    - "Propiedad horizontal", "condominio", "vecino", "cuotas" → LPH (Ley 2)
    - "Constitución", "amparo", "derechos humanos" → CRBV (Ley 1)
    - "Procedimiento", "juicio", "demanda" → CPC (Ley 7)
    - "Arrendamiento vivienda" → Ley 8
    - "Violencia mujer" → Ley 9

    Leyes disponibles:
    1: CRBV, 2: LPH, 3: Código Civil, 4: Código de Comercio, 5: COPP, 6: Código Penal, 7: CPC, 8: Arrendamiento Vivienda, 9: Violencia Mujer, 10: Arrendamiento Comercial, 11: Registros

    Consulta: "${pregunta}"

    Responde SOLO con JSON:
    {"ley_id": número, "tema": "descripción breve", "confianza": "alta/media/baja"}
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id} (${LEY_MAP[result.ley_id] || 'Desconocida'}), Confianza: ${result.confianza}`);
        return result;
    } catch (error) {
        console.error("Error en clasificación:", error);
        return { ley_id: null, tema: null, confianza: 'baja' };
    }
}

// ========== GROQ: SELECCIONAR ARTÍCULOS RELEVANTES ==========
async function seleccionarArticulosRelevantes(pregunta, articulos, leyId) {
    if (!articulos || articulos.length === 0) return [];
    
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
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
            console.log('⚠️ No se seleccionaron artículos, usando los primeros 10');
            return articulos.slice(0, 10);
        }

        const articulosSeleccionados = articulos.filter((_, index) => 
            seleccionados.includes(index + 1) || seleccionados.includes(articulos[index].id)
        );

        console.log(`📊 Artículos seleccionados: ${articulosSeleccionados.map(a => a.numero_articulo).join(', ')}`);
        return articulosSeleccionados.length > 0 ? articulosSeleccionados : articulos.slice(0, 10);
    } catch (error) {
        console.error("Error en selección de artículos:", error);
        return articulos.slice(0, 10);
    }
}

// ========== GROQ: GENERAR RESPUESTA ==========
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
            console.log('⚠️ No se detectó ley, usando Código Civil (Ley 3) como fallback');
            leyId = 3;
        }

        console.log(`🔍 Buscando en ley ${leyId} (${LEY_MAP[leyId]})`);
        
        // 2. BÚSQUEDA HÍBRIDA CON PRIORIDAD
        let articulosEncontrados = await buscarArticulosHibrido(pregunta, leyId, 50);

        // 3. SI NO ENCUENTRA RESULTADOS, BUSCAR EN TODAS LAS LEYES
        if (articulosEncontrados.length === 0) {
            console.log('🔄 No se encontraron resultados en la ley detectada. Buscando en todas las leyes...');
            articulosEncontrados = await buscarPorSimilitud(pregunta, null, 50);
            
            if (articulosEncontrados.length > 0) {
                leyId = articulosEncontrados[0].ley_id;
                console.log(`✅ Artículos encontrados en ${LEY_MAP[leyId]}`);
            }
        }

        if (articulosEncontrados.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes en mi base de datos para tu consulta. Te recomiendo reformular la pregunta o consultar con un abogado."
            });
        }

        console.log(`📚 Total artículos encontrados: ${articulosEncontrados.length}`);

        // 4. SELECCIONAR ARTÍCULOS RELEVANTES CON GROQ
        const articulosRelevantes = await seleccionarArticulosRelevantes(
            pregunta, 
            articulosEncontrados, 
            leyId
        );

        if (articulosRelevantes.length === 0) {
            return res.json({
                respuesta: "⚠️ No encontré artículos relevantes para tu consulta. Te recomiendo consultar con un abogado especializado."
            });
        }

        console.log(`📊 Artículos relevantes: ${articulosRelevantes.map(a => a.numero_articulo).join(', ')}`);

        // 5. GENERAR RESPUESTA
        const respuesta = await generarRespuesta(
            pregunta, 
            articulosRelevantes, 
            leyId
        );

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
app.listen(PORT, async () => {
    console.log('🚀 LexnaVe Backend iniciando...');
    await initEmbedder();
    console.log(`🚀 LexnaVe Backend activo en puerto ${PORT}`);
});
