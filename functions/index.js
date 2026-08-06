const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { getAuth } = require('firebase-admin/auth');

initializeApp();
const db = getFirestore();

// enviarRecordatorios corre cada 5 minutos (ver más abajo) — un recordatorio "a la hora" (0 min
// antes) solo está "vigente" en el instante exacto del evento, así que sin margen el tick de
// las 5 min casi siempre lo agarra unos minutos DESPUÉS de la hora y lo marca como enviado sin
// mandar el push (por el filtro `ahora <= fecha`). Este margen deja mandarlo igual si el tick
// cae poco después de la hora, sin reabrir recordatorios de eventos realmente viejos.
const GRACE_MS = 15 * 60000;

async function tokenDe(email) {
    if (!email) return null;
    const s = await db.collection('usuarios').doc(email).get();
    return s.exists ? (s.data().fcmToken || null) : null;
}

// Tokens FCM de TODOS los usuarios que tengan alguno de los roles indicados (rol puede ser string
// o array). Solo devuelve los que ya activaron notificaciones (tienen fcmToken). `admin` NO se
// incluye automáticamente — se pasa explícito si se quiere avisar también a gerencia.
async function tokensPorRol(...roles) {
    const snap = await db.collection('usuarios').get();
    const tokens = [];
    snap.docs.forEach((d) => {
        const data = d.data();
        const rol = data.rol;
        const rolesU = Array.isArray(rol) ? rol : [rol];
        if (roles.some((r) => rolesU.includes(r)) && data.fcmToken) tokens.push(data.fcmToken);
    });
    return [...new Set(tokens)];
}

async function pushATokens(tokens, title, body, url) {
    for (const token of tokens) {
        try { await getMessaging().send({ token, data: { title, body, url } }); }
        catch (e) { console.error('pushATokens', e); }
    }
}

// Una cita/recordatorio puede tener VARIAS personas asignadas (`asignados: [{email,nombre}]`,
// ver ops/calendario.html) — antes solo admitía una (`asignadoEmail`/`asignadoNombre`). Se
// mantiene compatibilidad con citas viejas que todavía tienen solo el campo singular.
function emailsAsignados(cita) {
    if (Array.isArray(cita.asignados) && cita.asignados.length) {
        return cita.asignados.map((a) => a && a.email).filter(Boolean);
    }
    return cita.asignadoEmail ? [cita.asignadoEmail] : [];
}

// Se dispara al crear una cita en ops/calendario.html. Manda un push (solo "data", el service
// worker en sw.js decide cómo mostrarlo) a cada persona asignada — o al gerente que la creó, si
// la cita es para él mismo. No hace nada con quien nunca activó notificaciones (sin fcmToken
// guardado en usuarios/{email}).
exports.enviarNotificacionCita = onDocumentCreated('citas/{citaId}', async (event) => {
    const cita = event.data.data();
    const emails = emailsAsignados(cita);
    if (!emails.length) return;

    const fecha = cita.fecha && cita.fecha.toDate ? cita.fecha.toDate() : null;
    const fechaTexto = fecha
        ? fecha.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
    const lugar = [cita.cliente, cita.obra].filter(Boolean).join(' — ');
    // Un aviso para el equipo de instalación abre SU pantalla (Trabajo en Obra), no el calendario
    // (que es solo de gerencia). Los de gerencia siguen abriendo el calendario.
    const urlDestino = cita.asignadoA === 'instalador' ? 'ops/instalador.html' : 'ops/calendario.html';

    for (const email of emails) {
        const token = await tokenDe(email);
        if (!token) continue;
        try {
            await getMessaging().send({
                token,
                data: {
                    title: 'Nueva cita: ' + (cita.titulo || 'Sin título'),
                    body: [fechaTexto, lugar].filter(Boolean).join(' · '),
                    url: urlDestino
                }
            });
        } catch (e) {
            console.error('No se pudo enviar la notificación de la cita', event.params.citaId, email, e);
        }
    }
});

