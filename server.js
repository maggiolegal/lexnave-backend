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

// ========== MAPEO FORZADO DE LEYES POR PALABRAS CLAVE ==========
const KEYWORD_LEY_MAP = {
    'vecino': 2,
    'vecinos': 2,
    'edificio': 2,
    'condominio': 2,
    'apartamento': 2,
    'propiedad horizontal': 2,
    'cuotas de mantenimiento': 2,
    'junta de condominio': 2,
    'administrador del edificio': 2,
    'mantenimiento': 2,
    'ascensor': 2,
    'áreas comunes': 2,
    'mi apartamento': 2,
    'mi vivienda': 2,
    'propietario': 2,
    'propietarios': 2,
    'copropietario': 2,
    'copropietarios': 2,
    'cosas comunes': 2,
    'gastos comunes': 2,
    'ruido': 2,
    'ruidos': 2,
    'molestia': 2,
    'molestias': 2,
    'perro': 2,
    'ladra': 2,
    'ladrar': 2,
    'sonido': 2,
    'escándalo': 2,
    'alboroto': 2,
    'bullas': 2,
    'contrato': 3,
    'arrendamiento': 3,
    'alquiler': 3,
    'daños y perjuicios': 3,
    'responsabilidad civil': 3,
    'propiedad': 3,
    'posesión': 3,
    'inquilino': 3,
    'arrendador': 3,
    'herencia': 3,
    'testamento': 3,
    'sucesión': 3,
    'vías de hecho': 3,
    'pagare': 4,
    'letra de cambio': 4,
    'comerciante': 4,
    'cheque': 4,
    'sociedad mercantil': 4,
    'empresa': 4,
    'detenido': 5,
    'flagrancia': 5,
    'imputado': 5,
    'fiscal': 5,
    'penal': 5,
    'delito': 5,
    'crimen': 5,
    'homicidio': 5,
    'robo': 5,
    'hurto': 5,
    'lesiones': 5,
    'demanda': 7,
    'juicio': 7,
    'procedimiento': 7,
    'tribunal': 7,
    'sentencia': 7,
    'apelación': 7,
    'recurso': 7,
    'ejecución': 7,
    'alquiler': 8,
    'arrendatario': 8,
    'canon': 8,
    'desalojo': 8,
    'contrato de arrendamiento': 8,
    'violencia': 9,
    'mujer': 9,
    'mujeres': 9,
    'género': 9,
    'maltrato': 9,
    'local comercial': 10,
    'arrendamiento comercial': 10,
    'negocio': 10,
    'registro': 11,
    'notaría': 11,
    'notario': 11,
    'registrador': 11,
    'documento': 11,
    'escritura': 11
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

// ========== VALIDACIÓN DE CITAS EN RESPUESTA ==========
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

// ========== FUNCIONES DE BÚSQUEDA EN SUPABASE ==========
async function buscarArticuloEspecifico(leyId, numArticulo) {
    try {
        const cleanNum = numArticulo.toString().trim();
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .eq('numero_articulo', cleanNum);

        if (error) {
            console.error("Error SQL:", error);
            return [];
        }
        
        return (data || []).map(art => ({
            id: art.id,
            texto: `Artículo ${art.numero_articulo} (${LEY_MAP[art.ley_id] || 'Ley'}: ${art.contenido})`,
            ley_id: art.ley_id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido
        }));
    } catch (e) {
        console.error("Error en búsqueda específica:", e);
        return [];
    }
}

async function obtenerArticulosPorLey(leyId, limite = 12) {
    try {
        const { data, error } = await supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id')
            .eq('ley_id', parseInt(leyId))
            .limit(limite);
        
        if (error) {
            console.error("Error obteniendo artículos:", error);
            return [];
        }
        
        return (data || []).map(art => ({
            id: art.id,
            texto: `Artículo ${art.numero_articulo} (${LEY_MAP[art.ley_id] || 'Ley'}): ${art.contenido}`,
            ley_id: art.ley_id,
            numero_articulo: art.numero_articulo,
            contenido: art.contenido
        }));
    } catch (e) {
        console.error("Error en obtención de artículos:", e);
        return [];
    }
}

// ========== FILTRO SUPREMO REFORMADO (ORDENA, NO DESCARTAR) ==========
async function ordenarArticulosPorRelevancia(pregunta, articulosCandidatos) {
    if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
    
    // Si hay pocos artículos (< 15), devolverlos todos sin filtrar
    if (articulosCandidatos.length <= 15) {
        console.log(`📚 Menos de 15 artículos (${articulosCandidatos.length}), pasando todos al modelo`);
        return articulosCandidatos;
    }
    
    const promptOrden = `
    Actúa como un Juez de Admisión. Ordena los siguientes artículos de la ley venezolana por su relevancia para responder la pregunta del ciudadano.
    
    Pregunta: "${pregunta}"
    
    Artículos Candidatos:
    ${JSON.stringify(articulosCandidatos, null, 2)}
    
    Responde ÚNICAMENTE con un arreglo JSON de IDs de artículos ordenados del más relevante al menos relevante.
    Ejemplo de salida: [15, 3, 7, 42, 8, 9, 1]
    `;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: promptOrden }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });
        
        const responseText = chatCompletion.choices[0]?.message?.content || "";
        const parsedResponse = safeJsonParse(responseText);
        
        const idsOrdenados = Array.isArray(parsedResponse) ? parsedResponse : (parsedResponse.ids || []);
        
        if (idsOrdenados.length > 0) {
            // Reordenar según el orden dado por Groq
            const articulosMap = new Map(articulosCandidatos.map(a => [a.id, a]));
            const ordenados = idsOrdenados
                .map(id => articulosMap.get(id))
                .filter(a => a !== undefined);
            
            // Si no se devolvieron todos, completar con los que faltan al final
            const faltantes = articulosCandidatos.filter(a => !idsOrdenados.includes(a.id));
            const resultado = [...ordenados, ...faltantes];
            
            // Limitar a 12 artículos para no gastar tokens
            console.log(`📊 Artículos ordenados: ${resultado.slice(0, 12).map(a => a.numero_articulo).join(', ')}`);
            return resultado.slice(0, 12);
        }
        
        // Fallback: devolver los primeros 12
        return articulosCandidatos.slice(0, 12);
        
    } catch (error) {
        console.error("❌ Error en ordenamiento:", error.message);
        return articulosCandidatos.slice(0, 12);
    }
}

