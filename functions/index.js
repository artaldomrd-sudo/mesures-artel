const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

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

    for (const email of emails) {
        const token = await tokenDe(email);
        if (!token) continue;
        try {
            await getMessaging().send({
                token,
                data: {
                    title: 'Nueva cita: ' + (cita.titulo || 'Sin título'),
                    body: [fechaTexto, lugar].filter(Boolean).join(' · '),
                    url: 'ops/calendario.html'
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
                                url: urlDestino
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
    await procesarRecordatoriosMulti('citas', emailsAsignados, 'ops/calendario.html', 'Recordatorio: ');
    await procesarRecordatoriosMulti('instalaciones', (d) => d.instaladorEmail ? [d.instaladorEmail] : [], 'ops/instalaciones.html', 'Instalación próxima: ');
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
- Correderas premium en 3 series: E200 y E100 (grandes dimensiones, hasta 2000x3100mm) y E70 (europea). En 2, 3, 4 o 6 hojas.
- Galandajes / plegables (serie E63).
- Vidrios y mamparas: vidrio de ducha, mamparas de baño, paños fijos. Vidrio templado o laminado, varios espesores y tintes (natural, negro, azul, esmerilado, reflectivo).
- Barandas de vidrio.
- Fachadas y muro cortina.
- Shutters (manuales o motorizados), cortinas (roller, zebra, blackout, etc.) y toldos.
- Paneles y pisos PVC, espejos y estructuras de aluminio.
- 6 acabados de aluminio (natural, negro, antracita, blanco, bronce, madera) y colores RAL.

Tu tarea:
- Responder dudas sobre los productos y orientar al cliente según lo que describe.
- Orientar, no vender a presión. Cuando el cliente quiera cotizar, agendar una visita o que lo contacten, ofrécele con naturalidad las formas que tiene AQUÍ MISMO en el chat: puede tocar el botón "Dejar mis datos" que aparece aquí abajo y rellenar el formulario con su nombre y teléfono para que el equipo lo llame; también puede escribir por WhatsApp al +1 (849) 260-6106, o por correo a artaldom.rd@gmail.com. Menciónalo de forma fluida y conversacional, NO como una lista numerada ni con formato.
- NO inventes precios, medidas exactas ni tiempos de entrega. Si no sabes algo, dilo con sencillez y ofrece que el equipo lo confirme. No prometas nada que ARTAL no ofrezca.
- Si te preguntan algo que no tiene que ver con ARTAL, redirige con amabilidad al tema de aluminio y vidrio.

ESTILO (muy importante):
- Escribe como una persona real conversando por chat, cálida y cercana, en español dominicano neutro y tratándole de "tú". Que NO suene a robot ni demasiado formal.
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
        const texto = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        res.json({ reply: texto || 'Disculpa, no pude generar una respuesta. Escríbenos por WhatsApp al +1 (849) 260-6106.' });
    } catch (e) {
        console.error('chatBot', e);
        res.status(500).json({ error: 'server' });
    }
});
