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

// ========== FORZAR ARTÍCULOS POR TEMA ==========
const FORZAR_ARTICULOS = {
    // Código Penal (Ley 6)
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
    
    // Código Civil (Ley 3)
    'prescripcion': ['1969', '1950', '1951', '1952'],
    'divorcio': ['185', '186', '187'],
    'matrimonio': ['82', '83', '84', '85', '86', '87', '88'],
    'paternidad': ['210', '211', '212', '215'],
    'filiacion': ['210', '211', '212'],
    'alimentos': ['282', '283', '284'],
    'herencia': ['991', '992', '993', '994'],
    'testamento': ['991', '992', '993', '994'],
    'servidumbre': ['571', '572', '573', '574', '575', '576', '577'],
    'contrato': ['1137', '1140', '1145'],
    'arrendamiento': ['1576', '1577', '1578'],
    
    // COPP (Ley 5)
    'flagrancia': ['373'],
    'detencion': ['373', '374', '375'],
    'fianza': ['244', '245'],
    'medidas cautelares': ['236', '237', '238'],
    'acto conclusivo': ['295'],
    'apelacion': ['438', '439'],
    
    // CPC (Ley 7)
    'intimacion': ['640', '641', '642'],
    'interdicto': ['782', '783', '784', '785'],
    'embargo': ['585', '586', '587'],
    'demanda': ['340'],
    'apelacion': ['340', '341'],
    'ejecucion': ['650', '651', '652'],
    
    // Ley Violencia Mujer (Ley 9)
    'violencia mujer': ['1', '2', '3', '4', '5'],
    'medidas proteccion': ['1', '2', '3'],
    
    // LPH (Ley 2)
    'propiedad horizontal': ['5', '7', '8', '9', '14'],
    'cuotas mantenimiento': ['14', '7', '5'],
    
    // Código de Comercio (Ley 4)
    'letra cambio': ['410'],
    'pagare': ['410'],
    'cheque': ['410'],
    
    // CRBV (Ley 1)
    'amparo': ['26', '27', '49'],
    'estado excepcion': ['337', '338', '339'],
    'derecho propiedad': ['115']
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
        // Intentar 1: búsqueda por textSearch en contenido
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .textSearch('contenido', `Artículo ${numeroArticulo}`)
            .limit(1);
        
        if (data && data.length > 0 && !error) {
            const art = data[0];
            console.log(`✅ Artículo ${numeroArticulo} encontrado por textSearch: "${art.numero_articulo}"`);
            return {
                id: art.id,
                numero_articulo: art.numero_articulo,
                contenido: art.contenido,
                ley_id: art.ley_id,
                ley_nombre: LEY_MAP[art.ley_id] || 'Ley',
                similitud: 0.99
            };
        }
        
        // Intentar 2: búsqueda por ilike en numero_articulo
        const { data: dataIlike, error: errorIlike } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .ilike('numero_articulo', `%${numeroArticulo}%`)
            .maybeSingle();
        
        if (dataIlike && !errorIlike) {
            console.log(`✅ Artículo ${numeroArticulo} encontrado por ilike: "${dataIlike.numero_articulo}"`);
            return {
                id: dataIlike.id,
                numero_articulo: dataIlike.numero_articulo,
                contenido: dataIlike.contenido,
                ley_id: dataIlike.ley_id,
                ley_nombre: LEY_MAP[dataIlike.ley_id] || 'Ley',
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

// ========== CLASIFICACIÓN CON 8B ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Clasifica la consulta legal. Responde SOLO con JSON: {"ley_id": número}
    
    === CRITERIOS COMPLETOS ===
    
    LEY 1 - CONSTITUCIÓN: constitución, amparo, derechos humanos, estado de excepción, debido proceso, derecho propiedad, libertad expresión, derecho trabajo, derecho salud, derecho educación
    
    LEY 2 - LPH: propiedad horizontal, condominio, vecino, cuotas mantenimiento, administrador, asamblea copropietarios, cosas comunes, gastos comunes, documento condominio
    
    LEY 3 - CÓDIGO CIVIL:
    PERSONAS: nacionalidad, domicilio, estado civil, matrimonio, divorcio, separación, filiación, paternidad, maternidad, hijo, adopción, patria potestad, alimentos, tutela, emancipación, interdicción, inhabilitación, ausencia, registro civil
    BIENES: bienes, muebles, inmuebles, propiedad, posesión, comunidad, copropiedad, accesión, servidumbre, usufructo, uso, habitación
    OBLIGACIONES: obligaciones, contrato, donación, venta, permuta, arrendamiento, alquiler, comodato, mutuo, depósito, prenda, hipoteca, anticresis, fianza, sociedad, mandato, transacción, seguro
    SUCESIONES: herencia, testamento, sucesión, albacea, legado, legitimaria, heredero
    PRESCRIPCIÓN: prescripción, plazo, interrupción, caducidad
    
    LEY 4 - CÓDIGO DE COMERCIO: letra cambio, pagaré, cheque, comercio, sociedad mercantil, empresa, sociedad anónima, acto comercio, comerciante
    
    LEY 5 - COPP:
    DETENCIÓN: detención, flagrancia, arresto, aprehensión, captura, presentación juez, imputado
    PROCESO: juicio oral, audiencia preliminar, fase preparatoria, investigación, fiscalía, acto conclusivo, acusación, sobreseimiento
    GARANTÍAS: presunción inocencia, derecho defensa, debido proceso, libertad
    MEDIDAS: medidas cautelares, privación libertad, libertad provisional, fianza, caución, arresto domiciliario
    RECURSOS: apelación, casación, revisión
    
    LEY 6 - CÓDIGO PENAL:
    DELITOS PROPIEDAD: hurto, robo, estafa, fraude, apropiación indebida, daño a propiedad
    DELITOS PERSONAS: homicidio, asesinato, lesiones, violencia, agresión
    DELITOS LIBERTAD: secuestro, extorsión, coacción, amenaza, privación libertad
    ADMINISTRACIÓN: corrupción, peculado, malversación, concusión, cohecho, prevaricación
    PENAS: pena, prisión, presidio, arresto, multa, reincidencia, atenuantes, agravantes, eximentes
    RESPONSABILIDAD: imputabilidad, dolo, culpa, legítima defensa, estado necesidad, tentativa, frustración, prescripción penal
    
    LEY 7 - CPC:
    PROCEDIMIENTO ORDINARIO: demanda, emplazamiento, contestación, cuestiones previas, instrucción, lapso probatorio, pruebas, documentos, testigos, experticias, inspección, informes, sentencia, ejecución, embargo, remate, subasta
    PROCEDIMIENTOS ESPECIALES: procedimiento oral, procedimiento breve, intimación, vía ejecutiva, interdictos, posesión, daño temido, partición, cuentas, jurisdicción voluntaria
    MEDIDAS: medidas preventivas, embargo, secuestro, prohibición enajenar, perención, recusación
    RECURSOS: apelación, casación
    
    LEY 8 - ARRENDAMIENTO VIVIENDA: arrendamiento vivienda, canon, desalojo, contrato arrendamiento, derechos arrendatario
    
    LEY 9 - VIOLENCIA MUJER:
    VIOLENCIA: violencia mujer, violencia género, violencia doméstica, violencia física, violencia psicológica, violencia sexual, violencia patrimonial, violencia obstétrica, violencia institucional, violencia laboral, violencia política
    PROTECCIÓN: medidas protección, órdenes protección, casa abrigo, refugio, víctima, denuncia
    PROCEDIMIENTO: ruta de la justicia, tribunales especializados, control, audiencia, medidas
    
    LEY 10 - ARRENDAMIENTO COMERCIAL: arrendamiento comercial, local comercial, canon comercial
    
    LEY 11 - REGISTROS: registro, notaría, registro público, protocolización

    Consulta: "${pregunta}"
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.1,
            response_format: { type: "json_object" },
            max_tokens: 50
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación (8B): Ley ${result.ley_id}`);
        return result;
    } catch (error) {
        console.warn("⚠️ Clasificación falló, usando fallback por keywords...");
        const lower = pregunta.toLowerCase();
        
        // Ley 6 - Código Penal
        if (lower.includes('hurto') || lower.includes('robo') || lower.includes('homicidio') || 
            lower.includes('lesiones') || lower.includes('estafa') || lower.includes('corrupción') ||
            lower.includes('peculado') || lower.includes('pena') || lower.includes('prisión') ||
            lower.includes('delito') || lower.includes('crimen') || lower.includes('extorsión') ||
            lower.includes('secuestro')) return { ley_id: 6 };
        
        // Ley 5 - COPP
        if (lower.includes('detención') || lower.includes('flagrancia') || lower.includes('fiscal') || 
            lower.includes('juez') || lower.includes('presentación') || lower.includes('imputado') ||
            lower.includes('juicio oral') || lower.includes('audiencia preliminar')) return { ley_id: 5 };
        
        // Ley 3 - Código Civil
        if (lower.includes('paternidad') || lower.includes('filiacion') || lower.includes('hijo') || 
            lower.includes('matrimonio') || lower.includes('divorcio') || lower.includes('alimentos') ||
            lower.includes('herencia') || lower.includes('testamento') || lower.includes('sucesion') ||
            lower.includes('contrato') || lower.includes('arrendamiento') || lower.includes('servidumbre') ||
            lower.includes('prescripcion') || lower.includes('daños') || lower.includes('perjuicios') ||
            lower.includes('propiedad') || lower.includes('posesion') || lower.includes('usucapion')) return { ley_id: 3 };
        
        // Ley 7 - CPC
        if (lower.includes('demanda') || lower.includes('juicio') || lower.includes('procedimiento') ||
            lower.includes('pruebas') || lower.includes('testigos') || lower.includes('embargo') ||
            lower.includes('intimación') || lower.includes('interdicto') || lower.includes('apelación') ||
            lower.includes('ejecución') || lower.includes('remate') || lower.includes('subasta')) return { ley_id: 7 };
        
        // Ley 9 - Violencia Mujer
        if (lower.includes('violencia mujer') || lower.includes('violencia género') || 
            lower.includes('violencia doméstica') || lower.includes('medidas protección') ||
            lower.includes('víctima') || lower.includes('denuncia violencia')) return { ley_id: 9 };
        
        // Ley 4 - Comercio
        if (lower.includes('letra') || lower.includes('comercio') || lower.includes('pagare') || 
            lower.includes('cheque') || lower.includes('empresa') || lower.includes('sociedad')) return { ley_id: 4 };
        
        // Ley 2 - LPH
        if (lower.includes('propiedad horizontal') || lower.includes('condominio') || lower.includes('vecino')) return { ley_id: 2 };
        
        // Ley 1 - CRBV
        if (lower.includes('constitución') || lower.includes('amparo') || lower.includes('derechos humanos')) return { ley_id: 1 };
        
        // Ley 8 - Arrendamiento Vivienda
        if (lower.includes('arrendamiento vivienda') || lower.includes('desalojo')) return { ley_id: 8 };
        
        // Ley 11 - Registros
        if (lower.includes('registro') || lower.includes('notaría') || lower.includes('protocolización')) return { ley_id: 11 };
        
        return { ley_id: 3 };
    }
}

// ========== FORZAR ARTÍCULOS EN CANDIDATOS (CON NORMALIZACIÓN) ==========
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

// ========== RESPUESTA CON 8B ==========
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
            model: 'llama-3.1-8b-instant',
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
