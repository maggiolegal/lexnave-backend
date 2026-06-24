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

// ========== CLASIFICACIÓN CON 8B (CRITERIOS COMPLETOS) ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Clasifica la consulta legal. Responde SOLO con JSON: {"ley_id": número}
    
    === CRITERIOS DE CLASIFICACIÓN ===
    
    === CÓDIGO DE PROCEDIMIENTO CIVIL (Ley 7) ===
    PROCEDIMIENTO ORDINARIO: demanda, emplazamiento, contestación, cuestiones previas, instrucción, lapso probatorio, pruebas, documentos, testigos, experticias, inspección, informes, sentencia, ejecución, embargo, remate, subasta
    
    PROCEDIMIENTOS ESPECIALES: procedimiento oral, procedimiento breve, intimación, vía ejecutiva, interdictos, posesión, daño temido, partición, cuentas, jurisdicción voluntaria
    
    MEDIDAS: medidas preventivas, embargo, secuestro, prohibición enajenar, perención, recusación
    
    RECURSOS: apelación, casación, recursos
    
    === CÓDIGO CIVIL (Ley 3) ===
    PERSONAS: nacionalidad, domicilio, estado civil, matrimonio, divorcio, filiación, paternidad, hijo, adopción, patria potestad, alimentos, tutela, emancipación, interdicción, ausencia, registro civil
    
    BIENES: propiedad, posesión, comunidad, copropiedad, servidumbre, usufructo, uso, habitación
    
    OBLIGACIONES: contrato, donación, venta, permuta, arrendamiento, comodato, mutuo, depósito, prenda, hipoteca, anticresis, fianza, sociedad, mandato, transacción, seguro
    
    SUCESIONES: herencia, testamento, sucesión, albacea, legado, heredero
    
    === CÓDIGO PENAL (Ley 6) ===
    DELITOS: homicidio, asesinato, lesiones, hurto, robo, estafa, fraude, apropiación, secuestro, extorsión, amenaza, coacción, violación, abuso sexual
    ADMINISTRACIÓN: corrupción, peculado, malversación, concusión, cohecho, prevaricación
    PENAS: pena, prisión, presidio, arresto, multa, reincidencia, atenuantes, agravantes, tentativa, frustración, prescripción penal, indulto
    RESPONSABILIDAD: imputabilidad, dolo, culpa, legítima defensa, estado necesidad
    
    === CÓDIGO ORGÁNICO PROCESAL PENAL (Ley 5) ===
    DETENCIÓN: detención, flagrancia, arresto, aprehensión, captura, presentación juez, imputado
    PROCESO: juicio oral, audiencia preliminar, fase preparatoria, investigación, fiscalía, acto conclusivo, acusación, sobreseimiento
    GARANTÍAS: presunción inocencia, derecho defensa, debido proceso, libertad
    MEDIDAS: medidas cautelares, privación libertad, libertad provisional, fianza, caución
    RECURSOS: apelación, casación, revisión
    
    === LEY ORGÁNICA SOBRE EL DERECHO DE LAS MUJERES (Ley 9) ===
    VIOLENCIA: violencia mujer, violencia género, violencia doméstica, violencia física, violencia psicológica, violencia sexual, violencia patrimonial, violencia obstétrica, violencia institucional
    PROTECCIÓN: medidas protección, órdenes protección, casa abrigo, refugio, víctima
    PROCEDIMIENTO: denuncia, ruta de la justicia, tribunales especializados, control, audiencia, medidas
    
    === CONSTITUCIÓN (Ley 1) ===
    constitución, amparo, derechos humanos, estado de excepción, derechos fundamentales
    
    === PROPIEDAD HORIZONTAL (Ley 2) ===
    propiedad horizontal, condominio, vecino, cuotas mantenimiento, asamblea copropietarios, administrador
    
    === CÓDIGO DE COMERCIO (Ley 4) ===
    letra cambio, pagaré, cheque, comercio, sociedad mercantil, empresa, sociedad anónima

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
        
        // CPC
        if (lower.includes('demanda') || lower.includes('juicio') || lower.includes('procedimiento') ||
            lower.includes('pruebas') || lower.includes('testigos') || lower.includes('embargo') ||
            lower.includes('intimación') || lower.includes('interdicto') || lower.includes('apelación') ||
            lower.includes('ejecución') || lower.includes('remate') || lower.includes('subasta') ||
            lower.includes('medidas preventivas') || lower.includes('perención')) return { ley_id: 7 };
        
        // Ley Violencia Mujer
        if (lower.includes('violencia mujer') || lower.includes('violencia género') || 
            lower.includes('violencia doméstica') || lower.includes('medidas protección') ||
            lower.includes('víctima') || lower.includes('denuncia violencia')) return { ley_id: 9 };
        
        // Código Penal
        if (lower.includes('hurto') || lower.includes('robo') || lower.includes('homicidio') || 
            lower.includes('lesiones') || lower.includes('estafa') || lower.includes('corrupción') ||
            lower.includes('peculado') || lower.includes('pena') || lower.includes('prisión') ||
            lower.includes('delito') || lower.includes('crimen') || lower.includes('extorsión') ||
            lower.includes('secuestro')) return { ley_id: 6 };
        
        // COPP
        if (lower.includes('detención') || lower.includes('flagrancia') || lower.includes('fiscal') || 
            lower.includes('juez') || lower.includes('presentación') || lower.includes('imputado') ||
            lower.includes('juicio oral') || lower.includes('audiencia preliminar')) return { ley_id: 5 };
        
        // Código Civil
        if (lower.includes('paternidad') || lower.includes('filiacion') || lower.includes('hijo') || 
            lower.includes('matrimonio') || lower.includes('divorcio') || lower.includes('alimentos') ||
            lower.includes('herencia') || lower.includes('testamento') || lower.includes('sucesion') ||
            lower.includes('contrato') || lower.includes('arrendamiento') || lower.includes('servidumbre') ||
            lower.includes('prescripcion') || lower.includes('daños') || lower.includes('perjuicios') ||
            lower.includes('propiedad') || lower.includes('posesion') || lower.includes('usucapion')) return { ley_id: 3 };
        
        // Comercio
        if (lower.includes('letra') || lower.includes('comercio') || lower.includes('pagare') || 
            lower.includes('cheque') || lower.includes('empresa') || lower.includes('sociedad')) return { ley_id: 4 };
        
        // LPH
        if (lower.includes('propiedad horizontal') || lower.includes('condominio') || lower.includes('vecino')) return { ley_id: 2 };
        
        // CRBV
        if (lower.includes('constitución') || lower.includes('amparo') || lower.includes('derechos humanos')) return { ley_id: 1 };
        
        return { ley_id: 3 };
    }
}