// ========== ENDPOINT PRINCIPAL ==========
app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} 📨 Pregunta: ${pregunta}`);

    try {
        // 1. CLASIFICACIÓN PROCESAL
        const promptClasificacion = `
        Analiza la siguiente consulta legal de un ciudadano venezolano y clasifícala en formato JSON estricto.
        Leyes disponibles: 1:CRBV, 2:LPH, 3:CCV, 4:CCom, 5:COPP, 6:CP, 7:CPC, 8:Arrendamiento, 9:Violencia, 10:Comercial, 11:Registros.
        
        Consulta: "${pregunta}"

        Campos obligatorios en el JSON:
        {
            "needs_clarification": boolean,
            "clarification_question": string o null,
            "ley_ids": [array de números de leyes relevantes],
            "legal_intent": "string descriptivo de la acción judicial",
            "articulo_num": number o null,
            "text_keywords": ["array", "de", "palabras", "clave"]
        }
        `;

        const resClasificacion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: promptClasificacion }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const metadata = safeJsonParse(resClasificacion.choices[0]?.message?.content);
        console.log(`${timestamp} ⚖️ Clasificación:`, JSON.stringify(metadata, null, 2));

        if (metadata.needs_clarification && metadata.clarification_question) {
            return res.json({ 
                respuesta: `🔍 ${metadata.clarification_question}\n\n⚖️ _Para brindarte la orientación exacta, requiero este dato de tu caso._` 
            });
        }

        // 2. FORZAR LEY SEGÚN PALABRAS CLAVE
        let leyesForzadas = [];
        const palabrasEnPregunta = pregunta.toLowerCase();
        
        for (const [keyword, leyId] of Object.entries(KEYWORD_LEY_MAP)) {
            if (palabrasEnPregunta.includes(keyword.toLowerCase())) {
                if (!leyesForzadas.includes(leyId)) {
                    leyesForzadas.push(leyId);
                    console.log(`🔧 Forzando ley ${leyId} (${LEY_MAP[leyId]}) por palabra clave "${keyword}"`);
                }
            }
        }
        
        if (leyesForzadas.length > 0) {
            if (leyesForzadas.includes(2) && leyesForzadas.includes(8)) {
                leyesForzadas = leyesForzadas.filter(id => id !== 8);
                console.log(`⚖️ Priorizando Propiedad Horizontal (2) sobre Arrendamiento (8)`);
            }
            metadata.ley_ids = leyesForzadas;
            console.log(`🔧 Leyes forzadas finales: ${metadata.ley_ids.join(', ')}`);
        }

        // 3. RECUPERACIÓN DE ARTÍCULOS
        let articulosCandidatos = [];
        const leyesAUsar = metadata.ley_ids || [];
        
        const leyPrincipal = leyesAUsar.length > 0 ? leyesAUsar[0] : null;
        
        if (metadata.articulo_num && leyPrincipal) {
            console.log(`🔍 Buscando artículo específico ${metadata.articulo_num} en ley ${leyPrincipal}`);
            const artEspecifico = await buscarArticuloEspecifico(leyPrincipal, metadata.articulo_num);
            if (artEspecifico.length > 0) {
                articulosCandidatos = artEspecifico;
            }
        }

        if (articulosCandidatos.length === 0 && leyesAUsar.length > 0) {
            console.log(`🔍 Buscando contexto en leyes: ${leyesAUsar.join(', ')}`);
            
            const promesasBusqueda = leyesAUsar.map(leyId => obtenerArticulosPorLey(leyId, 12));
            const resultados = await Promise.all(promesasBusqueda);
            articulosCandidatos = resultados.flat().slice(0, 25);
        }

        if (articulosCandidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
            });
        }

        // 4. ORDENAR POR RELEVANCIA (NO DESCARTAR)
        const articulosOrdenados = await ordenarArticulosPorRelevancia(pregunta, articulosCandidatos);
        console.log(`${timestamp} ✅ Artículos seleccionados: ${articulosOrdenados.length}`);

        // 5. SYSTEM PROMPT DEFINITIVO
        const systemPrompt = `