// Se dispara al crear una solicitud desde el formulario del sitio web (la muestra
// ops/solicitudes.html). Avisa por push a todo el personal de gerencia (rol admin) que tenga las
// notificaciones activadas. La colección `usuarios` es chica, así que se leen todos y se filtra
// en memoria (el rol puede ser string o array).
exports.enviarNotificacionSolicitud = onDocumentCreated('solicitudesWeb/{id}', async (event) => {
    const s = event.data.data();
    const usuarios = await db.collection('usuarios').get();
    const admins = usuarios.docs.filter((u) => {
        const rol = u.data().rol;
        const roles = Array.isArray(rol) ? rol : [rol];
        return roles.includes('admin');
    });
    const cuerpo = [s.tipo, s.nombre, s.telefono].filter(Boolean).join(' · ');
    for (const u of admins) {
        const token = u.data().fcmToken;
        if (!token) continue;
        try {
            await getMessaging().send({
                token,
                data: {
                    title: 'Nueva solicitud web' + (s.tipo ? ': ' + s.tipo : ''),
                    body: cuerpo || 'Un cliente pidió cotización desde el sitio web',
                    url: 'ops/solicitudes.html'
                }
            });
        } catch (e) {
            console.error('No se pudo enviar la notificación de solicitud web', event.params.id, u.id, e);
        }
    }
});

// Avisa por push a cada ROL cuando un pedido entra a su cola — SOLO al rol que le corresponde:
//   status 'solicitada' (destino ALUCUFEL) → contratista (cotización de costo)
//   status 'pendiente_fabrica' (ALUCUFEL) → fabrica ; (interno) → admin (fábrica interna)
//   status 'listo_para_cargar'/'parcialmente_listo' → chofer + instalador (listo para cargar/instalar)
//   comentarioParaFabrica nuevo (instrucción de oficina) → fabrica (+ admin si es interno)
// Se dispara con cualquier escritura, pero solo notifica cuando el disparador REALMENTE cambió
// (status distinto al anterior, o instrucción recién puesta) — así no repite en ediciones sueltas.
exports.enviarNotificacionPedido = onDocumentWritten('orders/{id}', async (event) => {
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after) return; // borrado
    const before = event.data.before.exists ? event.data.before.data() : {};
    const interno = after.destino === 'interno';
    const lugar = [after.cliente, after.obra].filter(Boolean).join(' — ') || 'Pedido';

    // 1) Cambio de estado que estrena una cola de trabajo.
    if (after.status && after.status !== before.status) {
        if (after.status === 'solicitada' && !interno) {
            await pushATokens(await tokensPorRol('contratista'), 'Nueva cotización de costo', lugar, 'ops/alucufel/cotizaciones.html');
        } else if (after.status === 'pendiente_fabrica') {
            if (interno) await pushATokens(await tokensPorRol('admin'), 'Nuevo pedido para fábrica interna', lugar, 'ops/fabrica-interna.html');
            else await pushATokens(await tokensPorRol('fabrica'), 'Nuevo pedido de fabricación', lugar, 'ops/alucufel/fabrica.html');
        } else if (after.status === 'listo_para_cargar' || after.status === 'parcialmente_listo') {
            await pushATokens(await tokensPorRol('chofer'), 'Pedido listo para cargar', lugar, 'ops/chofer.html');
            if (after.docType !== 'COMPRA_DIRECTA') await pushATokens(await tokensPorRol('instalador', 'ayudante'), 'Obra lista para instalar', lugar, 'ops/instalador.html');
        }
    }

    // 2) Instrucción de la oficina para fábrica (recién puesta o reabierta, sin atender).
    const instrCambio = after.comentarioParaFabrica && after.comentarioParaFabricaAtendido !== true &&
        (after.comentarioParaFabrica !== before.comentarioParaFabrica || (before.comentarioParaFabricaAtendido === true));
    if (instrCambio) {
        const titulo = '📌 Instrucción de la oficina';
        const cuerpo = lugar + ': ' + String(after.comentarioParaFabrica).slice(0, 120);
        if (interno) await pushATokens(await tokensPorRol('admin'), titulo, cuerpo, 'ops/fabrica-interna.html');
        else await pushATokens(await tokensPorRol('fabrica'), titulo, cuerpo, 'ops/alucufel/fabrica.html');
    }
});

