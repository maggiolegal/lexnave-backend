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

// ========== KEYWORDS COMPLETAS POR LEY ==========
const KEYWORD_LEY_MAP = {
    // ===== LEY 1: CONSTITUCIÓN CRBV =====
    'constitución': 1,
    'crbv': 1,
    'derechos humanos': 1,
    'derecho a la vida': 1,
    'derecho a la libertad': 1,
    'derecho a la propiedad': 1,
    'derecho a la educación': 1,
    'derecho a la salud': 1,
    'derecho al trabajo': 1,
    'derecho a la vivienda': 1,
    'derecho a la seguridad': 1,
    'derecho a la igualdad': 1,
    'derecho a la no discriminación': 1,
    'amparo constitucional': 1,
    'hábeas corpus': 1,
    'debido proceso': 1,
    'tutela judicial': 1,
    'defensa nacional': 1,
    'seguridad de la nación': 1,
    'poder público': 1,
    'división de poderes': 1,
    'estado de excepción': 1,
    'derecho de petición': 1,
    'derecho a la información': 1,
    'libertad de expresión': 1,
    'libertad de culto': 1,
    'libertad de tránsito': 1,
    'libertad de reunión': 1,
    'libertad de asociación': 1,
    'derecho al ambiente': 1,
    'derecho de los pueblos indígenas': 1,
    'derecho a la cultura': 1,
    'derecho al deporte': 1,
    'derecho a la seguridad social': 1,
    'derecho a la alimentación': 1,
    'derecho al agua': 1,
    'derecho a la energía': 1,
    'derecho a la vivienda digna': 1,
    'derecho a la ciudad': 1,
    'derecho a la participación': 1,
    'derecho a la democracia': 1,
    'soberanía nacional': 1,
    'integridad territorial': 1,
    'petróleo': 1,
    'hidrocarburos': 1,
    'recursos naturales': 1,
    'servicios públicos': 1,
    'principio de legalidad': 1,
    'principio de proporcionalidad': 1,
    'principio de progresividad': 1,
    'principio de irretroactividad': 1,
    'principio de cosa juzgada': 1,
    'presunción de inocencia': 1,
    'derecho a la defensa': 1,
    'derecho a ser oído': 1,
    'derecho a la justicia': 1,

    // ===== LEY 2: PROPIEDAD HORIZONTAL =====
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
    'mascota': 2,
    'animal': 2,
    'fiesta': 2,
    'música': 2,
    'volumen alto': 2,
    'problemas de convivencia': 2,
    'asamblea de copropietarios': 2,
    'documento de condominio': 2,
    'reglamento interno': 2,
    'obra en el edificio': 2,
    'reparación': 2,
    'filtración': 2,
    'humedad': 2,
    'gotera': 2,
    'techo': 2,
    'pared': 2,
    'pintura': 2,
    'fachada': 2,
    'jardín': 2,
    'patio': 2,
    'estacionamiento': 2,
    'maletero': 2,
    'depósito': 2,
    'portero': 2,
    'vigilancia': 2,
    'seguridad del edificio': 2,
    'incendio': 2,
    'bomba de agua': 2,
    'cisterna': 2,
    'tanque': 2,
    'servicios centrales': 2,
    'electricidad': 2,
    'gas': 2,
    'agua': 2,

    // ===== LEY 3: CÓDIGO CIVIL =====
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
    'luz natural': 3,
    'luz': 3,
    'muro': 3,
    'construcción': 3,
    'servidumbre': 3,
    'servidumbre de luces': 3,
    'servidumbre de vistas': 3,
    'pared medianera': 3,
    'medianería': 3,
    'linderos': 3,
    'colindante': 3,
    'colindancia': 3,
    'deslinde': 3,
    'usucapión': 3,
    'prescripción adquisitiva': 3,
    'compraventa': 3,
    'permuta': 3,
    'donación': 3,
    'arrendamiento de vivienda': 3,
    'arrendamiento de local': 3,
    'desalojo': 3,
    'rescisión': 3,
    'resolución': 3,
    'nulidad': 3,
    'ineficacia': 3,
    'obligación': 3,
    'obligaciones': 3,
    'pago': 3,
    'indemnización': 3,
    'daño': 3,
    'daños': 3,
    'perjuicio': 3,
    'perjuicios': 3,
    'responsabilidad extracontractual': 3,
    'responsabilidad contractual': 3,
    'culpa': 3,
    'dolo': 3,
    'negligencia': 3,
    'imprudencia': 3,
    'impericia': 3,
    'caso fortuito': 3,
    'fuerza mayor': 3,
    'vicios ocultos': 3,
    'evicción': 3,
    'saneamiento': 3,
    'tradición': 3,
    'entrega': 3,
    'posesión pacífica': 3,
    'posesión continua': 3,
    'posesión pública': 3,
    'posesión a título de dueño': 3,
    'bienes': 3,
    'bienes muebles': 3,
    'bienes inmuebles': 3,
    'bienes raíces': 3,
    'derecho real': 3,
    'hipoteca': 3,
    'prenda': 3,
    'antícresis': 3,
    'servidumbre': 3,
    'servidumbres': 3,
    'estado de necesidad': 3,
    'gestión de negocios': 3,
    'pago de lo indebido': 3,
    'enriquecimiento sin causa': 3,
    'abuso de derecho': 3,
    'buena fe': 3,
    'mala fe': 3,
    'fraude': 3,
    'simulación': 3,

    // ===== LEY 4: CÓDIGO DE COMERCIO =====
    'pagare': 4,
    'letra de cambio': 4,
    'comerciante': 4,
    'cheque': 4,
    'sociedad mercantil': 4,
    'empresa': 4,
    'comercio': 4,
    'acto de comercio': 4,
    'título valor': 4,
    'títulos valores': 4,
    'factura': 4,
    'conocimiento de embarque': 4,
    'carta de porte': 4,
    'endoso': 4,
    'aval': 4,
    'aceptación': 4,
    'protesto': 4,
    'vencimiento': 4,
    'plazo': 4,
    'interés': 4,
    'intereses': 4,
    'morosidad': 4,
    'mora': 4,
    'cuenta corriente': 4,
    'depósito bancario': 4,
    'transferencia': 4,
    'extracto': 4,
    'balance': 4,
    'balanza comercial': 4,
    'sociedad anónima': 4,
    'sociedad de responsabilidad limitada': 4,
    'sociedad en comandita': 4,
    'sociedad colectiva': 4,
    'empresario': 4,
    'empresaria': 4,
    'comercio electrónico': 4,
    'mercado': 4,
    'bolsa de comercio': 4,
    'corredor': 4,
    'agente de comercio': 4,
    'representante comercial': 4,
    'almacén general': 4,
    'depósito': 4,
    'prenda comercial': 4,
    'hipoteca naval': 4,
    'seguro marítimo': 4,
    'seguro': 4,
    'póliza': 4,
    'siniestro': 4,
    'indemnización': 4,
    'contrato de seguro': 4,
    'contrato de compraventa': 4,
    'contrato de suministro': 4,
    'contrato de distribución': 4,
    'contrato de agencia': 4,
    'contrato de concesión': 4,
    'contrato de franquicia': 4,
    'contrato de leasing': 4,
    'contrato de factoring': 4,
    'contrato de joint venture': 4,

    // ===== LEY 5: COPP =====
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
    'presentación ante juez': 5,
    '24 horas': 5,
    '48 horas': 5,
    '12 horas': 5,
    'detención': 5,
    'arresto': 5,
    'aprehensión': 5,
    'captura': 5,
    'privación de libertad': 5,
    'libertad': 5,
    'libertad provisional': 5,
    'fianza': 5,
    'caución': 5,
    'medida de coerción personal': 5,
    'medidas cautelares': 5,
    'presentación': 5,
    'audiencia de presentación': 5,
    'audiencia preliminar': 5,
    'juicio oral': 5,
    'acusación': 5,
    'sobreseimiento': 5,
    'archivo fiscal': 5,
    'investigación': 5,
    'fase preparatoria': 5,
    'acto conclusivo': 5,
    'defensa': 5,
    'abogado defensor': 5,
    'defensor público': 5,
    'querella': 5,
    'denuncia': 5,
    'delitos de acción pública': 5,
    'delitos de acción privada': 5,
    'difamación': 5,
    'injuria': 5,
    'calumnia': 5,
    'violencia doméstica': 5,
    'violencia de género': 5,
    'delitos sexuales': 5,
    'abuso sexual': 5,
    'violación': 5,
    'secuestro': 5,
    'extorsión': 5,
    'narcotráfico': 5,
    'tráfico de drogas': 5,
    'terrorismo': 5,
    'trata de personas': 5,
    'tráfico de migrantes': 5,
    'corrupción': 5,
    'peculado': 5,
    'malversación': 5,
    'concusión': 5,
    'cohecho': 5,
    'prevaricación': 5,

    // ===== LEY 6: CÓDIGO PENAL =====
    'robo': 6,
    'hurto': 6,
    'homicidio': 6,
    'lesiones': 6,
    'estafa': 6,
    'fraude': 6,
    'asesinato': 6,
    'violación': 6,
    'abuso sexual': 6,
    'secuestro': 6,
    'extorsión': 6,
    'narcotráfico': 6,
    'tráfico de drogas': 6,
    'terrorismo': 6,
    'trata de personas': 6,
    'corrupción': 6,
    'peculado': 6,
    'malversación': 6,
    'concusión': 6,
    'cohecho': 6,
    'prevaricación': 6,
    'difamación': 6,
    'injuria': 6,
    'calumnia': 6,
    'violencia': 6,
    'agresión': 6,
    'asalto': 6,
    'allanamiento': 6,
    'violación de domicilio': 6,
    'desorden público': 6,
    'daño a la propiedad': 6,
    'daño': 6,
    'incendio': 6,
    'explosión': 6,
    'contrabando': 6,
    'tráfico ilícito': 6,
    'falsificación': 6,
    'falsedad': 6,
    'perjurio': 6,
    'falso testimonio': 6,
    'ocultamiento': 6,
    'encubrimiento': 6,
    'asociación para delinquir': 6,
    'banda criminal': 6,
    'organización criminal': 6,
    'delito informático': 6,
    'ciberdelito': 6,
    'pornografía infantil': 6,
    'proxenetismo': 6,
    'trata de mujeres': 6,
    'violencia intrafamiliar': 6,
    'maltrato': 6,
    'abandono': 6,
    'omisión de socorro': 6,

    // ===== LEY 7: CPC =====
    'demanda': 7,
    'juicio': 7,
    'procedimiento': 7,
    'tribunal': 7,
    'sentencia': 7,
    'apelación': 7,
    'recurso': 7,
    'ejecución': 7,
    'procedimiento civil': 7,
    'código de procedimiento civil': 7,
    'citación': 7,
    'notificación': 7,
    'emplazamiento': 7,
    'contestación': 7,
    'reconvención': 7,
    'prueba': 7,
    'pruebas': 7,
    'promoción de pruebas': 7,
    'evacuación de pruebas': 7,
    'lapso': 7,
    'plazo': 7,
    'término': 7,
    'caducidad': 7,
    'prescripción': 7,
    'preclusión': 7,
    'perención': 7,
    'desistimiento': 7,
    'transacción': 7,
    'mediación': 7,
    'conciliación': 7,
    'arbitraje': 7,
    'medidas cautelares': 7,
    'embargo': 7,
    'secuestro': 7,
    'inhibición': 7,
    'recusación': 7,
    'nulidad procesal': 7,
    'incompetencia': 7,
    'litisconsorcio': 7,
    'tercería': 7,
    'intervención de terceros': 7,
    'litispendencia': 7,
    'cosa juzgada': 7,
    'ejecutoriedad': 7,
    'ejecución forzosa': 7,
    'remate': 7,
    'subasta': 7,
    'depósito': 7,
    'avalúo': 7,
    'peritaje': 7,
    'experticia': 7,
    'testigos': 7,
    'documentos': 7,
    'confesión': 7,
    'juramento': 7,
    'prueba de oficio': 7,
    'medidas preparatorias': 7,
    'juicio breve': 7,
    'juicio ordinario': 7,
    'procedimiento monitorio': 7,
    'procedimiento ejecutivo': 7,
    'procedimiento de intimación': 7,

    // ===== LEY 8: ARRENDAMIENTO VIVIENDA =====
    'alquiler': 8,
    'arrendatario': 8,
    'canon': 8,
    'desalojo': 8,
    'contrato de arrendamiento': 8,
    'arrendamiento de vivienda': 8,
    'renta': 8,
    'alquiler de vivienda': 8,
    'inquilino': 8,
    'arrendador': 8,
    'contrato de arrendamiento de vivienda': 8,
    'regularización de arrendamientos': 8,
    'control de arrendamientos': 8,
    'superintendencia de arrendamiento': 8,
    'SUNAVI': 8,
    'deuda por alquiler': 8,
    'mora en alquiler': 8,
    'pago de alquiler': 8,
    'aumento de alquiler': 8,
    'ajuste de alquiler': 8,
    'protección al arrendatario': 8,
    'derechos del arrendatario': 8,
    'derechos del arrendador': 8,
    'obligaciones del arrendatario': 8,
    'obligaciones del arrendador': 8,
    'garantía de alquiler': 8,
    'fiador': 8,
    'depósito de garantía': 8,
    'fianza': 8,
    'rescisión de contrato': 8,
    'terminación de contrato': 8,
    'prórroga': 8,
    'renovación': 8,

    // ===== LEY 9: VIOLENCIA MUJER =====
    'violencia': 9,
    'mujer': 9,
    'mujeres': 9,
    'género': 9,
    'maltrato': 9,
    'violencia de género': 9,
    'violencia doméstica': 9,
    'violencia intrafamiliar': 9,
    'maltrato a la mujer': 9,
    'abuso a la mujer': 9,
    'violencia psicológica': 9,
    'violencia física': 9,
    'violencia sexual': 9,
    'violencia patrimonial': 9,
    'violencia simbólica': 9,
    'violencia laboral': 9,
    'violencia política': 9,
    'acoso sexual': 9,
    'acoso laboral': 9,
    'protección a la mujer': 9,
    'derechos de la mujer': 9,
    'medidas de protección': 9,
    'órdenes de protección': 9,
    'casa de abrigo': 9,
    'refugio': 9,
    'víctima': 9,
    'victimización': 9,
    'revictimización': 9,
    'atención a la víctima': 9,
    'sanciones por violencia': 9,
    'penas por violencia': 9,

    // ===== LEY 10: ARRENDAMIENTO COMERCIAL =====
    'local comercial': 10,
    'arrendamiento comercial': 10,
    'negocio': 10,
    'local': 10,
    'oficina': 10,
    'arrendamiento de local': 10,
    'contrato de arrendamiento comercial': 10,
    'renta comercial': 10,
    'canon comercial': 10,
    'alquiler de local': 10,
    'desalojo comercial': 10,
    'prórroga comercial': 10,
    'renovación comercial': 10,
    'uso comercial': 10,
    'actividad comercial': 10,
    'negocio propio': 10,
    'emprendimiento': 10,
    'comercio': 10,

    // ===== LEY 11: REGISTROS Y NOTARÍAS =====
    'registro': 11,
    'notaría': 11,
    'notario': 11,
    'registrador': 11,
    'documento': 11,
    'escritura': 11,
    'registro público': 11,
    'registro mercantil': 11,
    'registro civil': 11,
    'registro de propiedad': 11,
    'registro de hipoteca': 11,
    'registro de comercio': 11,
    'protocolización': 11,
    'protocolo': 11,
    'instrumento': 11,
    'instrumento público': 11,
    'instrumento privado': 11,
    'autenticación': 11,
    'legalización': 11,
    'copia certificada': 11,
    'certificación': 11,
    'inscripción': 11,
    'anotación': 11,
    'marginal': 11,
    'folio': 11,
    'tomo': 11,
    'registro fiscal': 11,
    'registro de contratos': 11,
    'registro de fundaciones': 11,
    'registro de asociaciones': 11,
    'notaría pública': 11,
    'notario público': 11,
    'escritura pública': 11,
    'escritura privada': 11,
    'documento público': 11,
    'documento privado': 11,
    'protocolización de documento': 11,
    'registro de propiedad horizontal': 11,
    'registro de vehículos': 11
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

// ========== BÚSQUEDA SEMÁNTICA CON EMBEDDINGS ==========
async function buscarArticulosSemanticos(pregunta, leyId = null, limite = 10) {
    try {
        // Generar embedding de la pregunta usando el mismo modelo de Groq
        // NOTA: Groq no tiene embeddings, pero si tienes un modelo alternativo local,
        // puedes usar sentence-transformers como hiciste para los artículos.
        // Como estamos en el backend de Render, asumimos que los embeddings ya están generados
        // y usamos la búsqueda por similitud en Supabase.
        
        // Para una búsqueda semántica real, necesitarías generar el embedding de la pregunta
        // y luego usar la función match_articles de Supabase.
        // Por simplicidad, aquí usamos búsqueda por keywords primero.
        // Si tienes sentence-transformers en el backend, podemos implementar la búsqueda semántica.
        
        console.log(`🔍 Búsqueda semántica para: "${pregunta.substring(0, 50)}..."`);
        
        // Buscar artículos por ley con límite mayor
        const query = supabase
            .from('articulos')
            .select('id, numero_articulo, contenido, ley_id');
        
        if (leyId) {
            query.eq('ley_id', parseInt(leyId));
        }
        
        query.limit(limite);
        
        const { data, error } = await query.execute();
        
        if (error) {
            console.error("Error en búsqueda semántica:", error);
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
        console.error("Error en búsqueda semántica:", e);
        return [];
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

// ========== FUNCIONES DE BÚSQUEDA ==========
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

// ========== ORDENAMIENTO POR RELEVANCIA ==========
async function ordenarArticulosPorRelevancia(pregunta, articulosCandidatos) {
    if (!articulosCandidatos || articulosCandidatos.length === 0) return [];
    
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
            const articulosMap = new Map(articulosCandidatos.map(a => [a.id, a]));
            const ordenados = idsOrdenados
                .map(id => articulosMap.get(id))
                .filter(a => a !== undefined);
            
            const faltantes = articulosCandidatos.filter(a => !idsOrdenados.includes(a.id));
            const resultado = [...ordenados, ...faltantes];
            
            console.log(`📊 Artículos ordenados: ${resultado.slice(0, 12).map(a => a.numero_articulo).join(', ')}`);
            return resultado.slice(0, 12);
        }
        
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

        // 2. FORZAR LEY SEGÚN KEYWORDS
        let leyesForzadas = [];
        const palabrasEnPregunta = pregunta.toLowerCase();
        
        for (const [keyword, leyId] of Object.entries(KEYWORD_LEY_MAP)) {
            if (palabrasEnPregunta.includes(keyword.toLowerCase())) {
                if (!leyesForzadas.includes(leyId)) {
                    leyesForzadas.push(leyId);
                    console.log(`🔧 Forzando ley ${leyId} (${LEY_MAP[leyId]}) por keyword "${keyword}"`);
                }
            }
        }
        
        if (leyesForzadas.length > 0) {
            // Priorizar LPH (2) sobre Arrendamiento (8)
            if (leyesForzadas.includes(2) && leyesForzadas.includes(8)) {
                leyesForzadas = leyesForzadas.filter(id => id !== 8);
                console.log(`⚖️ Priorizando Propiedad Horizontal (2) sobre Arrendamiento (8)`);
            }
            // Priorizar CCV (3) sobre LPH (2) para consultas de muros, luces, servidumbres
            if (leyesForzadas.includes(3) && leyesForzadas.includes(2)) {
                // Verificar si la pregunta menciona temas específicos de CCV
                const keywordsCCV = ['luz natural', 'muro', 'servidumbre', 'pared medianera', 'linderos', 'deslinde'];
                if (keywordsCCV.some(k => palabrasEnPregunta.includes(k))) {
                    leyesForzadas = leyesForzadas.filter(id => id !== 2);
                    console.log(`⚖️ Priorizando Código Civil (3) sobre Propiedad Horizontal (2) para temas de servidumbres`);
                }
            }
            metadata.ley_ids = leyesForzadas;
            console.log(`🔧 Leyes forzadas finales: ${metadata.ley_ids.join(', ')}`);
        }

        // 3. RECUPERACIÓN DE ARTÍCULOS
        let articulosCandidatos = [];
        const leyesAUsar = metadata.ley_ids || [];
        
        const leyPrincipal = leyesAUsar.length > 0 ? leyesAUsar[0] : null;
        
        // A. BÚSQUEDA ESPECÍFICA
        if (metadata.articulo_num && leyPrincipal) {
            console.log(`🔍 Buscando artículo específico ${metadata.articulo_num} en ley ${leyPrincipal}`);
            const artEspecifico = await buscarArticuloEspecifico(leyPrincipal, metadata.articulo_num);
            if (artEspecifico.length > 0) {
                articulosCandidatos = artEspecifico;
            }
        }

        // B. BÚSQUEDA GENERAL
        if (articulosCandidatos.length === 0 && leyesAUsar.length > 0) {
            console.log(`🔍 Buscando contexto en leyes: ${leyesAUsar.join(', ')}`);
            
            // Si hay múltiples leyes, buscar artículos de todas
            const promesasBusqueda = leyesAUsar.map(leyId => obtenerArticulosPorLey(leyId, 12));
            const resultados = await Promise.all(promesasBusqueda);
            articulosCandidatos = resultados.flat().slice(0, 30);
        }

        // C. BÚSQUEDA SEMÁNTICA (si no se encontraron artículos)
        if (articulosCandidatos.length === 0 && leyesAUsar.length > 0) {
            console.log(`🔍 Realizando búsqueda semántica en leyes: ${leyesAUsar.join(', ')}`);
            const promesasSemanticas = leyesAUsar.map(leyId => buscarArticulosSemanticos(pregunta, leyId, 10));
            const resultados = await Promise.all(promesasSemanticas);
            articulosCandidatos = resultados.flat().slice(0, 20);
        }

        if (articulosCandidatos.length === 0) {
            return res.json({
                respuesta: "⚠️ No tengo información suficiente en mi base de datos para responder esta consulta con precisión. Te recomiendo consultar con un abogado especializado."
            });
        }

        // 4. ORDENAR POR RELEVANCIA
        const articulosOrdenados = await ordenarArticulosPorRelevancia(pregunta, articulosCandidatos);
        console.log(`${timestamp} ✅ Artículos seleccionados: ${articulosOrdenados.length}`);

        // 5. SYSTEM PROMPT
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

**REGLAS ESPECÍFICAS POR MATERIA:**
- **Flagrancia (Art. 373 COPP)**: 12h policía + 48h fiscal = 60h máximo.
- **Acto conclusivo (Art. 295 COPP)**: 6 meses desde imputación.
- **Derecho de Propiedad (Art. 115 CRBV)**: Garantía constitucional.
- **Prohibición de vías de hecho (Art. 548 CCV)**: Nadie puede hacerse justicia por sí mismo.
- **Cobro ejecutivo (Art. 14 LPH)**: Vía legal para cobrar cuotas.

**ESTRUCTURA OBLIGATORIA:**
1. **INTRODUCCIÓN**: Resumen ejecutivo de 2-3 líneas.
2. **FUNDAMENTOS LEGALES**: Artículos con texto literal.
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

        // 6. GENERACIÓN DE RESPUESTA
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
