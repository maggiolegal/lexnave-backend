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

// ========== DETECTAR ARTÍCULO DIRECTO ==========
function detectarArticuloDirecto(pregunta) {
    if (!pregunta) return null;
    
    const regex = /(?:art(?:[íi]culo)?\.?\s*)(\d+)(?:\s+(?:del|de\s+la|del\s+c[oó]digo|c[oó]digo)\s+(\w+(?:\s+\w+)*))?/i;
    const match = pregunta.match(regex);
    
    if (!match) return null;
    
    const numero = match[1];
    const leyMencionada = match[2]?.toLowerCase() || '';
    
    let leyId = null;
    if (leyMencionada.includes('civil')) leyId = 3;
    else if (leyMencionada.includes('penal') && !leyMencionada.includes('orgánico')) leyId = 6;
    else if (leyMencionada.includes('procesal') || leyMencionada.includes('copp')) leyId = 5;
    else if (leyMencionada.includes('procedimiento') || leyMencionada.includes('cpc')) leyId = 7;
    else if (leyMencionada.includes('constitución') || leyMencionada.includes('crbv')) leyId = 1;
    else if (leyMencionada.includes('comercio')) leyId = 4;
    else if (leyMencionada.includes('propiedad horizontal') || leyMencionada.includes('lph')) leyId = 2;
    
    return { numero, leyId };
}

// ========== CLASIFICACIÓN INTELIGENTE POR CONTEXTO (SIN PALABRAS MANUALES) ==========
async function clasificarConsulta(pregunta) {
    const prompt = `
    Eres un experto en derecho venezolano con 20 años de experiencia. 
    Lee la pregunta del usuario y determina qué ley es la que APLICA para RESPONDER.
    
    REGLAS DE RAZONAMIENTO:
    
    **CRITERIO 1: MATERIA DEL CONFLICTO**
    - Si el conflicto es entre personas (vecinos, familiares, desconocidos) sobre daños, incumplimientos o deudas → Código Civil (Ley 3)
    - Si el conflicto es un DELITO (robo, hurto, lesiones, homicidio) → Código Penal (Ley 6) o COPP (Ley 5)
    - Si el conflicto es sobre PROPIEDAD HORIZONTAL (edificio, condominio, cuotas) → LPH (Ley 2)
    
    **CRITERIO 2: TIPO DE PROBLEMA**
    - "Me rompió", "dañó", "no paga" → Código Civil (Ley 3) - Es responsabilidad civil
    - "Me robó", "me quitó", "me agredió" → Código Penal (Ley 6) - Es un delito
    - "Me detuvieron", "fiscal", "juez" → COPP (Ley 5) - Es proceso penal
    
    **EJEMPLOS DE CLASIFICACIÓN:**
    - "Me chocaron el carro y no pagan" → Código Civil (Ley 3) - Es responsabilidad civil
    - "Me quitaron la cartera a la fuerza" → Código Penal (Ley 6) - Es robo
    - "Me rompió la ventana y no quiere pagar" → Código Civil (Ley 3) - Es daño a la propiedad
    - "Mi vecino no paga mantenimiento" → LPH (Ley 2) - Es propiedad horizontal
    - "Me detuvieron sin juez" → COPP (Ley 5) - Es proceso penal
    
    **REGLAS ESTRICTAS:**
    - Si la pregunta menciona "daño", "rompió", "ventana", "muro" y "pagar" → Código Civil (Ley 3)
    - Si la pregunta menciona "robo", "hurto", "cartera", "teléfono" → Código Penal (Ley 6)
    - Si la pregunta menciona "condominio", "edificio", "cuotas" → LPH (Ley 2)
    - Si la pregunta menciona "detención", "fiscal", "juez" → COPP (Ley 5)
    - Si la pregunta menciona "constitución", "amparo", "derechos" → CRBV (Ley 1)
    - Si la pregunta menciona "procedimiento", "demanda", "juicio" → CPC (Ley 7)
    
    Pregunta del usuario: "${pregunta}"
    
    IMPORTANTE: La clasificación DEBE basarse en el CONTEXTO COMPLETO de la pregunta, no solo en palabras sueltas.
    Responde SOLO con un JSON: {"ley_id": número}
    `;

    try {
        const response = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" },
            max_tokens: 80
        });

        const result = safeJsonParse(response.choices[0].message.content);
        console.log(`📋 Clasificación: Ley ${result.ley_id}`);
        return result;
    } catch (error) {
        console.warn("⚠️ Clasificación falló, usando fallback...");
        const lower = pregunta.toLowerCase();
        if (lower.includes('robo') || lower.includes('hurto') || lower.includes('cartera') || lower.includes('delito')) return { ley_id: 6 };
        if (lower.includes('rompió') || lower.includes('ventana') || lower.includes('muro') || lower.includes('daño')) return { ley_id: 3 };
        if (lower.includes('condominio') || lower.includes('cuotas') || lower.includes('edificio')) return { ley_id: 2 };
        if (lower.includes('detención') || lower.includes('flagrancia') || lower.includes('fiscal')) return { ley_id: 5 };
        return { ley_id: 3 };
    }
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
        instruccion = `\n⚠️ SOLO puedes citar los artículos ${numerosArticulos.join(', ')}. No cites ningún otro artículo.`;
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

// ========== LIMPIAR CITAS ALUCINADAS ==========
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
        
        const numeros = articulos.slice(0, 3).map(a => a.numero_articulo).join(', ');
        return `Según el ${LEY_MAP[articulos[0]?.ley_id] || 'Código'}, los artículos relevantes son: ${numeros}. Consulta con un abogado para un análisis detallado.`;
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
        let leyId = null;
        let articulos = [];

        // === MODO 1: ARTÍCULO DIRECTO ===
        const articuloDirecto = detectarArticuloDirecto(pregunta);
        if (articuloDirecto) {
            console.log(`🎯 Artículo Directo: ${articuloDirecto.numero}`);
            leyId = articuloDirecto.leyId || 3;
            
            const art = await buscarArticuloPorNumero(leyId, articuloDirecto.numero);
            if (art) {
                articulos = [art];
            } else {
                for (const id of [3, 7, 5, 6, 1, 4, 2, 8, 9, 10, 11]) {
                    const a = await buscarArticuloPorNumero(id, articuloDirecto.numero);
                    if (a) {
                        articulos = [a];
                        leyId = id;
                        break;
                    }
                }
            }
        }

        // === MODO 2: CLASIFICACIÓN INTELIGENTE POR CONTEXTO ===
        if (articulos.length === 0) {
            const clasificacion = await clasificarConsulta(pregunta);
            leyId = clasificacion.ley_id || 3;

            console.log(`🔍 Buscando en ${LEY_MAP[leyId]}`);
            articulos = await buscarPorSimilitud(pregunta, leyId, 30);
        }

        // === MODO 3: FALLBACK TRANSVERSAL ===
        if (articulos.length === 0) {
            console.log('🔄 Fallback: Buscando en todas las leyes...');
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