// Recordatorios programados: cada 5 minutos revisa citas e instalaciones que tengan un
// recordatorio pendiente (recordarAntesMin > 0 y recordatorioEnviado == false) y, cuando falta
// ese tiempo o menos para el evento, manda el push y marca recordatorioEnviado = true (para no
// repetirlo). Si el evento ya pasó sin enviarse, igual se marca enviado para no reintentar.
async function procesarRecordatorios(coll, campoEmail, urlDestino, tituloPrefix) {
    const ahora = Date.now();
    const snap = await db.collection(coll).where('recordatorioEnviado', '==', false).get();
    for (const docu of snap.docs) {
        const d = docu.data();
        const fecha = d.fecha && d.fecha.toDate ? d.fecha.toDate().getTime() : null;
        const offset = Number(d.recordarAntesMin || 0);
        if (!fecha || !offset) { await docu.ref.update({ recordatorioEnviado: true }); continue; }
        if (ahora < fecha - offset * 60000) continue; // todavía no toca
        if (ahora <= fecha) {
            const token = await tokenDe(d[campoEmail]);
            if (token) {
                const fechaTexto = new Date(fecha).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
                const lugar = [d.cliente, d.obra].filter(Boolean).join(' — ');
                try {
                    await getMessaging().send({
                        token,
                        data: {
                            title: tituloPrefix + (d.titulo || lugar || 'Recordatorio'),
                            body: [fechaTexto, lugar].filter(Boolean).join(' · '),
                            url: urlDestino
                        }
                    });
                } catch (e) {
                    console.error('No se pudo enviar el recordatorio', coll, docu.id, e);
                }
            }
        }
        await docu.ref.update({ recordatorioEnviado: true });
    }
}

// Múltiples recordatorios por evento: `recordatorios` es un array de minutos-antes (ej. [30,1440]).
// `recordatoriosEnviados` guarda los que ya se mandaron; `recordatoriosPendientes` es true mientras
// falte alguno por enviar y el evento no haya pasado (se usa para la consulta).
// `getEmails(d)` reemplaza al viejo `campoEmail` (nombre de campo fijo) para poder mandarle el
// mismo aviso a VARIAS personas a la vez (citas con `asignados: [{email,nombre}]`) sin tocar
// `instalaciones`, que sigue con un solo `instaladorEmail`.
async function procesarRecordatoriosMulti(coll, getEmails, urlDestino, tituloPrefix) {
    const ahora = Date.now();
    const snap = await db.collection(coll).where('recordatoriosPendientes', '==', true).get();
    for (const docu of snap.docs) {
        const d = docu.data();
        const fecha = d.fecha && d.fecha.toDate ? d.fecha.toDate().getTime() : null;
        const offsets = Array.isArray(d.recordatorios) ? d.recordatorios : [];
        const enviados = Array.isArray(d.recordatoriosEnviados) ? d.recordatoriosEnviados.slice() : [];
        if (!fecha || !offsets.length) { await docu.ref.update({ recordatoriosPendientes: false }); continue; }

        let cambio = false;
        for (const off of offsets) {
            if (enviados.includes(off)) continue;
            if (ahora < fecha - off * 60000) continue; // aún no toca este aviso
            if (ahora <= fecha + GRACE_MS) {
                const fechaTexto = new Date(fecha).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
                const lugar = [d.cliente, d.obra].filter(Boolean).join(' — ');
                for (const email of getEmails(d)) {
                    const token = await tokenDe(email);
                    if (!token) continue;
                    try {
                        await getMessaging().send({
                            token,
                            data: {
                                title: tituloPrefix + (d.titulo || lugar || 'Recordatorio'),
                                body: [fechaTexto, lugar].filter(Boolean).join(' · '),
                                url: (typeof urlDestino === 'function' ? urlDestino(d) : urlDestino)
                            }
                        });
                    } catch (e) {
                        console.error('No se pudo enviar el recordatorio', coll, docu.id, off, email, e);
                    }
                }
            }
            enviados.push(off);
            cambio = true;
        }
        const pendientes = (ahora <= fecha + GRACE_MS) && offsets.some(o => !enviados.includes(o));
        if (cambio || pendientes !== (d.recordatoriosPendientes === true)) {
            await docu.ref.update({ recordatoriosEnviados: enviados, recordatoriosPendientes: pendientes });
        }
    }
}