Eres "LexnaVe", un Abogado Senior y Experto en Derecho Procesal Civil, Penal y Constitucional Venezolano con 20 años de experiencia.

⚠️ **INSTRUCCIONES CRÍTICAS - CITACIÓN OBLIGATORIA:**

**CADA afirmación DEBE ir acompañada de:**
1. El número del artículo
2. El nombre de la ley
3. El texto LITERAL entre comillas

**PROHIBIDO:**
- Citar artículos sin su texto literal
- Mencionar artículos que no estén en el contexto
- Usar frases como "Aunque no hay un artículo explícito..."
- Inventar contenidos de artículos

**ESTRUCTURA OBLIGATORIA DE RESPUESTA:**

1. **INTRODUCCIÓN**: Resumen ejecutivo de 2-3 líneas que responda directamente la consulta.

2. **FUNDAMENTOS LEGALES** (SOLO artículos del contexto):
   - "Según el Artículo X de la Ley Y: [texto LITERAL entre comillas]"
   - "Este artículo aplica porque [explicación breve]"

3. **ACCIONES RECOMENDADAS**: Lista numerada de pasos prácticos.

4. **ADVERTENCIA FINAL**: "⚖️ Esto es orientación general. Consulta con un abogado."
`;

        // Construir contexto legal
        let contextoLegal = "";
        if (articulosOrdenados.length > 0) {
            contextoLegal = articulosOrdenados.map(art => 
                `- Artículo ${art.numero_articulo} de ${LEY_MAP[art.ley_id] || 'Ley'}: "${art.contenido}"`
            ).join('\n');
        } else {
            contextoLegal = "No se encontraron artículos específicos en la base de datos para esta consulta.";
        }

        const promptFinal = `
**CONTEXTO LEGAL DISPONIBLE:**
${contextoLegal}

**CLASIFICACIÓN DEL CASO:**
${JSON.stringify(metadata, null, 2)}

**CONSULTA DEL USUARIO:**
"${pregunta}"

**INSTRUCCIÓN IMPORTANTE:** 
Basándote ÚNICAMENTE en el contexto legal proporcionado, genera una respuesta siguiendo ESTRICTAMENTE la estructura del ejemplo.
NO inventes artículos que no estén en el contexto.
CADA afirmación debe tener su correspondiente cita legal con texto literal.
`;

        // 6. GENERACIÓN DE RESPUESTA FINAL
        const responseFinal = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: promptFinal }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.2,
            max_tokens: 3000
        });

        let respuesta = responseFinal.choices[0]?.message?.content;

        // 7. VALIDACIÓN DE CITAS
        const citasValidas = await verificarCitasEnRespuesta(respuesta, articulosOrdenados);

        if (!citasValidas) {
            console.log('⚠️ Se detectaron artículos alucinados. Usando respuesta de fallback.');
            return res.json({
                respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
            });
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
