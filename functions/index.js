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

// Arma el mensaje push. Incluye SIEMPRE un bloque `notification` (no solo `data`): iOS/Safari
// necesita ese bloque para mostrar el título/cuerpo reales — sin él muestra un aviso genérico
// ("from ARTAL — Panel de Control"). También va `data` (para el service worker y el click) y
// `webpush` con el enlace de apertura.
const BASE_URL = 'https://artaldomrd-sudo.github.io/mesures-artel/';
function buildPush(token, title, body, url) {
    const b = body || '';
    const link = BASE_URL + (url || 'ops/index.html');
    return {
        token,
        notification: { title: title || 'ARTAL Operaciones', body: b },
        data: { title: title || 'ARTAL Operaciones', body: b, url: url || 'ops/index.html' },
        webpush: {
            notification: { title: title || 'ARTAL Operaciones', body: b, icon: BASE_URL + 'logo.png' },
            fcmOptions: { link }
        }
    };
}
async function enviarPush(token, title, body, url) {
    try { await getMessaging().send(buildPush(token, title, body, url)); }
    catch (e) { console.error('enviarPush', e); }
}
async function pushATokens(tokens, title, body, url) {
    for (const token of tokens) await enviarPush(token, title, body, url);
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
        await enviarPush(token, 'Nueva cita: ' + (cita.titulo || 'Sin título'), [fechaTexto, lugar].filter(Boolean).join(' · '), urlDestino);
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
        await enviarPush(token, 'Nueva solicitud web' + (s.tipo ? ': ' + s.tipo : ''), cuerpo || 'Un cliente pidió cotización desde el sitio web', 'ops/solicitudes.html');
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

    // 3) El chofer reportó un problema/faltante en un ítem (itemStatus.{id}.estado='problema').
    // Debe llegarle a FÁBRICA (ALUCUFEL, o interna) para que reponga/envíe lo que faltó. Solo por
    // los problemas NUEVOS sin atender (no repite en cada edición).
    const probsSinAtender = (m) => Object.entries(m || {})
        .filter(([, v]) => v && v.estado === 'problema' && v.atendido !== true)
        .map(([id, v]) => ({ key: id + '|' + (v.comentario || ''), comentario: v.comentario || '' }));
    const antesProb = new Set(probsSinAtender(before.itemStatus).map(p => p.key));
    const nuevosProb = probsSinAtender(after.itemStatus).filter(p => !antesProb.has(p.key));
    if (nuevosProb.length) {
        const detalle = nuevosProb.map(p => p.comentario).filter(Boolean)[0] || '';
        const titulo = '🚚 El chofer reportó un faltante';
        const cuerpo = lugar + (detalle ? ': ' + String(detalle).slice(0, 120) : ' — falta un elemento por llegar');
        if (interno) await pushATokens(await tokensPorRol('admin'), titulo, cuerpo, 'ops/fabrica-interna.html');
        else await pushATokens(await tokensPorRol('fabrica'), titulo, cuerpo, 'ops/alucufel/index.html');
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
                await enviarPush(token, tituloPrefix + (d.titulo || lugar || 'Recordatorio'), [fechaTexto, lugar].filter(Boolean).join(' · '), urlDestino);
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
                    await enviarPush(token, tituloPrefix + (d.titulo || lugar || 'Recordatorio'), [fechaTexto, lugar].filter(Boolean).join(' · '), (typeof urlDestino === 'function' ? urlDestino(d) : urlDestino));
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

// ---------- Recordatorio de arqueo de caja chica (mañana 8:00 / tarde 4:55, hora RD) ----------
// A la hora del turno, avisa por push a la encargada (rol `contable`) + gerencia (`admin`) de las
// cajas que TODAVÍA no tienen registrado el arqueo de ese turno hoy, para que no se le escape.
async function recordarArqueo(turno, titulo) {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santo_Domingo' }); // AAAA-MM-DD local
    const cajasSnap = await db.collection('bancosCajaChica').get();
    const activas = cajasSnap.docs.filter((d) => d.data().activo !== false);
    if (!activas.length) return;
    const movsSnap = await db.collection('bancosCajaMovimientos')
        .where('tipo', '==', 'arqueo').where('fecha', '==', hoy).where('turno', '==', turno).get();
    const hechas = new Set(movsSnap.docs.map((d) => d.data().cajaId));
    const pendientes = activas.filter((d) => !hechas.has(d.id));
    if (!pendientes.length) return; // ya hizo todos los arqueos de este turno
    const tokens = await tokensPorRol('contable', 'admin');
    if (!tokens.length) return;
    const nombres = pendientes.map((d) => d.data().nombre || 'caja').join(', ');
    await pushATokens(tokens, titulo, 'Cuenta el efectivo y registra el arqueo: ' + nombres, 'ops/bancos-caja.html');
}

exports.arqueoManana = onSchedule({ schedule: '0 8 * * *', timeZone: 'America/Santo_Domingo' }, async () => {
    await recordarArqueo('am', '🧮 Arqueo de la MAÑANA (8:00)');
});
exports.arqueoTarde = onSchedule({ schedule: '55 16 * * *', timeZone: 'America/Santo_Domingo' }, async () => {
    await recordarArqueo('pm', '🧮 Arqueo de la TARDE (4:55)');
});

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
- montoPagado: SOLO si el documento es un RECIBO / COMPROBANTE DE PAGO o muestra el monto que se pagó REALMENTE (puede ser menor al total por un descuento por pronto pago, ej. 3% si se paga en 15 días). Solo el número. 0 si es una factura sin evidencia de pago.
- fechaPago: la fecha en que se realizó el pago (AAAA-MM-DD), si el documento la muestra (recibo/comprobante). Vacío si no aparece.

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
                                total: { type: 'number' }, concepto: { type: 'string' }, categoria: { type: 'string' },
                                montoPagado: { type: 'number' }, fechaPago: { type: 'string' }
                            },
                            required: ['proveedor', 'rnc', 'ncf', 'fecha', 'subtotal', 'itbis', 'total', 'concepto', 'categoria', 'montoPagado', 'fechaPago'],
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

// redeploy 1786120000 (arqueo caja chica: push 8:00 / 4:55)

// --- Precios de combustible (MICM) ---------------------------------------------------------------
// El MICM fija los precios de combustibles cada semana (rigen de sábado a viernes). Esta función
// los lee de una página pública que los publica en texto plano y los guarda en
// config/preciosCombustible, que la calculadora de transporte (cuaderno index.html + ops/
// calculador-obra.html) lee EN VIVO para el "precio del galón" (campo protegido con candado).
// Corre a diario por la mañana (idempotente, merge) para atrapar el cambio semanal al día siguiente.
const COMBUSTIBLES_MICM = ['Gasolina Premium', 'Gasolina Regular', 'Gasoil Óptimo', 'Gasoil Regular', 'GLP', 'Gas Natural'];
async function scrapePreciosCombustible() {
    const url = 'https://www.conectate.com.do/articulo/precio-combustible-republica-dominicana/';
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (ARTAL-bot; precios combustible)' } });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const html = await resp.text();
    // Quita etiquetas y entidades → texto plano para buscar "<combustible> ... RD$<precio>".
    const texto = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ');
    const precios = {};
    for (const fuel of COMBUSTIBLES_MICM) {
        // "Gasoil Óptimo" puede venir con o sin acento en la Ó.
        const pat = fuel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('Óptimo', '[ÓO]ptimo');
        const re = new RegExp(pat + '[^0-9]{0,40}RD\\$\\s*([0-9]+(?:[.,][0-9]+)?)', 'i');
        const m = texto.match(re);
        if (m) {
            const n = parseFloat(m[1].replace(/,/g, ''));
            if (n > 20 && n < 1000) precios[fuel] = n;   // rango sano: descarta cifras que no son precio de galón
        }
    }
    const sm = texto.match(/[Pp]ara la semana del[^.]{0,70}/);
    const semana = sm ? sm[0].trim().replace(/\s+/g, ' ') : '';
    return { precios, semana };
}
async function guardarPreciosCombustible() {
    const { precios, semana } = await scrapePreciosCombustible();
    // Si la página cambió de formato y se parsearon menos de 3, NO se sobrescribe (se conserva lo último bueno).
    if (Object.keys(precios).length < 3) {
        console.warn('Precios de combustible: solo se parsearon', Object.keys(precios).length, '— no se sobrescribe.');
        return { ok: false, parseadas: Object.keys(precios).length, precios };
    }
    await db.collection('config').doc('preciosCombustible').set({
        precios, semana, fuente: 'conectate.com.do / MICM', actualizado: new Date().toISOString()
    }, { merge: true });
    return { ok: true, precios, semana };
}
exports.actualizarPreciosCombustible = onSchedule({ schedule: '0 8 * * *', timeZone: 'America/Santo_Domingo' }, async () => {
    try { const r = await guardarPreciosCombustible(); console.log('actualizarPreciosCombustible:', JSON.stringify(r)); }
    catch (e) { console.error('actualizarPreciosCombustible falló:', e); }
});
// Disparo manual (para probar o forzar): abrir la URL de esta función en el navegador.
exports.actualizarPreciosCombustibleAhora = onRequest({ cors: true }, async (req, res) => {
    try { const r = await guardarPreciosCombustible(); res.json(r); }
    catch (e) { console.error('actualizarPreciosCombustibleAhora', e); res.status(500).json({ ok: false, error: String((e && e.message) || e) }); }
});

// ---------- Academia: convertir conocimiento en clase real (asistente de redacción) ----------
// Toma notas en bruto / dictado del instructor y las transforma en una LECCIÓN estructurada y
// clara, o propone el ESQUEMA de un curso a partir de un tema. Misma clave secreta que el bot.
// El contenido de las lecciones se muestra como texto plano (pre-wrap), así que se pide salida en
// texto plano con encabezados en MAYÚSCULAS y viñetas "•"/pasos numerados (NADA de markdown).
// Modelo económico y disponible (Haiku 4.5); para más pulido se puede subir a claude-sonnet-4-6 en
// la línea `model`. El instructor SIEMPRE revisa y edita antes de publicar.
const SISTEMA_ACADEMIA = `Eres un diseñador instruccional experto y formador veterano de ARTAL Dominicana, empresa de República Dominicana de aluminio y vidrio (ventanas, puertas, correderas, galandajes, mamparas, barandas, duchas, shutters). Ayudas a convertir el conocimiento en bruto de un técnico experto en CLASES claras para capacitar a integrantes nuevos del equipo (instaladores, ayudantes).

Escribe en español neutro y trata al lector de "tú". Sé práctico y concreto, con el tono de un maestro de taller que enseña a un aprendiz: directo, cercano y seguro. Usa lo que sabes de instalación de aluminio y vidrio para completar y ordenar lo que falte, pero NO inventes datos específicos de ARTAL (medidas exactas, precios, nombres de proveedores, códigos) que no estén en las notas; si algo es un dato que el instructor debe rellenar, ponlo entre corchetes como [completar: ...].

FORMATO DE SALIDA: SOLO texto plano. NADA de markdown (nada de **, ##, ni guiones de lista). Para estructurar usa:
- Encabezados de sección en MAYÚSCULAS en su propia línea (ej. OBJETIVO, HERRAMIENTAS Y MATERIALES, PASO A PASO, ERRORES COMUNES, CONSEJOS DEL EXPERTO, PUNTOS CLAVE).
- Pasos como lista numerada "1. ", "2. "…
- Viñetas con "• " al inicio de la línea.
- Líneas en blanco entre secciones.`;

async function llamarClaudeAcademia(system, userText, maxTokens) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey.value(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens || 1500, system, messages: [{ role: 'user', content: userText }] })
    });
    if (!r.ok) { const d = await r.text(); console.error('Academia IA', r.status, d); throw new Error('ia'); }
    const data = await r.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