exports.enviarRecordatorios = onSchedule('every 5 minutes', async () => {
    // Nuevo esquema (varios avisos por evento)
    await procesarRecordatoriosMulti('citas', emailsAsignados, (d) => d.asignadoA === 'instalador' ? 'ops/instalador.html' : 'ops/calendario.html', 'Recordatorio: ');
    await procesarRecordatoriosMulti('instalaciones', (d) => (Array.isArray(d.asignados) && d.asignados.length ? d.asignados.map(a => a && a.email).filter(Boolean) : (d.instaladorEmail ? [d.instaladorEmail] : [])), 'ops/instalaciones.html', 'Instalación próxima: ');
    // Compatibilidad con citas/instalaciones creadas con el esquema anterior (un solo aviso,
    // siempre una sola persona — no aplica lo de "varias personas", es de antes de eso)
    await procesarRecordatorios('citas', 'asignadoEmail', 'ops/calendario.html', 'Recordatorio: ');
    await procesarRecordatorios('instalaciones', 'instaladorEmail', 'ops/instalaciones.html', 'Instalación próxima: ');
});

// ---------- Bot del sitio web (asistente con Claude) ----------
// Proxy seguro entre el chat del sitio (público) y la API de Claude: la clave vive como
// "secreto" en Firebase (ANTHROPIC_API_KEY), NUNCA en la web. Recibe el historial de la
// conversación y devuelve la respuesta del asistente. Modelo económico (Haiku) — centavos por
// conversación. Sin estado: el sitio manda el historial completo en cada llamada.
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

const SISTEMA_BOT = `Te llamas Cristal y eres la asistente virtual de ARTAL Dominicana, una empresa de la República Dominicana especializada en aluminio y vidrio: fabricación e instalación a la medida. Si te preguntan tu nombre, di que eres Cristal, de ARTAL.

IDIOMA: responde SIEMPRE en el mismo idioma en que te escriba el cliente. Los idiomas principales de ARTAL son español, inglés y francés; detecta cuál usa el cliente y contéstale en ese. Si te escriben en otro idioma, contesta también en ese idioma.

Si el cliente adjunta una foto o un documento (por ejemplo una foto de su ventana, su espacio o un plano), analízalo y coméntalo con criterio para orientarlo, sin inventar medidas ni precios exactos.

Productos que ofrece ARTAL:
- Ventanas de aluminio: oscilobatiente, proyectada, corredera, batiente, soufflet, paño fijo.
- Puertas: batientes de aluminio y puertas de vidrio templado.
- Correderas premium en 3 series: E200 y E100 (para espacios grandes) y E70 (europea, más compacta). Todas en 2, 3, 4 o 6 hojas.
- Galandajes / plegables (serie E63).
- Vidrios y mamparas: vidrio de ducha, mamparas de baño, paños fijos. Vidrio templado o laminado, varios espesores y tintes (natural, negro, azul, esmerilado, reflectivo).
- Barandas de vidrio.
- Fachadas y muro cortina.
- Shutters (manuales o motorizados), cortinas (roller, zebra, blackout, etc.) y toldos.
- Paneles y pisos PVC, espejos y estructuras de aluminio.
- 6 acabados de aluminio (natural, negro, antracita, blanco, bronce, madera) y colores RAL.

MEDIDAS (explícalo siempre así, es importante para no confundir):
- Habla SIEMPRE en metros, nunca en milímetros, para que se entienda fácil.
- En las correderas, la medida máxima es POR HOJA (panel): cada hoja llega hasta 2 metros de ancho y 3.10 metros de alto.
- Como la corredera lleva varias hojas, la abertura total puede ser del ancho que el cliente necesite (se cubre sumando hojas). Lo único que no cambia es la altura: máximo 3.10 metros.
- Dilo de forma natural y clara, por ejemplo: "Cada panel llega hasta 2 metros de ancho y 3.10 de alto. Como usamos varias hojas, podemos hacer aberturas del ancho que necesites; la altura máxima sí es de 3.10 metros."

UBICACIÓN / SHOWROOM (cuando pregunten dónde están o cómo llegar):
- El showroom de ARTAL está en Las Terrenas, provincia de Samaná, República Dominicana.
- Comparte SIEMPRE este enlace de Google Maps, que tiene la ubicación exacta y navegación paso a paso para llegar: https://maps.app.goo.gl/hLc4R2RwHrbyAS4R6
- Dilo de forma natural y en el idioma del cliente, por ejemplo: "Nuestro showroom está en Las Terrenas, Samaná. Aquí tienes la ubicación exacta en Google Maps para llegar fácil: https://maps.app.goo.gl/hLc4R2RwHrbyAS4R6"
- Para horarios de atención, invita a confirmar por WhatsApp (+1 849 260-6106), porque pueden variar.

Tu tarea:
- Responder dudas sobre los productos y orientar al cliente según lo que describe.
- Orientar, no vender a presión. Cuando el cliente quiera cotizar, agendar una visita o que lo contacten, ofrécele con naturalidad las formas que tiene AQUÍ MISMO en el chat: puede tocar el botón "Dejar mis datos" que aparece aquí abajo y rellenar el formulario con su nombre y teléfono para que el equipo lo llame; también puede escribir por WhatsApp al +1 (849) 260-6106, o por correo a artaldom.rd@gmail.com. Menciónalo de forma fluida y conversacional, NO como una lista numerada ni con formato.
- NO inventes precios, medidas exactas ni tiempos de entrega. Si no sabes algo, dilo con sencillez y ofrece que el equipo lo confirme. No prometas nada que ARTAL no ofrezca.
- Si te preguntan algo que no tiene que ver con ARTAL, redirige con amabilidad al tema de aluminio y vidrio.

ESTILO (muy importante):
- Escribe como una persona real conversando por chat, cálida y cercana, tuteando al cliente (o el equivalente informal en su idioma). Que NO suene a robot ni demasiado formal.
- IDIOMA (regla estricta, por encima de todo lo demás): responde SIEMPRE en el MISMO idioma en que te escribió el cliente en su ÚLTIMO mensaje. Si te escribe en francés, respóndele en francés; en inglés, en inglés; en español, en español. Nunca cambies al español si el cliente no te escribió en español.
- Respuestas BREVES y al grano (2 a 5 frases). Sin rodeos y sin repetir lo que ya dijiste.
- Escribe en TEXTO PLANO. NO uses formato markdown de ningún tipo: nada de asteriscos para negrita (** **), nada de #, nada de listas con viñetas o números con símbolos. Solo texto normal, como un mensaje de WhatsApp. Puedes usar algún emoji de vez en cuando, con moderación.`;