// ========== RESPUESTA CON 70B (INTELIGENCIA MÁXIMA) ==========
async function generarRespuestaDirecta(pregunta, candidatos, leyId) {
    const leyNombre = LEY_MAP[leyId] || 'Ley';
    
    const mejores = candidatos.slice(0, 15);
    
    let contextoLegal = "";
    for (let i = 0; i < mejores.length; i++) {
        const a = mejores[i];
        const texto = a.contenido.substring(0, 350);
        contextoLegal += `\nArt. ${a.numero_articulo}: ${texto}...\n`;
    }
    
    const systemPrompt = `
Eres "LexnaVe", asistente jurídico experto en leyes venezolanas.

⚠️ INSTRUCCIONES ESTRICTAS:
1. Extrae palabras clave de la pregunta.
2. Lee todos los artículos del contexto.
3. Selecciona el artículo con MÁS coincidencias con las palabras clave.
4. Cita el artículo TEXTUALMENTE entre comillas.
5. NO inventes artículos. Si no encuentras, di "No tengo información suficiente".

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

INSTRUCCIÓN: Responde con la estructura indicada.
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
        // 1. CLASIFICAR CON 8B
        const clasificacion = await clasificarConsulta(pregunta);
        let leyId = clasificacion.ley_id || 3;

        console.log(`🔍 Buscando en ${LEY_MAP[leyId]}`);
        
        // 2. BÚSQUEDA VECTORIAL
        let articulosEncontrados = await buscarPorSimilitud(pregunta, leyId, 50);

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

        // 3. GENERAR RESPUESTA CON 70B
        let respuesta = await generarRespuestaDirecta(pregunta, articulosEncontrados, leyId);

        // 4. VALIDAR CITAS
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