exports.academiaRedactar = onRequest({ secrets: [anthropicKey], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    try {
        const modo = (req.body && req.body.modo) || 'leccion';
        const titulo = String((req.body && req.body.titulo) || '').slice(0, 200);
        const notas = String((req.body && req.body.notas) || '').slice(0, 8000).trim();
        const curso = String((req.body && req.body.curso) || '').slice(0, 200);
        if (!notas) { res.status(400).json({ error: 'notas' }); return; }

        if (modo === 'esquema') {
            // Devuelve un esquema de curso: JSON con lista de lecciones sugeridas.
            const sys = SISTEMA_ACADEMIA + `\n\nAHORA: propón el ESQUEMA de un curso de capacitación. Devuelve SOLO un JSON válido con esta forma: {"descripcion":"1 frase de qué trata el curso","lecciones":[{"titulo":"...","resumen":"1 frase de qué se aprende"}]}. Entre 4 y 10 lecciones, en orden lógico de aprendizaje (de lo básico a lo avanzado). Sin texto fuera del JSON.`;
            const out = await llamarClaudeAcademia(sys, `Tema/curso: ${curso || titulo}\n\nNotas o ideas del instructor:\n${notas}`, 1200);
            let json = null;
            try { const m = out.match(/\{[\s\S]*\}/); json = m ? JSON.parse(m[0]) : null; } catch (_) { json = null; }
            if (!json || !Array.isArray(json.lecciones)) { res.status(502).json({ error: 'formato' }); return; }
            res.json({ esquema: json });
            return;
        }

        // modo 'leccion' (por defecto): notas -> lección estructurada. También sugiere un título.
        const sys = SISTEMA_ACADEMIA + `\n\nAHORA: convierte las notas en una LECCIÓN completa y bien organizada, lista para enseñar. Empieza la respuesta con una sola línea "TITULO: <un título claro y corto>" y luego, tras una línea en blanco, el cuerpo de la lección con las secciones que apliquen. No repitas el título dentro del cuerpo.`;
        const ctx = (curso ? `Curso: ${curso}\n` : '') + (titulo ? `Título tentativo de la lección: ${titulo}\n` : '');
        const out = await llamarClaudeAcademia(sys, `${ctx}\nNotas / conocimiento en bruto del instructor:\n${notas}`, 1800);
        let tituloSug = '', cuerpo = out;
        const mt = out.match(/^\s*TITULO:\s*(.+)\s*(\n|$)/i);
        if (mt) { tituloSug = mt[1].trim(); cuerpo = out.slice(mt[0].length).trim(); }
        res.json({ titulo: tituloSug, contenido: cuerpo });
    } catch (e) {
        console.error('academiaRedactar', e);
        res.status(500).json({ error: 'server' });
    }
});