exports.chatBot = onRequest({ secrets: [anthropicKey], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    try {
        const entrada = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
        // Saneo anti-abuso: solo roles válidos, texto acotado, máximo 20 turnos.
        const mensajes = entrada
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
            .slice(-20)
            .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
        if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') {
            res.status(400).json({ error: 'mensajes' }); return;
        }
        // Adjunto opcional (foto o PDF): se agrega SOLO al último turno del cliente. `data` es
        // base64 sin el prefijo "data:...;base64,". Tamaños/tipos acotados por seguridad.
        const adj = req.body && req.body.attachment;
        const tiposImg = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (adj && typeof adj.data === 'string' && adj.data.length < 7000000) {
            const ultimo = mensajes[mensajes.length - 1];
            if (adj.tipo === 'pdf') {
                ultimo.content = [
                    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: adj.data } },
                    { type: 'text', text: ultimo.content || 'Te comparto este documento.' }
                ];
            } else if (adj.tipo === 'image' && tiposImg.includes(adj.media_type)) {
                ultimo.content = [
                    { type: 'image', source: { type: 'base64', media_type: adj.media_type, data: adj.data } },
                    { type: 'text', text: ultimo.content || 'Te comparto esta foto.' }
                ];
            }
        }
        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': anthropicKey.value(),
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 600,
                system: SISTEMA_BOT,
                messages: mensajes
            })
        });
        if (!r.ok) {
            const detalle = await r.text();
            console.error('Error de la API de Claude', r.status, detalle);
            res.status(502).json({ error: 'ia' }); return;
        }
        const data = await r.json();
        let texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        // Red de seguridad: el chat no interpreta markdown, así que se quita para que no salgan
        // asteriscos ni almohadillas feas si el modelo llega a usarlos.
        texto = texto
            .replace(/\*\*(.+?)\*\*/gs, '$1')
            .replace(/__(.+?)__/gs, '$1')
            .replace(/(^|\n)#{1,6}\s*/g, '$1')
            .replace(/(^|\n)\s*[-*]\s+/g, '$1• ')
            .trim();
        res.json({ reply: texto || 'Disculpa, no pude generar una respuesta. Escríbenos por WhatsApp al +1 (849) 260-6106.' });
    } catch (e) {
        console.error('chatBot', e);
        res.status(500).json({ error: 'server' });
    }
});

// ---------- Captura de facturas de compra con AI (visión) ----------
// Recibe una foto o PDF de una FACTURA DE COMPRA / recibo de proveedor (un GASTO) y extrae los
// datos fiscales (proveedor, RNC, NCF, fecha, subtotal, ITBIS, total, concepto, categoría) con
// Claude visión, para pre-llenar el formulario de Gastos de ops/contabilidad-movimientos.html —
// que sirve luego para el reporte 606 a la DGII y, cuando se conecte, para empujar el gasto a
// Citrus. La clave de Claude vive como secreto (la misma que el bot). El usuario SIEMPRE revisa y
// corrige antes de guardar: esto es una ayuda de captura, no una fuente de verdad. Modelo
// económico con visión (Haiku) — centavos por factura; si hace falta más precisión de OCR se
// puede subir el modelo (ej. claude-sonnet-5) en una sola línea sin tocar el resto.
const CATEGORIAS_GASTO = 'Materiales / insumos, Perfiles de aluminio, Vidrios, Herrajes, Nómina y honorarios, Alquiler, Electricidad / agua, Internet / teléfono, Combustible / transporte, Herramientas, Mantenimiento / reparación, Impuestos y tasas, Comisiones, Publicidad, Gastos bancarios, Otro gasto';

const SISTEMA_FACTURA = `Eres un asistente de contabilidad de ARTAL Dominicana (aluminio y vidrio, República Dominicana). Te dan una foto o PDF de una FACTURA DE COMPRA o recibo de un proveedor (un GASTO de la empresa). Extrae los datos fiscales que veas y devuélvelos en JSON.

Reglas:
- proveedor: el nombre del comercio/proveedor que EMITE la factura (NO ARTAL, que es quien compra).
- rnc: el RNC o cédula del proveedor, SOLO dígitos (sin guiones ni espacios). Vacío si no aparece.
- ncf: el Número de Comprobante Fiscal (normalmente empieza con "B" y luego dígitos, ej. B0100000123). Vacío si no aparece.
- fecha: la fecha de la factura en formato AAAA-MM-DD. Si el año viene con 2 dígitos, asume 20xx. Vacío si no la ves.
- total: el monto TOTAL a pagar (el mayor, ya con ITBIS incluido). Solo el número, sin "RD$" ni comas de miles.
- itbis: el ITBIS/impuesto que aparezca desglosado por separado. 0 si no está desglosado.
- subtotal: total menos itbis. Si no hay itbis desglosado, subtotal = total.
- concepto: descripción corta (3 a 6 palabras) de qué se compró, en español.
- categoria: elige la que mejor aplique de esta lista EXACTA, o "Otro gasto": ${CATEGORIAS_GASTO}.

Si un campo no aparece o no estás seguro, deja el string vacío o 0. NUNCA inventes un RNC, un NCF ni un monto. Devuelve SOLO el JSON, sin texto adicional.`;

exports.extraerFactura = onRequest({ secrets: [anthropicKey], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    try {
        // `attachment.data` es base64 SIN el prefijo "data:...;base64,". Tipos/tamaño acotados.
        const adj = req.body && req.body.attachment;
        if (!adj || typeof adj.data !== 'string' || adj.data.length > 7000000) { res.status(400).json({ error: 'archivo' }); return; }
        const tiposImg = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        let bloque;
        if (adj.tipo === 'pdf') {
            bloque = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: adj.data } };
        } else if (adj.tipo === 'image' && tiposImg.includes(adj.media_type)) {
            bloque = { type: 'image', source: { type: 'base64', media_type: adj.media_type, data: adj.data } };
        } else { res.status(400).json({ error: 'tipo' }); return; }

        const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': anthropicKey.value(),
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 1024,
                system: SISTEMA_FACTURA,
                messages: [{ role: 'user', content: [bloque, { type: 'text', text: 'Extrae los datos de esta factura y devuélvelos en JSON.' }] }],
                // Salida estructurada: obliga a devolver JSON válido con exactamente estos campos
                // (Haiku 4.5 soporta output_config.format, GA — sin beta header). Igual se hace un
                // JSON.parse defensivo por si algún día se cambia el modelo por uno sin soporte.
                output_config: {
                    format: {
                        type: 'json_schema',
                        schema: {
                            type: 'object',
                            properties: {
                                proveedor: { type: 'string' }, rnc: { type: 'string' }, ncf: { type: 'string' },
                                fecha: { type: 'string' }, subtotal: { type: 'number' }, itbis: { type: 'number' },
                                total: { type: 'number' }, concepto: { type: 'string' }, categoria: { type: 'string' }
                            },
                            required: ['proveedor', 'rnc', 'ncf', 'fecha', 'subtotal', 'itbis', 'total', 'concepto', 'categoria'],
                            additionalProperties: false
                        }
                    }
                }
            })
        });
        if (!r.ok) {
            const detalle = await r.text();
            console.error('extraerFactura Claude', r.status, detalle);
            res.status(502).json({ error: 'ia' }); return;
        }
        const data = await r.json();
        const texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        let datos;
        try { datos = JSON.parse(texto); }
        catch (_) { const m = texto.match(/\{[\s\S]*\}/); datos = m ? JSON.parse(m[0]) : null; }
        if (!datos || typeof datos !== 'object') { res.status(502).json({ error: 'parse' }); return; }
        res.json({ factura: datos });
    } catch (e) {
        console.error('extraerFactura', e);
        res.status(500).json({ error: 'server' });
    }
});

// ===================== Puente con Citrus ERP (API REST v5) =====================
// El token de Citrus se genera en su portal (Seguridad → Autorización Token) y se guarda como
// SECRETO de Firebase (nunca en el código ni en el repo):
//   firebase functions:secrets:set CITRUS_TOKEN
// Se manda a Citrus en el header `Authorization` (token directo, sin "Bearer"). Base de pruebas:
// https://testapi.citrus.com.do — para producción se cambia el host.
const citrusToken = defineSecret('CITRUS_TOKEN');
const CITRUS_BASE = 'https://testapi.citrus.com.do';

// Entidades con endpoint /extraccionDatos (lectura paginada de 1000). Whitelist para no dejar
// pegarle a rutas arbitrarias desde el navegador.
const CITRUS_ENTIDADES = new Set([
    'tienda', 'cliente', 'item', 'suplidor', 'vendedor', 'categoria', 'marca', 'usuario',
    'empleado', 'almacen', 'factura-cliente', 'factura-suplidor', 'cotizacion', 'recibo',
    'orden-compra', 'orden-venta', 'conduce', 'anticipo', 'despacho', 'diario',
    'movimientoInventario', 'notaCreditoCxC', 'notaDebitoCxC'
]);

// Verifica que quien llama sea un usuario admin autenticado (manda su ID token de Firebase en
// `Authorization: Bearer <idToken>`). Devuelve el email o null.
async function callerAdmin(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer (.+)$/);
    if (!m) return null;
    try {
        const decoded = await getAuth().verifyIdToken(m[1]);
        const email = decoded.email;
        if (!email) return null;
        const s = await db.collection('usuarios').doc(email).get();
        if (!s.exists) return null;
        const rol = s.data().rol;
        const roles = Array.isArray(rol) ? rol : [rol];
        return roles.includes('admin') ? email : null;
    } catch (_) { return null; }
}

// Lectura de una entidad de Citrus (extraccionDatos). Solo admin. Devuelve tal cual la respuesta
// de Citrus (status + JSON) para poder inspeccionarla desde la pantalla de pruebas.
exports.citrusRead = onRequest({ secrets: [citrusToken], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const email = await callerAdmin(req);
    if (!email) { res.status(403).json({ error: 'no-autorizado' }); return; }

    // Modo diagnóstico: prueba varios formatos de header contra /v5/tienda para descubrir cuál
    // acepta Citrus, sin exponer el token (solo su longitud). Se dispara con { diag: true }.
    if (req.body && req.body.diag) {
        const t = citrusToken.value().trim();
        const variantes = {
            'crudo (token directo)': t,
            'Bearer <token>': 'Bearer ' + t,
            'Token <token>': 'Token ' + t
        };
        const probe = `${CITRUS_BASE}/v5/tienda/extraccionDatos`;
        const resultados = [];
        for (const [nombre, valor] of Object.entries(variantes)) {
            try {
                const rr = await fetch(probe, { headers: { 'Authorization': valor, 'Accept': 'application/json' } });
                const txt = await rr.text();
                let msg = txt;
                try { const j = JSON.parse(txt); msg = j.MensajeAutorizacion || j.mensaje || (Array.isArray(j) ? `array[${j.length}]` : JSON.stringify(j).slice(0, 120)); } catch (_) { msg = txt.slice(0, 120); }
                resultados.push({ formato: nombre, status: rr.status, mensaje: msg });
            } catch (e) { resultados.push({ formato: nombre, error: String((e && e.message) || e) }); }
        }
        res.status(200).json({ diagnostico: true, longitudToken: t.length, resultados });
        return;
    }

    const entidad = String((req.body && req.body.entidad) || '').trim();
    if (!CITRUS_ENTIDADES.has(entidad)) { res.status(400).json({ error: 'entidad', permitidas: [...CITRUS_ENTIDADES] }); return; }

    // Para la primera prueba de conexión se llama sin query params (defaults de Citrus: página 0,
    // desde 2011-07-01). Para paginar/traer detalles se agregan los parámetros del `request`.
    const pagina = Number(req.body && req.body.pagina) || 0;
    const params = new URLSearchParams();
    if (pagina > 0) params.set('request.indiceDePagina', String(pagina));
    if (req.body && req.body.detalles) params.set('request.cargarReferencias', 'true');
    const qs = params.toString();
    const url = `${CITRUS_BASE}/v5/${entidad}/extraccionDatos${qs ? '?' + qs : ''}`;

    try {
        // .trim() por si al guardar el secreto se coló un espacio/salto de línea (Citrus devuelve
        // 401 "Authorization Token Invalido" ante cualquier carácter de más).
        const r = await fetch(url, { headers: { 'Authorization': citrusToken.value().trim(), 'Accept': 'application/json' } });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = text; }
        res.status(200).json({ ok: r.ok, status: r.status, entidad, url, data });
    } catch (e) {
        console.error('citrusRead', entidad, e);
        res.status(502).json({ error: 'citrus', detalle: String((e && e.message) || e) });
    }
});

// Entidades que se permite CREAR (POST /v5/{entidad}) desde el panel. Se amplía a medida que se
// conectan flujos reales. `suplidor` + `factura-suplidor` habilitan crear una cuenta por pagar en
// ARTAL y empujarla a Citrus (el ERP fiscal).
const CITRUS_WRITE_ENTIDADES = new Set(['cliente', 'suplidor', 'factura-suplidor']);

// Crea un registro en Citrus (POST). Solo admin. Recibe { entidad, body } y devuelve la respuesta
// de Citrus tal cual (status + JSON) para inspeccionarla.
exports.citrusWrite = onRequest({ secrets: [citrusToken], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const email = await callerAdmin(req);
    if (!email) { res.status(403).json({ error: 'no-autorizado' }); return; }

    const entidad = String((req.body && req.body.entidad) || '').trim();
    if (!CITRUS_WRITE_ENTIDADES.has(entidad)) { res.status(400).json({ error: 'entidad', permitidas: [...CITRUS_WRITE_ENTIDADES] }); return; }
    const body = req.body && req.body.body;
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'body' }); return; }

    const url = `${CITRUS_BASE}/v5/${entidad}`;
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': citrusToken.value().trim(),
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = text; }
        res.status(200).json({ ok: r.ok, status: r.status, entidad, url, data });
    } catch (e) {
        console.error('citrusWrite', entidad, e);
        res.status(502).json({ error: 'citrus', detalle: String((e && e.message) || e) });
    }
});
