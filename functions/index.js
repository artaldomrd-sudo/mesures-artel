const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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

// Tokens FCM de un usuario: TODOS sus dispositivos (mapa `fcmTokens` {hash: {token, dispositivo,
// fecha}}) más el `fcmToken` suelto de versiones anteriores. Devuelve [{token, key}] sin repetidos
// (`key` = clave del mapa, o 'legacy' para el suelto) para poder borrar el que muera.
function tokensDeDoc(data) {
    const out = [], vistos = new Set();
    const mapa = (data && data.fcmTokens && typeof data.fcmTokens === 'object') ? data.fcmTokens : {};
    for (const [key, v] of Object.entries(mapa)) { const t = v && v.token; if (t && !vistos.has(t)) { vistos.add(t); out.push({ token: t, key }); } }
    if (data && data.fcmToken && !vistos.has(data.fcmToken)) out.push({ token: data.fcmToken, key: 'legacy' });
    return out;
}
async function tokensDe(email) {
    if (!email) return [];
    const s = await db.collection('usuarios').doc(email).get();
    return s.exists ? tokensDeDoc(s.data()) : [];
}
// Compat: primer token (lo usan llamadas viejas que esperaban uno solo).
async function tokenDe(email) { const t = await tokensDe(email); return t.length ? t[0].token : null; }
// Borra de usuarios/{email} un token que FCM reporta como muerto (dispositivo que desinstaló la app,
// permiso revocado, token rotado…). Así la lista se limpia sola y no se acumulan tokens inútiles.
async function purgarToken(email, entry) {
    if (!email || !entry) return;
    try {
        const upd = {};
        if (entry.key === 'legacy') upd.fcmToken = FieldValue.delete();
        else upd['fcmTokens.' + entry.key] = FieldValue.delete();
        await db.collection('usuarios').doc(email).update(upd);
        console.log('token muerto eliminado', email, entry.key);
    } catch (e) { console.warn('purgarToken', email, e && e.message); }
}
const TOKEN_MUERTO = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);
// Manda un push a TODOS los dispositivos de un usuario y limpia los tokens muertos.
async function enviarPushUsuario(email, title, body, url) {
    const entries = await tokensDe(email);
    for (const en of entries) {
        try { await getMessaging().send(buildPush(en.token, title, body, url)); }
        catch (e) { console.error('enviarPushUsuario', email, e && e.code); if (e && TOKEN_MUERTO.has(e.code)) await purgarToken(email, en); }
    }
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
        if (roles.some((r) => rolesU.includes(r))) tokensDeDoc(data).forEach((en) => tokens.push({ ...en, email: d.id }));
    });
    return tokens;
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
// Acepta strings (token suelto) o {token, key, email} (de tokensPorRol): con email se purgan los muertos.
async function pushATokens(tokens, title, body, url) {
    for (const t of tokens) {
        if (typeof t === 'string') { await enviarPush(t, title, body, url); continue; }
        try { await getMessaging().send(buildPush(t.token, title, body, url)); }
        catch (e) { console.error('pushATokens', t.email, e && e.code); if (t.email && e && TOKEN_MUERTO.has(e.code)) await purgarToken(t.email, t); }
    }
}

// Comentarios del instalador (array `comentariosInstalador` en `orders` y en `instalaciones`):
// devuelve los que se agregaron entre before y after (solo los NUEVOS, para no repetir en cada edición).
function comentariosNuevos(before, after) {
    const a = Array.isArray(after && after.comentariosInstalador) ? after.comentariosInstalador : [];
    const b = Array.isArray(before && before.comentariosInstalador) ? before.comentariosInstalador : [];
    return a.length > b.length ? a.slice(b.length) : [];
}
// Conversación de la obra (instalador ↔ gerencia). Cada mensaje nuevo avisa por push al OTRO lado:
// si lo escribió gerencia (`deRol:'gerencia'`) → a los instaladores asignados a esa obra (si no hay
// asignados, a todos los instaladores); si lo escribió un instalador → a gerencia (rol admin).
// Nunca al autor. El Panel de Control (ops/index.html) muestra además los del instalador en su centro
// de notificaciones; ops/instalacion.html muestra el hilo completo y los no leídos.
async function avisarComentarioInstalador(nuevos, lugar, docData) {
    for (const c of nuevos) {
        const autor = (c && c.email) || '';
        const texto = String((c && c.texto) || '').slice(0, 140);
        if (c && c.deRol === 'gerencia') {
            const d = docData || {};
            const asig = (Array.isArray(d.asignados) && d.asignados.length ? d.asignados.map((a) => a && a.email)
                : Array.isArray(d.asignadosInstalador) && d.asignadosInstalador.length ? d.asignadosInstalador.map((a) => a && a.email)
                : [d.instaladorEmail, d.asignadoInstaladorEmail]).filter(Boolean);
            let tokens = await tokensPorRol('instalador', 'ayudante');
            if (asig.length) tokens = tokens.filter((t) => asig.includes(t.email));
            tokens = tokens.filter((t) => t.email !== autor);
            await pushATokens(tokens, '💬 ' + ((c && c.nombre) || 'Oficina') + ' te escribió', lugar + ': ' + texto, 'ops/instalacion.html');
        } else {
            const tokens = (await tokensPorRol('admin')).filter((t) => t.email !== autor);
            await pushATokens(tokens, '💬 ' + ((c && c.nombre) || 'Instalador') + ' escribió en obra', lugar + ': ' + texto, 'ops/index.html');
        }
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
        ? fecha.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santo_Domingo' })
        : '';
    const lugar = [cita.cliente, cita.obra].filter(Boolean).join(' — ');
    // Un aviso para el equipo de instalación abre SU pantalla (Trabajo en Obra), no el calendario
    // (que es solo de gerencia). Los de gerencia siguen abriendo el calendario.
    const urlDestino = cita.asignadoA === 'instalador' ? 'ops/instalador.html' : 'ops/calendario.html';

    for (const email of emails) {
        await enviarPushUsuario(email, 'Nueva cita: ' + (cita.titulo || 'Sin título'), [fechaTexto, lugar].filter(Boolean).join(' · '), urlDestino);
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
        await enviarPushUsuario(u.id, 'Nueva solicitud web' + (s.tipo ? ': ' + s.tipo : ''), cuerpo || 'Un cliente pidió cotización desde el sitio web', 'ops/solicitudes.html');
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
        .map(([id, v]) => {
            const falt = Array.isArray(v.faltantes) && v.faltantes.length ? v.faltantes.join(', ') : '';
            return { key: id + '|' + (v.comentario || '') + '|' + falt, detalle: (falt ? 'Faltó ' + falt : '') + (v.comentario ? (falt ? ' — ' : '') + v.comentario : '') };
        });
    const antesProb = new Set(probsSinAtender(before.itemStatus).map(p => p.key));
    const nuevosProb = probsSinAtender(after.itemStatus).filter(p => !antesProb.has(p.key));
    if (nuevosProb.length) {
        const detalle = nuevosProb.map(p => p.detalle).filter(Boolean)[0] || '';
        const titulo = '🚚 El chofer reportó un faltante';
        const cuerpo = lugar + (detalle ? ': ' + String(detalle).slice(0, 120) : ' — falta un elemento por llegar');
        if (interno) await pushATokens(await tokensPorRol('admin'), titulo, cuerpo, 'ops/fabrica-interna.html');
        else await pushATokens(await tokensPorRol('fabrica'), titulo, cuerpo, 'ops/alucufel/index.html');
    }

    // 4) Comentario nuevo del instalador en una obra ("Obras asignadas" de ops/instalacion.html) → gerencia.
    await avisarComentarioInstalador(comentariosNuevos(before, after), lugar, after);
});

// Comentario nuevo del instalador en un trabajo del calendario (colección `instalaciones`) → gerencia.
exports.enviarNotificacionComentarioInstalacion = onDocumentWritten('instalaciones/{id}', async (event) => {
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;
    const before = event.data.before.exists ? event.data.before.data() : {};
    const lugar = [after.cliente, after.obra].filter(Boolean).join(' — ') || 'Trabajo de instalación';
    await avisarComentarioInstalador(comentariosNuevos(before, after), lugar, after);
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
            if (d[campoEmail]) {
                const fechaTexto = new Date(fecha).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santo_Domingo' });
                const lugar = [d.cliente, d.obra].filter(Boolean).join(' — ');
                await enviarPushUsuario(d[campoEmail], tituloPrefix + (d.titulo || lugar || 'Recordatorio'), [fechaTexto, lugar].filter(Boolean).join(' · '), urlDestino);
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
                const fechaTexto = new Date(fecha).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santo_Domingo' });
                const lugar = [d.cliente, d.obra].filter(Boolean).join(' — ');
                for (const email of getEmails(d)) {
                    await enviarPushUsuario(email, tituloPrefix + (d.titulo || lugar || 'Recordatorio'), [fechaTexto, lugar].filter(Boolean).join(' · '), (typeof urlDestino === 'function' ? urlDestino(d) : urlDestino));
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

// ---------- Parte diario de obra (ops/parte-diario.html) ----------
// Cada encargado de instalación (rrhhConfig/parteDiario.encargados) debe enviar su parte del día
// (en qué obras trabajó su equipo y cuántas horas). Aviso a las 6:00 pm y a las 6:30 pm si falta;
// a las 6:30 pm gerencia (admin) recibe además la lista de los que no lo enviaron. Mientras haya un
// parte pendiente, el encargado queda bloqueado en el resto de la plataforma (ops/parte-gate.js). Lunes a sábado,
// sin feriados (rrhhFeriados.fecha 'YYYY-MM-DD').
function hoySantoDomingo() {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(new Date());
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    return { fecha: `${g('year')}-${g('month')}-${g('day')}`, domingo: g('weekday') === 'Sun' };
}
async function recordarParteDiario(avisarAdmin) {
    const { fecha, domingo } = hoySantoDomingo();
    if (domingo) return;
    const fer = await db.collection('rrhhFeriados').where('fecha', '==', fecha).limit(1).get();
    if (!fer.empty) return;
    const cfg = await db.doc('rrhhConfig/parteDiario').get();
    const encargados = (cfg.exists && Array.isArray(cfg.data().encargados)) ? cfg.data().encargados : [];
    if (!encargados.length) return;
    const faltan = [];
    const delDia = (await db.collection('partesDiarios').where('fecha', '==', fecha).get()).docs.map((d) => d.data());
    for (const e of encargados) {
        if (!e || !e.email) continue;
        const em = String(e.email).toLowerCase();
        if (e.desde && fecha < e.desde) continue;   // todavía no se le exige (arranque escalonado)
        const id = fecha + '_' + em.replace(/[.@]/g, '_');
        const p = await db.doc('partesDiarios/' + id).get();
        if (p.exists) continue;
        // Trabajó bajo otro encargado ese día (lo incluyó en su parte) → no le toca enviar el suyo.
        if (delDia.some((x) => String(x.encargadoEmail || '').toLowerCase() !== em && Array.isArray(x.incluidosEmails) && x.incluidosEmails.includes(em))) continue;
        faltan.push(e);
        await enviarPushUsuario(e.email, '📝 Falta el parte diario de hoy', 'Registra en qué obras trabajó tu equipo hoy y cuántas horas. Hasta que lo envíes no podrás usar el resto de la plataforma.', 'ops/parte-diario.html');
    }
    if (avisarAdmin && faltan.length) {
        await pushATokens(await tokensPorRol('admin'), '📝 Partes diarios sin enviar', 'Faltan: ' + faltan.map((e) => e.nombre || e.email).join(', '), 'ops/parte-diario.html');
    }
}
exports.parteDiario18 = onSchedule({ schedule: '0 18 * * 1-6', timeZone: 'America/Santo_Domingo' }, async () => { await recordarParteDiario(false); });
exports.parteDiario1830 = onSchedule({ schedule: '30 18 * * 1-6', timeZone: 'America/Santo_Domingo' }, async () => { await recordarParteDiario(true); });

exports.arqueoManana = onSchedule({ schedule: '0 8 * * *', timeZone: 'America/Santo_Domingo' }, async () => {
    await recordarArqueo('am', '🧮 Arqueo de la MAÑANA (8:00)');
});
exports.arqueoTarde = onSchedule({ schedule: '55 16 * * *', timeZone: 'America/Santo_Domingo' }, async () => {
    await recordarArqueo('pm', '🧮 Arqueo de la TARDE (4:55)');
});

// ---------- Recurrencia de recordatorios (modo 'auto') ----------
// Genera la próxima ocurrencia de los recordatorios recurrentes en modo 'auto' cuya fecha ya pasó,
// aunque nadie tenga el calendario abierto. Los de modo 'completar' se generan del lado del cliente
// (calendario.html) cuando se marca la ocurrencia actual como hecha. Frecuencias: diario/semanal/
// mensual/anual × "cada N". El fin puede ser: nunca / N meses / hasta una fecha / N veces.
const REP_FRECS = ['diario', 'semanal', 'mensual', 'anual'];
function addPeriodo(base, repetir, cada) {
    const d = new Date(base); const n = Math.max(1, Number(cada) || 1);
    if (repetir === 'diario') d.setDate(d.getDate() + n);
    else if (repetir === 'semanal') d.setDate(d.getDate() + 7 * n);
    else if (repetir === 'mensual') d.setMonth(d.getMonth() + n);
    else if (repetir === 'anual') d.setFullYear(d.getFullYear() + n);
    return d;
}
function debeSeguirRepitiendo(c, nextDate, nextCount) {
    const fin = c.repetirFin || 'nunca';
    if (fin === 'nunca') return true;
    if (fin === 'veces') return nextCount <= (Number(c.repetirFinValor) || 1);
    if (fin === 'fecha') { const tope = c.repetirFinValor ? new Date(c.repetirFinValor + 'T23:59:59') : null; return tope ? nextDate <= tope : true; }
    if (fin === 'meses') {
        const inicio = c.repetirInicio ? new Date(c.repetirInicio) : (c.fecha && c.fecha.toDate ? c.fecha.toDate() : new Date());
        const tope = new Date(inicio); tope.setMonth(tope.getMonth() + (Number(c.repetirFinValor) || 1));
        return nextDate <= tope;
    }
    return true;
}
async function procesarRecurrencias() {
    const ahora = Date.now();
    const snap = await db.collection('citas').where('repetir', 'in', REP_FRECS).get();
    for (const docu of snap.docs) {
        const c = docu.data();
        if (c.repetirGenerado === true) continue;
        const modo = c.repetirModo || (c.repetir === 'mensual' ? 'completar' : 'auto');
        if (modo !== 'auto') continue;   // 'completar' lo maneja el cliente
        const fechaMs = c.fecha && c.fecha.toDate ? c.fecha.toDate().getTime() : null;
        if (fechaMs == null || ahora < fechaMs) continue;   // aún no pasa la fecha de esta ocurrencia
        const base = c.fecha.toDate();
        const cada = Math.max(1, Number(c.repetirCada) || 1);
        const next = addPeriodo(base, c.repetir, cada);
        const nextCount = (Number(c.repetirCount) || 1) + 1;
        await docu.ref.update({ repetirGenerado: true });   // marca antes de crear (evita duplicados)
        if (!debeSeguirRepitiendo(c, next, nextCount)) continue;   // fin de la serie
        await db.collection('citas').add({
            tipo: c.tipo || 'recordatorio', titulo: c.titulo || '', descripcion: c.descripcion || '',
            fecha: next, duracionMin: c.duracionMin || 0,
            orderId: c.orderId || null, cliente: c.cliente || '', obra: c.obra || '',
            asignadoA: c.asignadoA || 'gerente', asignados: c.asignados || [],
            etapas: (c.etapas || []).map(e => ({ titulo: e.titulo || '', nombre: e.nombre || '', email: e.email || '', hecha: false, fechaHecha: null })),
            completadoPor: [], completada: false, creadoPorNombre: c.creadoPorNombre || '',
            recordatorios: c.recordatorios || [], recordatoriosEnviados: [],
            recordatoriosPendientes: (c.recordatorios || []).length > 0,
            repetir: c.repetir, repetirCada: cada, repetirModo: 'auto',
            repetirFin: c.repetirFin || 'nunca', repetirFinValor: (c.repetirFinValor != null ? c.repetirFinValor : null),
            repetirInicio: c.repetirInicio || base.toISOString(),
            repetirCount: nextCount, repetirGenerado: false, fechaCreacion: FieldValue.serverTimestamp()
        });
    }
}

exports.enviarRecordatorios = onSchedule('every 5 minutes', async () => {
    await procesarRecurrencias();   // genera las próximas ocurrencias de los recurrentes 'auto'
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
const citrusToken = defineSecret('CITRUS_TOKEN');           // token del entorno de PRUEBAS (testapi)
const citrusTokenProd = defineSecret('CITRUS_TOKEN_PROD');  // token del Citrus REAL (api.citrus.com.do)
// Entorno activo: se fija en functions/.env (CITRUS_ENV=prod|test) y se aplica al desplegar — cambiar
// de pruebas a producción NO requiere tocar código. Una petición puede pedir `entorno:'test'` para
// seguir probando contra testapi aunque el default sea prod; nunca al revés (no se puede escalar a prod
// desde el navegador si el default es test).
const CITRUS_ENV = defineString('CITRUS_ENV', { default: 'test' });
const CITRUS_BASES = { test: 'https://testapi.citrus.com.do', prod: 'https://api.citrus.com.do' };
// `soloLectura` permite pedir explícitamente `entorno:'prod'` para VALIDAR el token de producción
// sin mover el entorno por defecto (ni desplegar): así se comprueba con un GET inofensivo antes de
// pasar toda la integración a prod. Bajar a 'test' siempre se permite; ESCALAR a 'prod' solo en
// lectura — `citrusWrite` nunca lo acepta, para no crear documentos fiscales reales por accidente.
function citrusCtx(req, soloLectura) {
    let entorno = CITRUS_ENV.value() === 'prod' ? 'prod' : 'test';
    const pedido = req.body && req.body.entorno;
    if (pedido === 'test') entorno = 'test';
    else if (pedido === 'prod' && soloLectura) entorno = 'prod';
    const token = (entorno === 'prod' ? citrusTokenProd.value() : citrusToken.value()).trim();
    return { entorno, base: CITRUS_BASES[entorno], token };
}

// Entidades con endpoint /extraccionDatos (lectura paginada de 1000). Whitelist para no dejar
// pegarle a rutas arbitrarias desde el navegador.
const CITRUS_ENTIDADES = new Set([
    'tienda', 'cliente', 'item', 'suplidor', 'vendedor', 'categoria', 'marca', 'usuario',
    'empleado', 'almacen', 'factura-cliente', 'factura-suplidor', 'cotizacion', 'recibo',
    'orden-compra', 'orden-venta', 'conduce', 'anticipo', 'despacho', 'diario',
    'movimientoInventario', 'notaCreditoCxC', 'notaDebitoCxC', 'cuenta-contable'
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

// Info de Firebase Auth de cada cuenta (solo admin, para Usuarios y roles): último acceso, fecha de
// creación y si tiene 2FA inscrito de verdad. Un cliente web no puede leer esto de otras cuentas.
exports.usuariosInfo = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'no-autorizado' }); return; }
    try {
        const out = {};
        let token;
        do {
            const page = await getAuth().listUsers(1000, token);
            page.users.forEach((u) => {
                if (!u.email) return;
                out[u.email.toLowerCase()] = {
                    ultimoAcceso: u.metadata.lastSignInTime || null,
                    creado: u.metadata.creationTime || null,
                    mfa: !!(u.multiFactor && u.multiFactor.enrolledFactors && u.multiFactor.enrolledFactors.length),
                    deshabilitado: !!u.disabled
                };
            });
            token = page.pageToken;
        } while (token);
        res.status(200).json({ ok: true, cuentas: out });
    } catch (e) { console.error('usuariosInfo', e); res.status(500).json({ ok: false, error: String((e && e.message) || e) }); }
});

// Notificación de PRUEBA a todos los dispositivos de un usuario (admin, desde Usuarios y roles):
// sirve para comprobar que le llegan sin esperar a un evento real. Devuelve cuántos dispositivos tenía.
exports.pushPrueba = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'no-autorizado' }); return; }
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email) { res.status(400).json({ error: 'email' }); return; }
    try {
        const antes = await tokensDe(email);
        await enviarPushUsuario(email, 'Prueba de notificación — ARTAL', 'Si ves este aviso, las notificaciones funcionan en este dispositivo. Enviado por ' + admin + '.', 'ops/index.html');
        const despues = await tokensDe(email);
        res.status(200).json({ ok: true, dispositivos: antes.length, vivos: despues.length });
    } catch (e) { console.error('pushPrueba', email, e); res.status(500).json({ ok: false, error: String((e && e.message) || e) }); }
});

// Directorio `equipo/{email}` = espejo NO sensible de usuarios/{email} (solo nombre, rol, activo).
// Las pantallas compartidas (instalación, mensajería, fábrica, historial…) leen de aquí; la
// colección `usuarios` completa (PIN, biometría, tokens, 2FA, ajustes) solo la lee cada quien su
// propio doc o un admin (ver firestore.rules). Se mantiene solo con este trigger.
function espejoEquipo(data) {
    const rol = Array.isArray(data.rol) ? data.rol : (data.rol ? [data.rol] : []);
    return { nombre: data.nombre || '', rol, activo: data.activo !== false, actualizado: FieldValue.serverTimestamp() };
}
exports.sincronizarEquipo = onDocumentWritten('usuarios/{email}', async (event) => {
    const email = event.params.email;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    try {
        if (!after) await db.collection('equipo').doc(email).delete();
        else await db.collection('equipo').doc(email).set(espejoEquipo(after));
    } catch (e) { console.error('sincronizarEquipo', email, e); }
});
// Reconstruye TODO el directorio (una vez, o si se desincronizó). Solo admin.
exports.equipoSync = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'no-autorizado' }); return; }
    try {
        const snap = await db.collection('usuarios').get();
        const batch = db.batch();
        snap.docs.forEach((d) => batch.set(db.collection('equipo').doc(d.id), espejoEquipo(d.data())));
        const eq = await db.collection('equipo').get();
        const vivos = new Set(snap.docs.map(d => d.id));
        eq.docs.forEach((d) => { if (!vivos.has(d.id)) batch.delete(d.ref); });
        await batch.commit();
        res.status(200).json({ ok: true, total: snap.size });
    } catch (e) { console.error('equipoSync', e); res.status(500).json({ ok: false, error: String((e && e.message) || e) }); }
});

// Quita la verificación en 2 pasos (factores MFA) a un usuario — solo admin, desde Usuarios y roles.
// Un cliente web no puede modificar los factores de otra cuenta; el Admin SDK sí.
exports.mfaReset = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'no-autorizado' }); return; }
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email) { res.status(400).json({ error: 'email' }); return; }
    try {
        const u = await getAuth().getUserByEmail(email);
        await getAuth().updateUser(u.uid, { multiFactor: { enrolledFactors: null } });
        await db.collection('usuarios').doc(email).set({ mfa: false, mfaReset: FieldValue.serverTimestamp(), mfaResetPor: admin }, { merge: true });
        res.status(200).json({ ok: true });
    } catch (e) {
        console.error('mfaReset', email, e);
        res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
});

// Configuración MFA del PROYECTO (solo admin). La consola de Firebase solo deja activar SMS; el
// método TOTP (app autenticadora) se activa por Admin SDK. body.accion: 'estado' | 'activarTotp'.
exports.mfaConfig = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'no-autorizado' }); return; }
    const accion = String((req.body && req.body.accion) || 'estado');
    const pcm = getAuth().projectConfigManager();
    const resumen = (cfg) => {
        const mfa = (cfg && cfg.multiFactorConfig) || {};
        const provs = Array.isArray(mfa.providerConfigs) ? mfa.providerConfigs : [];
        const totp = provs.find(p => p.totpProviderConfig);
        return { smsEstado: mfa.state || 'DISABLED', totpActivo: !!(totp && totp.state === 'ENABLED'), crudo: mfa };
    };
    try {
        if (accion === 'activarTotp') {
            const cfg = await pcm.updateProjectConfig({ multiFactorConfig: { providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 5 } }] } });
            console.log('TOTP activado por', admin);
            res.status(200).json({ ok: true, ...resumen(cfg) }); return;
        }
        const cfg = await pcm.getProjectConfig();
        res.status(200).json({ ok: true, ...resumen(cfg) });
    } catch (e) {
        console.error('mfaConfig', accion, e);
        res.status(500).json({ ok: false, error: String((e && e.message) || e), codigo: e && e.code });
    }
});

// Lectura de una entidad de Citrus (extraccionDatos). Solo admin. Devuelve tal cual la respuesta
// de Citrus (status + JSON) para poder inspeccionarla desde la pantalla de pruebas.
exports.citrusRead = onRequest({ secrets: [citrusToken, citrusTokenProd], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const email = await callerAdmin(req);
    if (!email) { res.status(403).json({ error: 'no-autorizado' }); return; }

    // Modo diagnóstico: prueba varios formatos de header contra /v5/tienda para descubrir cuál
    // acepta Citrus, sin exponer el token (solo su longitud). Se dispara con { diag: true }.
    const ctx = citrusCtx(req, true);   // lectura: admite { entorno: 'prod' } para validar el token real
    if (req.body && req.body.diag) {
        const t = ctx.token;
        const variantes = {
            'crudo (token directo)': t,
            'Bearer <token>': 'Bearer ' + t,
            'Token <token>': 'Token ' + t
        };
        const probe = `${ctx.base}/v5/tienda/extraccionDatos`;
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
        res.status(200).json({ diagnostico: true, entorno: ctx.entorno, longitudToken: t.length, resultados });
        return;
    }

    const entidad = String((req.body && req.body.entidad) || '').trim();
    if (!CITRUS_ENTIDADES.has(entidad)) { res.status(400).json({ error: 'entidad', permitidas: [...CITRUS_ENTIDADES] }); return; }

    // Para la primera prueba de conexión se llama sin query params (defaults de Citrus: página 0,
    // desde 2011-07-01). Para paginar/traer detalles se agregan los parámetros del `request`.
    const accion = CITRUS_LECTURA_PATH[entidad] || 'extraccionDatos';
    const pagina = Number(req.body && req.body.pagina) || 0;
    const params = new URLSearchParams();
    if (accion === 'extraccionDatos') {
        if (pagina > 0) params.set('request.indiceDePagina', String(pagina));
        if (req.body && req.body.detalles) params.set('request.cargarReferencias', 'true');
    } else if (accion === 'buscar') {
        // /buscar SÍ pagina (de 25 en 25 por defecto — comprobado 2026-09-17 contra Citrus real: sin
        // estos params solo llegaban 25 de las 352 cuentas). Los params van con el prefijo `cuentaWhere.`
        // (doc v5 pág. 229): pedimos 1000 por página para traer el catálogo completo de una vez.
        params.set('cuentaWhere.cantidadPorPagina', '1000');
        params.set('cuentaWhere.pagina', String(pagina));
    }
    const qs = params.toString();
    const url = `${ctx.base}/v5/${entidad}/${accion}${qs ? '?' + qs : ''}`;

    try {
        // .trim() por si al guardar el secreto se coló un espacio/salto de línea (Citrus devuelve
        // 401 "Authorization Token Invalido" ante cualquier carácter de más).
        const r = await fetch(url, { headers: { 'Authorization': ctx.token, 'Accept': 'application/json' } });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = text; }
        res.status(200).json({ ok: r.ok, status: r.status, entorno: ctx.entorno, entidad, url, data });
    } catch (e) {
        console.error('citrusRead', entidad, e);
        res.status(502).json({ error: 'citrus', detalle: String((e && e.message) || e) });
    }
});

// Entidades que se permite CREAR (POST /v5/{entidad}) desde el panel. Se amplía a medida que se
// conectan flujos reales. `suplidor` + `factura-suplidor` habilitan crear una cuenta por pagar en
// ARTAL y empujarla a Citrus (el ERP fiscal).
const CITRUS_WRITE_ENTIDADES = new Set(['cliente', 'suplidor', 'factura-suplidor', 'cuenta-contable']);
// Entidades que NO tienen `extraccionDatos` en Citrus (404 "No action was found on the controller"):
// se leen por `/buscar` (sin parámetros, devuelve la lista completa). Confirmado con la doc v5
// (pág. 230): cuenta-contable solo expone GET /buscar, GET /{id}, POST y PUT.
const CITRUS_LECTURA_PATH = { 'cuenta-contable': 'buscar' };

// Crea un registro en Citrus (POST). Solo admin. Recibe { entidad, body } y devuelve la respuesta
// de Citrus tal cual (status + JSON) para inspeccionarla.
exports.citrusWrite = onRequest({ secrets: [citrusToken, citrusTokenProd], cors: true }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'metodo' }); return; }
    const email = await callerAdmin(req);
    if (!email) { res.status(403).json({ error: 'no-autorizado' }); return; }

    const entidad = String((req.body && req.body.entidad) || '').trim();
    if (!CITRUS_WRITE_ENTIDADES.has(entidad)) { res.status(400).json({ error: 'entidad', permitidas: [...CITRUS_WRITE_ENTIDADES] }); return; }
    const body = req.body && req.body.body;
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'body' }); return; }

    const ctx = citrusCtx(req);
    const url = `${ctx.base}/v5/${entidad}`;
    try {
        const r = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': ctx.token,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const text = await r.text();
        let data; try { data = JSON.parse(text); } catch (_) { data = text; }
        res.status(200).json({ ok: r.ok, status: r.status, entorno: ctx.entorno, entidad, url, data });
    } catch (e) {
        console.error('citrusWrite', entidad, e);
        res.status(502).json({ error: 'citrus', detalle: String((e && e.message) || e) });
    }
});

// ---------- Importar de Citrus al Panel: clientes e ítems (Etapa 1) ----------
// Lee TODO el catálogo de Citrus (extraccionDatos paginado de 1000) y hace upsert en las colecciones
// del Panel guardando el id de Citrus en cada documento, para poder mapear después (facturas, etc.).
// Reglas acordadas con el usuario (2026-09-17): NO se borra ningún cliente del Panel; los que
// coinciden por nombre (o por documento) se enlazan y solo se les RELLENAN los campos que tenían
// vacíos; los nuevos se crean con el mismo id que usa clientes.html (nombre en minúsculas). Con
// { aplicar: false } devuelve solo el plan (vista previa), sin escribir nada.
// 'item' → 'productos' queda DESACTIVADO (decisión del usuario 2026-09-17: los ítems de Citrus son líneas de cotización sin
// código, no un catálogo; el manejo de productos se verá más adelante). El mapeo de ítems sigue abajo por si se retoma.
const IMPORT_ENTIDADES = { cliente: 'clientes', suplidor: 'proveedores', 'factura-suplidor': 'contaMovimientos', 'factura-cliente': 'contaMovimientos', diario: 'contaMovimientos' };
const normNombre = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const normKeyCliente = (s) => String(s || '').trim().toLowerCase();   // id de clientes/{id}: misma clave que clientes.html y el cuaderno
const TIPO_DOC_CITRUS = { Cedula: 'Cédula', RNC: 'RNC', Pasaporte: 'Pasaporte' };
// TipoItemId de Citrus (inferido de los datos reales, no documentado en la API): 3 = servicio /
// concepto facturable (1713 ítems: las descripciones de cotización), 2 = producto de inventario
// (silicones, urethano…), 4 = compras varias (mercancías, muebles, vehículo), 1 = un solo ítem.
const TIPO_ITEM_CITRUS = { 1: 'producto', 2: 'producto', 3: 'servicio', 4: 'producto' };
const CAT_ITEM_CITRUS = { 2: 'Consumibles', 4: 'Compras varias' };

async function citrusLeerTodo(ctx, entidad, conDetalles) {
    const out = [];
    for (let p = 0; p < 100; p++) {
        const params = new URLSearchParams();
        if (p) params.set('request.indiceDePagina', String(p));
        if (conDetalles) params.set('request.cargarReferencias', 'true');   // líneas del documento (Detalles[])
        const qs = params.toString();
        const url = `${ctx.base}/v5/${entidad}/extraccionDatos${qs ? '?' + qs : ''}`;
        const r = await fetch(url, { headers: { 'Authorization': ctx.token, 'Accept': 'application/json' } });
        const text = await r.text();
        if (!r.ok) throw new Error(`Citrus ${r.status} leyendo ${entidad} (página ${p}): ${text.slice(0, 200)}`);
        let j; try { j = JSON.parse(text); } catch (_) { throw new Error(`Citrus devolvió algo que no es JSON en ${entidad}`); }
        const arr = Array.isArray(j) ? j : (j && (j.Data || j.data || j.Items || j.items || j.Resultado || j.resultado || j.lista));
        if (!Array.isArray(arr)) throw new Error(`No reconocí la lista de ${entidad} en la respuesta de Citrus`);
        out.push(...arr);
        if (arr.length < 1000) break;
    }
    return out;
}
const limpio = (v) => String(v == null ? '' : v).trim();
function mapClienteCitrus(c) {
    return {
        nombre: limpio(c.Nombre),
        tipoDocumento: TIPO_DOC_CITRUS[c.TipoDocumento] || limpio(c.TipoDocumento),
        documento: limpio(c.Documento),
        telefono: limpio(c.Telefono1) || limpio(c.Telefono2),
        correo: limpio(c.Email).toLowerCase(),
        direccion: [limpio(c.Direccion1), limpio(c.Direccion2)].filter(Boolean).join(', '),
        contacto: limpio(c.Contacto),
        citrusTipoFactura: limpio(c.Tipo),           // "Factura de Consumo" / "Factura crédito fiscal"
        citrusEstatus: limpio(c.Estatus)
    };
}
// Campos que se RELLENAN en un cliente ya existente solo si estaban vacíos (nunca se pisa lo que el panel ya tiene).
const CAMPOS_RELLENAR_CLIENTE = ['tipoDocumento', 'documento', 'telefono', 'correo', 'direccion', 'contacto'];

function mapItemCitrus(it) {
    const precio = Number(it.Precio1) || 0;
    const costo = Number(it.CostoUltimoDeCompra) || Number(it.CostoEstandar) || 0;
    const nombre = limpio(it.Nombre);
    const desc = limpio(it.Descripcion);
    return {
        nombre,
        descripcion: desc && desc !== nombre ? desc : '',
        codigo: limpio(it.Referencia) || limpio(it.CodigoBarra),
        tipo: TIPO_ITEM_CITRUS[it.TipoItemId] || 'producto',
        precioVenta: precio,
        costo,
        activo: it.Estatus === 'Activo',
        citrusTipoItemId: Number(it.TipoItemId) || 0,
        citrusCategoriaId: it.CategoriaId == null ? null : Number(it.CategoriaId)
    };
}
// Campos que Citrus MANDA en un producto ya importado (se actualizan en cada sync). Los demás
// (fotos, categoría, unidad, descripción editada en el panel) no se tocan al re-sincronizar.
const CAMPOS_CITRUS_ITEM = ['nombre', 'codigo', 'tipo', 'precioVenta', 'costo', 'activo', 'citrusTipoItemId', 'citrusCategoriaId'];

// ---- Proveedores (suplidor) y facturas de compra (factura-suplidor) → Panel ----
// Citrus real (2026-09-17): 28 suplidores (26 RNC / 2 cédula; Ids 1 y 2 son los genéricos "Suplidor Formal/Informal"
// de Citrus, se traen porque una factura los referencia) y 158 facturas de compra desde 2025-01 (148 Pagada, 4
// Facturada = pendiente de pago, 6 Cancelada). Sin `Detalles`: Citrus manda solo el encabezado (NCF, suplidor,
// Monto = base SIN ITBIS, Impuesto = ITBIS, MontoPagado, TipoGasto DGII, MonedaId 24744 = DOP / 24745 = USD con Tasa).
const normKeyProveedor = normKeyCliente;
function mapSuplidorCitrus(s) {
    const doc = limpio(s.RNC);
    return {
        nombre: limpio(s.Nombre),
        tipoDocumento: TIPO_DOC_CITRUS[s.TipoDocumento] || limpio(s.TipoDocumento),
        rnc: doc.replace(/\D/g, ''),
        telefono: limpio(s.Telefono1) || limpio(s.Telefono2),
        correo: limpio(s.Email).toLowerCase(),
        direccion: [limpio(s.Direccion1), limpio(s.Direccion2)].filter(Boolean).join(', '),
        contacto: limpio(s.Contacto),
        tipo: limpio(s.Tipo),                        // Formal / Informal
        citrusTipoGasto: limpio(s.TipoGasto),        // tipo de gasto DGII por defecto de ese suplidor
        citrusEstatus: limpio(s.Estatus)
    };
}
const CAMPOS_RELLENAR_PROVEEDOR = ['tipoDocumento', 'rnc', 'telefono', 'correo', 'direccion', 'contacto', 'tipo', 'citrusTipoGasto'];
// Tipos de gasto del formato 606 de la DGII → categoría del panel (se usan los nombres que ya existen en el
// datalist de contabilidad-movimientos.html cuando calzan; el código DGII queda aparte en `citrusTipoGasto`).
const TIPO_GASTO_DGII = {
    '01': 'Nómina y honorarios', '02': 'Suministros y servicios', '03': 'Alquiler', '04': 'Activos fijos',
    '05': 'Gastos de representación', '06': 'Otras deducciones', '07': 'Gastos financieros', '08': 'Gastos extraordinarios',
    '09': 'Materiales / insumos', '10': 'Adquisición de activos', '11': 'Seguros'
};
const MONEDA_CITRUS = { 24744: 'DOP', 24745: 'USD' };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
function mapFacturaSuplidorCitrus(f) {
    const tasa = Number(f.Tasa) || 1;
    const moneda = MONEDA_CITRUS[Number(f.MonedaId)] || (tasa !== 1 ? 'USD' : 'DOP');
    const base = Number(f.Monto) || 0, itbis = Number(f.Impuesto) || 0;
    const fecha = limpio(f.Fecha).slice(0, 10);
    const ncf = limpio(f.NCF).toUpperCase();
    const tipoGasto = limpio(f.TipoGasto);
    const pagado = f.Estatus === 'Pagada' ? (Number(f.MontoPagado) || (base + itbis)) : (Number(f.MontoPagado) || 0);
    return {
        tipo: 'gasto',
        fecha,
        monto: r2((base + itbis) * tasa),           // el panel guarda el TOTAL con ITBIS, en pesos
        itbis: r2(itbis * tasa),
        montoPagado: r2(pagado * tasa),
        fechaPago: limpio(f.FechaPago).slice(0, 10),
        tercero: limpio(f.NombreSuplidor),
        rnc: limpio(f.RNCSuplidor).replace(/\D/g, ''),
        ncf,
        moneda, tasa: moneda === 'DOP' ? 1 : tasa, montoMoneda: moneda === 'DOP' ? null : r2(base + itbis),
        retencionISR: r2((Number(f.MontoRetencionISR) || 0) * tasa),
        retencionITBIS: r2((Number(f.MontoRetencionITBIS) || 0) * tasa),
        citrusTipoGasto: tipoGasto,
        citrusSuplidorId: Number(f.SuplidorId) || null,
        citrusEstatus: limpio(f.Estatus)
    };
}
// Campos que Citrus MANDA en una factura ya enlazada (se re-sincronizan). concepto/categoria/centroCosto/notas/
// comprobantes/metodo quedan en manos del panel una vez creado el movimiento.
const CAMPOS_CITRUS_FACTURA = ['fecha', 'monto', 'itbis', 'montoPagado', 'fechaPago', 'tercero', 'rnc', 'ncf', 'moneda', 'tasa', 'montoMoneda', 'retencionISR', 'retencionITBIS', 'citrusTipoGasto', 'citrusSuplidorId', 'citrusEstatus'];
const CAMPOS_RELLENAR_GASTO = ['itbis', 'tercero', 'rnc', 'ncf', 'fechaPago', 'montoPagado'];
const igualJSON = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

function planSuplidores(registros, existentes, ahora, plan, escrituras, coleccion) {
    const porCitrusId = new Map(), porNombre = new Map(), porRnc = new Map();
    existentes.forEach(d => {
        const x = d.data();
        if (x.citrusId != null) porCitrusId.set(Number(x.citrusId), d);
        if (x.nombre) porNombre.set(normNombre(x.nombre), d);
        if (x.rnc) porRnc.set(String(x.rnc).replace(/\D/g, ''), d);
    });
    const idsPlaneados = new Set();
    for (const s of registros) {
        const m = mapSuplidorCitrus(s);
        if (!m.nombre) continue;
        const ex = porCitrusId.get(Number(s.Id)) || (m.rnc && porRnc.get(m.rnc)) || porNombre.get(normNombre(m.nombre));
        if (ex) {
            const x = ex.data(); const cambios = {};
            if (Number(x.citrusId) !== Number(s.Id)) cambios.citrusId = Number(s.Id);
            CAMPOS_RELLENAR_PROVEEDOR.forEach(k => { if (!limpio(x[k]) && m[k]) cambios[k] = m[k]; });
            if (Object.keys(cambios).length) { plan.actualizar.push({ id: ex.id, nombre: x.nombre || m.nombre, campos: Object.keys(cambios) }); escrituras.push([ex.ref, { ...cambios, citrusSync: ahora }, true]); }
            else plan.sinCambios.push(x.nombre || m.nombre);
        } else {
            let id = normKeyProveedor(m.nombre);
            if (!id || idsPlaneados.has(id)) id = `${id || 'proveedor'}-citrus-${s.Id}`;
            idsPlaneados.add(id);
            const generico = /^suplidor (formal|informal)$/i.test(m.nombre);
            plan.crear.push({ id, nombre: m.nombre, documento: m.rnc ? `${m.tipoDocumento} ${m.rnc}` : '' });
            escrituras.push([db.collection(coleccion).doc(id), {
                ...m, citrusId: Number(s.Id), estado: s.Estatus === 'Activo' && !generico ? 'activo' : 'inactivo',
                notas: generico ? 'Registro genérico de Citrus (no es un proveedor real)' : '',
                origen: 'citrus', creadoPor: 'Importación Citrus', fechaCreacion: ahora, citrusSync: ahora
            }, true]);
        }
    }
}

function planFacturasSuplidor(registros, existentes, ahora, plan, escrituras, coleccion, desde) {
    // Solo gastos del panel: por citrusId → por NCF → por fecha + monto total (regla #5: no duplicar lo que
    // Andrea ya registró a mano; un match se ENLAZA, nunca se crea de nuevo).
    const porCitrusId = new Map(), porNcf = new Map(), porFechaMonto = new Map();
    existentes.forEach(d => {
        const x = d.data();
        if (x.tipo !== 'gasto') return;
        if (x.citrusId != null) porCitrusId.set(Number(x.citrusId), d);
        if (limpio(x.ncf)) porNcf.set(limpio(x.ncf).toUpperCase(), d);
        if (x.citrusId == null && x.fecha) porFechaMonto.set(`${x.fecha}|${r2(x.monto)}`, d);
    });
    plan.omitidas = { canceladas: 0, antesDeDesde: 0 };
    plan.totalCrear = 0;
    for (const f of registros) {
        const m = mapFacturaSuplidorCitrus(f);
        if (!m.fecha) continue;
        if (desde && m.fecha < desde) { plan.omitidas.antesDeDesde++; continue; }
        const ex = porCitrusId.get(Number(f.Id)) || (m.ncf && porNcf.get(m.ncf)) || porFechaMonto.get(`${m.fecha}|${m.monto}`);
        if (ex) {
            const x = ex.data(); const cambios = {};
            if (Number(x.citrusId) !== Number(f.Id)) {
                // Enlace de un gasto que ya existía en el panel: se marca y solo se rellenan campos vacíos.
                cambios.citrusId = Number(f.Id); cambios.citrusEstatus = m.citrusEstatus; cambios.citrusTipoGasto = m.citrusTipoGasto; cambios.citrusSuplidorId = m.citrusSuplidorId;
                CAMPOS_RELLENAR_GASTO.forEach(k => { if (!limpio(x[k]) || Number(x[k]) === 0) { if (m[k] !== '' && m[k] != null && m[k] !== 0) cambios[k] = m[k]; } });
            } else {
                CAMPOS_CITRUS_FACTURA.forEach(k => { if (!igualJSON(x[k], m[k])) cambios[k] = m[k]; });
                if (m.citrusEstatus === 'Cancelada' && x.citrusEstatus !== 'Cancelada') cambios.concepto = '⚠ ANULADA en Citrus · ' + String(x.concepto || '');
            }
            if (Object.keys(cambios).length) { plan.actualizar.push({ id: ex.id, nombre: `${m.fecha} · ${m.tercero} · RD$ ${m.monto}`, campos: Object.keys(cambios) }); escrituras.push([ex.ref, { ...cambios, citrusSync: ahora }, true]); }
            else plan.sinCambios.push(`${m.fecha} · ${m.tercero}`);
        } else {
            if (m.citrusEstatus === 'Cancelada') { plan.omitidas.canceladas++; continue; }
            const id = `citrus-fs-${f.Id}`;
            const cat = TIPO_GASTO_DGII[m.citrusTipoGasto] || 'Otro gasto';
            plan.crear.push({ id, nombre: `${m.fecha} · ${m.tercero}${m.ncf ? ' · ' + m.ncf : ''}`, precio: m.monto, fecha: m.fecha });
            plan.totalCrear = r2(plan.totalCrear + m.monto);
            plan.porAnio = plan.porAnio || {}; plan.porAnio[m.fecha.slice(0, 4)] = (plan.porAnio[m.fecha.slice(0, 4)] || 0) + 1;
            escrituras.push([db.collection(coleccion).doc(id), {
                ...m,
                concepto: `Factura ${m.ncf || 'sin NCF'} · ${m.tercero}`,
                categoria: cat, centroCosto: '', metodo: m.citrusEstatus === 'Pagada' ? 'Pagado (según Citrus)' : 'Pendiente de pago',
                cuentaBancoId: '', cuentaBancoNombre: '', proveedorId: normKeyProveedor(m.tercero),
                notas: `Importada de Citrus · tipo de gasto DGII ${m.citrusTipoGasto || '—'} · estatus ${m.citrusEstatus}` + (m.moneda !== 'DOP' ? ` · ${m.moneda} ${m.montoMoneda} a tasa ${m.tasa}` : ''),
                origen: 'citrus', creadoPor: 'Importación Citrus', fechaCreacion: ahora, citrusSync: ahora
            }, true]);
        }
    }
}

// ---- Facturas de venta (factura-cliente) → ingresos del Panel ----
// Citrus real (2026-09-17): 266 facturas 2025-03 → 2026-09 = 148 FISCALES (NCF B01/B02/E31/E32) + 118 PROFORMAS
// (`EsProForma:'True'`, "NCF" = solo un número correlativo, sin comprobante fiscal; Citrus las marca Cobrada igual).
// Con `request.cargarReferencias=true` llegan las líneas (`Detalles[].ItemDescripcion/ItemPrecio/ItemCantidad/Nota`),
// que dan un concepto legible. Total = Monto (suma bruta de líneas) − DescuentoTotal + Impuesto (comprobado con datos).
// `MontoCobrado`/`FechaCobro` vienen vacíos y los `recibo` no se enlazan a facturas → fechaPago queda vacía.
const esProforma = (f) => String(f.EsProForma) === 'True' || f.EsProForma === true;
const normNcf = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^FACTURA/, '').replace(/[^A-Z0-9]/g, '');
function conceptoDeLineas(f) {
    const det = Array.isArray(f.Detalles) ? f.Detalles : [];
    const partes = det.map(l => limpio(l.ItemDescripcion)).filter(Boolean);
    if (!partes.length) return '';
    const unicas = [...new Set(partes)];
    const txt = unicas.slice(0, 3).join(' · ');
    return unicas.length > 3 ? `${txt} (+${unicas.length - 3} líneas)` : txt;
}
function mapFacturaClienteCitrus(f, clientePanel) {
    const bruto = Number(f.Monto) || 0, desc = Number(f.DescuentoTotal) || 0, itbis = Number(f.Impuesto) || 0;
    const total = r2(bruto - desc + itbis);
    const proforma = esProforma(f);
    const fecha = limpio(f.Fecha).slice(0, 10);
    const numero = limpio(f.NCF);
    const tercero = limpio(f.NombreCliente) || (clientePanel && clientePanel.nombre) || '';
    const lineas = (Array.isArray(f.Detalles) ? f.Detalles : []).map(l => ({
        descripcion: limpio(l.ItemDescripcion), cantidad: Number(l.ItemCantidad) || 0, precio: r2(l.ItemPrecio), nota: limpio(l.Nota), citrusItemId: Number(l.ItemId) || null
    }));
    return {
        tipo: 'ingreso',
        fecha,
        monto: total,
        itbis: r2(itbis),
        descuento: r2(desc),
        montoPagado: f.Estatus === 'Cobrada' ? total : 0,
        fechaPago: '',
        tercero,
        rnc: limpio(f.Documento).replace(/\D/g, ''),
        ncf: proforma ? '' : numero.toUpperCase(),
        citrusNumero: numero,                 // en proformas es el correlativo; en fiscales repite el NCF
        citrusProforma: proforma,
        citrusTipoVenta: limpio(f.Tipo),      // Crédito / Contado
        citrusTiendaId: Number(f.TiendaId) || null,
        citrusVendedorId: Number(f.VendedorId) || null,
        citrusClienteId: Number(f.ClienteId) || null,
        clienteId: clientePanel ? clientePanel.id : '',
        citrusEstatus: limpio(f.Estatus),
        citrusEcf: String(f.EsComprobanteElectronico) === 'True' ? (limpio(f.EstatusComprobanteElectronico) || 'e-CF') : '',
        lineas
    };
}
const CAMPOS_CITRUS_VENTA = ['fecha', 'monto', 'itbis', 'descuento', 'montoPagado', 'tercero', 'rnc', 'ncf', 'citrusNumero', 'citrusProforma', 'citrusTipoVenta', 'citrusTiendaId', 'citrusVendedorId', 'citrusClienteId', 'citrusEstatus', 'citrusEcf', 'lineas', 'citrusCobro'];
const metodoCobro = (m) => m.citrusEstatus !== 'Cobrada' ? 'Pendiente de cobro'
    : 'Cobrado (según Citrus)' + (m.citrusCobro && m.citrusCobro.tipoPago ? ' · ' + m.citrusCobro.tipoPago : '') + (m.citrusCobro && m.citrusCobro.como === 'estimada' ? ' · fecha estimada' : '');
const CAMPOS_RELLENAR_INGRESO = ['itbis', 'tercero', 'rnc', 'ncf', 'montoPagado'];


// Fecha de cobro de las ventas a partir de los `recibo` de Citrus (2026-09-17). Los recibos NO referencian la factura
// (solo ClienteId, Monto, Fecha, TipoPago; 3 de 267 mencionan el número en el texto), así que se deduce por cliente:
// (1) un recibo con el monto EXACTO de la factura → fecha cierta (`como:'recibo'`); (2) si no, asignación cronológica
// FIFO por cliente (avances + pago final): la factura queda cobrada en la fecha del recibo que completa su total
// (`como:'estimada'`). Medido con datos reales: 34 exactas + 113 estimadas de 237 cobradas; 54 sin recibos que
// cuadren y 36 sin ClienteId quedan sin fecha. Solo se aplica a facturas con Estatus Cobrada.
function cobrosPorFactura(facturas, recibos) {
    const activos = recibos.filter(y => y.Estatus !== 'Cancelado' && y.ClienteId);
    const recPorCliente = new Map();
    activos.forEach(y => { const k = Number(y.ClienteId); if (!recPorCliente.has(k)) recPorCliente.set(k, []); recPorCliente.get(k).push(y); });
    recPorCliente.forEach(arr => arr.sort((a, b) => String(a.Fecha).localeCompare(String(b.Fecha))));
    const facPorCliente = new Map();
    facturas.filter(x => x.Estatus !== 'Cancelada' && x.ClienteId).forEach(x => { const k = Number(x.ClienteId); if (!facPorCliente.has(k)) facPorCliente.set(k, []); facPorCliente.get(k).push(x); });
    const montoRec = (y) => r2((Number(y.Monto) || 0) * (Number(y.Tasa) || 1));
    const totalFac = (x) => r2((Number(x.Monto) || 0) - (Number(x.DescuentoTotal) || 0) + (Number(x.Impuesto) || 0));
    const out = new Map();   // facturaId → { fechaPago, como, reciboId, tipoPago }
    facPorCliente.forEach((facs, cid) => {
        facs.sort((a, b) => String(a.Fecha).localeCompare(String(b.Fecha)));
        const recs = recPorCliente.get(cid) || [];
        const usados = new Set();
        for (const x of facs) {
            const t = totalFac(x);
            const c = recs.find(y => !usados.has(y.Id) && Math.abs(montoRec(y) - t) < 0.05);
            if (c) { usados.add(c.Id); out.set(x.Id, { fechaPago: limpio(c.Fecha).slice(0, 10), como: 'recibo', reciboId: c.Id, tipoPago: limpio(c.TipoPago) }); }
        }
        const restantes = recs.filter(y => !usados.has(y.Id));
        let acum = 0, i = 0, ultimo = null;
        for (const x of facs) {
            if (out.has(x.Id)) continue;
            const t = totalFac(x);
            while (i < restantes.length && acum < t - 1) { acum += montoRec(restantes[i]); ultimo = restantes[i]; i++; }
            if (acum >= t - 1 && ultimo) { acum = r2(acum - t); out.set(x.Id, { fechaPago: limpio(ultimo.Fecha).slice(0, 10), como: 'estimada', reciboId: ultimo.Id, tipoPago: limpio(ultimo.TipoPago) }); }
            else acum = 0;
        }
    });
    return out;
}

async function planFacturasCliente(registros, existentes, ahora, plan, escrituras, coleccion, desde, incluirProformas, ctx) {
    let cobros = new Map();
    try { cobros = cobrosPorFactura(registros, await citrusLeerTodo(ctx, 'recibo')); }
    catch (e) { console.error('recibos Citrus', e); }   // sin recibos se importa igual, solo sin fecha de cobro
    const clientesSnap = await db.collection('clientes').get();
    const clientePorCitrusId = new Map();
    clientesSnap.forEach(d => { const x = d.data(); if (x.citrusId != null) clientePorCitrusId.set(Number(x.citrusId), { id: d.id, nombre: x.nombre || '' }); });
    const porCitrusId = new Map(), porNcf = new Map(), porFechaMonto = new Map();
    existentes.forEach(d => {
        const x = d.data();
        if (x.tipo !== 'ingreso') return;
        if (x.citrusId != null) porCitrusId.set(Number(x.citrusId), d);
        if (normNcf(x.ncf)) porNcf.set(normNcf(x.ncf), d);
        if (x.citrusId == null && x.fecha) porFechaMonto.set(`${x.fecha}|${r2(x.monto)}`, d);
    });
    plan.omitidas = { canceladas: 0, antesDeDesde: 0, proformas: 0 };
    plan.totalCrear = 0; plan.porAnio = {}; plan.fiscales = 0; plan.proformas = 0;
    for (const f of registros) {
        const m = mapFacturaClienteCitrus(f, f.ClienteId ? clientePorCitrusId.get(Number(f.ClienteId)) : null);
        if (!m.fecha) continue;
        if (desde && m.fecha < desde) { plan.omitidas.antesDeDesde++; continue; }
        if (m.citrusProforma && !incluirProformas) { plan.omitidas.proformas++; continue; }
        const cobro = m.citrusEstatus === 'Cobrada' ? cobros.get(f.Id) : null;
        m.citrusCobro = cobro ? { como: cobro.como, reciboId: cobro.reciboId, tipoPago: cobro.tipoPago } : null;
        if (cobro) { m.fechaPago = cobro.fechaPago; plan.conFechaCobro = (plan.conFechaCobro || 0) + 1; }
        const ex = porCitrusId.get(Number(f.Id)) || (m.ncf && porNcf.get(normNcf(m.ncf))) || porFechaMonto.get(`${m.fecha}|${m.monto}`);
        if (ex) {
            const x = ex.data(); const cambios = {};
            if (Number(x.citrusId) !== Number(f.Id)) {
                cambios.citrusId = Number(f.Id); cambios.citrusEstatus = m.citrusEstatus; cambios.citrusProforma = m.citrusProforma; cambios.citrusNumero = m.citrusNumero; cambios.citrusClienteId = m.citrusClienteId; cambios.lineas = m.lineas;
                if (!limpio(x.clienteId) && m.clienteId) cambios.clienteId = m.clienteId;
                CAMPOS_RELLENAR_INGRESO.forEach(k => { if (!limpio(x[k]) || Number(x[k]) === 0) { if (m[k] !== '' && m[k] != null && m[k] !== 0) cambios[k] = m[k]; } });
            } else {
                CAMPOS_CITRUS_VENTA.forEach(k => { if (!igualJSON(x[k], m[k])) cambios[k] = m[k]; });
                // La fecha de cobro nunca pisa una escrita a mano: solo se toca si estaba vacía o si la puso Citrus.
                if (m.fechaPago && (!limpio(x.fechaPago) || x.citrusCobro) && x.fechaPago !== m.fechaPago) cambios.fechaPago = m.fechaPago;
                if (m.citrusCobro && /^(Cobrado \(según Citrus\)|Pendiente de cobro)/.test(String(x.metodo || ''))) { const met = metodoCobro(m); if (met !== x.metodo) cambios.metodo = met; }
                if (m.citrusEstatus === 'Cancelada' && x.citrusEstatus !== 'Cancelada') cambios.concepto = '⚠ ANULADA en Citrus · ' + String(x.concepto || '');
            }
            if (Object.keys(cambios).length) { plan.actualizar.push({ id: ex.id, nombre: `${m.fecha} · ${m.tercero} · RD$ ${m.monto}`, campos: Object.keys(cambios) }); escrituras.push([ex.ref, { ...cambios, citrusSync: ahora }, true]); }
            else plan.sinCambios.push(`${m.fecha} · ${m.tercero}`);
        } else {
            if (m.citrusEstatus === 'Cancelada') { plan.omitidas.canceladas++; continue; }
            const id = `citrus-fc-${f.Id}`;
            const etiqueta = m.citrusProforma ? `Proforma ${m.citrusNumero}` : `Factura ${m.ncf}`;
            const concepto = conceptoDeLineas(f) || 'Venta';
            plan.crear.push({ id, nombre: `${m.fecha} · ${m.tercero || 'sin cliente'} · ${etiqueta}`, precio: m.monto, fecha: m.fecha });
            plan.totalCrear = r2(plan.totalCrear + m.monto);
            plan.porAnio[m.fecha.slice(0, 4)] = (plan.porAnio[m.fecha.slice(0, 4)] || 0) + 1;
            if (m.citrusProforma) plan.proformas++; else plan.fiscales++;
            escrituras.push([db.collection(coleccion).doc(id), {
                ...m,
                concepto: `${etiqueta} · ${concepto}`,
                categoria: m.citrusProforma ? 'Venta (proforma, sin NCF)' : 'Venta de productos',
                centroCosto: '', metodo: metodoCobro(m),
                cuentaBancoId: '', cuentaBancoNombre: '',
                notas: `Importada de Citrus · ${m.citrusProforma ? 'PROFORMA (sin comprobante fiscal)' : 'factura fiscal' + (m.citrusEcf ? ' · e-CF ' + m.citrusEcf : '')} · ${m.citrusTipoVenta} · estatus ${m.citrusEstatus}`,
                origen: 'citrus', creadoPor: 'Importación Citrus', fechaCreacion: ahora, citrusSync: ahora
            }, true]);
        }
    }
}

// Núcleo reutilizable: lo usan el endpoint `citrusImportar` (botones de ops/citrus.html) y la sincronización
// programada `citrusSincronizarDiario`. Lanza Error con `codigo` 400 (entidad) / 502 (Citrus) / 500 (Firestore).
async function importarDeCitrus({ entidad, aplicar, desde, incluirProformas, ctx, quien }) {
    const coleccion = IMPORT_ENTIDADES[entidad];
    if (!coleccion) throw Object.assign(new Error('entidad'), { codigo: 400, permitidas: Object.keys(IMPORT_ENTIDADES) });
    let registros;
    try { registros = await citrusLeerTodo(ctx, entidad, entidad === 'factura-cliente' || entidad === 'diario'); }
    catch (e) { throw Object.assign(new Error(String((e && e.message) || e)), { codigo: 502 }); }

    const ahora = FieldValue.serverTimestamp();
    const existentes = await db.collection(coleccion).get();
    const plan = { crear: [], actualizar: [], sinCambios: [] };
    const escrituras = [];   // [ref, data, merge]

    if (entidad === 'cliente') {
        const porCitrusId = new Map(), porNombre = new Map(), porDocumento = new Map();
        existentes.forEach(d => {
            const x = d.data();
            if (x.citrusId != null) porCitrusId.set(Number(x.citrusId), d);
            if (x.nombre) porNombre.set(normNombre(x.nombre), d);
            if (x.documento) porDocumento.set(String(x.documento).replace(/\D/g, ''), d);
        });
        const idsPlaneados = new Set();
        for (const c of registros) {
            const m = mapClienteCitrus(c);
            if (!m.nombre) continue;
            const docNum = m.documento.replace(/\D/g, '');
            const ex = porCitrusId.get(Number(c.Id)) || (docNum && porDocumento.get(docNum)) || porNombre.get(normNombre(m.nombre));
            if (ex) {
                const x = ex.data();
                const cambios = {};
                if (Number(x.citrusId) !== Number(c.Id)) cambios.citrusId = Number(c.Id);
                CAMPOS_RELLENAR_CLIENTE.forEach(k => { if (!limpio(x[k]) && m[k]) cambios[k] = m[k]; });
                if (x.citrusTipoFactura !== m.citrusTipoFactura) cambios.citrusTipoFactura = m.citrusTipoFactura;
                if (Object.keys(cambios).length) {
                    plan.actualizar.push({ id: ex.id, nombre: x.nombre || m.nombre, campos: Object.keys(cambios) });
                    escrituras.push([ex.ref, { ...cambios, citrusSync: ahora }, true]);
                } else plan.sinCambios.push(x.nombre || m.nombre);
            } else {
                let id = normKeyCliente(m.nombre);
                if (!id || idsPlaneados.has(id)) id = `${id || 'cliente'}-citrus-${c.Id}`;
                idsPlaneados.add(id);
                plan.crear.push({ id, nombre: m.nombre, documento: m.documento ? `${m.tipoDocumento} ${m.documento}` : '' });
                escrituras.push([db.collection(coleccion).doc(id), {
                    ...m, citrusId: Number(c.Id), estado: c.Estatus === 'Activo' ? 'activo' : 'inactivo',
                    origen: 'citrus', creadoPor: 'Importación Citrus', fechaCreacion: ahora, citrusSync: ahora
                }, true]);
            }
        }
    } else if (entidad === 'suplidor') {
        planSuplidores(registros, existentes, ahora, plan, escrituras, coleccion);
    } else if (entidad === 'factura-suplidor') {
        planFacturasSuplidor(registros, existentes, ahora, plan, escrituras, coleccion, desde);
    } else if (entidad === 'factura-cliente') {
        await planFacturasCliente(registros, existentes, ahora, plan, escrituras, coleccion, desde, incluirProformas, ctx);
    } else if (entidad === 'diario') {
        planDiario(registros, existentes, ahora, plan, escrituras, coleccion, desde);
    } else {
        const porCitrusId = new Map();
        existentes.forEach(d => { const x = d.data(); if (x.citrusId != null) porCitrusId.set(Number(x.citrusId), d); });
        for (const it of registros) {
            const m = mapItemCitrus(it);
            if (!m.nombre) continue;
            const ex = porCitrusId.get(Number(it.Id));
            if (ex) {
                const x = ex.data();
                const cambios = {};
                CAMPOS_CITRUS_ITEM.forEach(k => { if (JSON.stringify(x[k] == null ? null : x[k]) !== JSON.stringify(m[k] == null ? null : m[k])) cambios[k] = m[k]; });
                if (Object.keys(cambios).length) {
                    plan.actualizar.push({ id: ex.id, nombre: x.nombre || m.nombre, campos: Object.keys(cambios) });
                    escrituras.push([ex.ref, { ...cambios, citrusSync: ahora }, true]);
                } else plan.sinCambios.push(x.nombre || m.nombre);
            } else {
                const id = `citrus-${it.Id}`;
                plan.crear.push({ id, nombre: m.nombre, precio: m.precioVenta });
                escrituras.push([db.collection(coleccion).doc(id), {
                    ...m, citrusId: Number(it.Id), categoria: CAT_ITEM_CITRUS[it.TipoItemId] || '', unidad: 'unidad', fotos: [],
                    origen: 'citrus', creadoPor: 'Importación Citrus', fechaCreacion: ahora, citrusSync: ahora
                }, true]);
            }
        }
    }

    const resumen = {
        entidad, coleccion, entorno: ctx.entorno, aplicado: aplicar,
        enCitrus: registros.length, enPanelAntes: existentes.size,
        crear: plan.crear.length, actualizar: plan.actualizar.length, sinCambios: plan.sinCambios.length,
        // Muestra: las más recientes primero (las facturas traen `fecha`; el resto conserva el orden de Citrus).
        muestraCrear: plan.crear.slice().sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))).slice(0, 25), muestraActualizar: plan.actualizar.slice(0, 25),
        porAnio: plan.porAnio || null, porFuente: plan.porFuente || null, fiscales: plan.fiscales != null ? plan.fiscales : null, proformas: plan.proformas != null ? plan.proformas : null,
        omitidas: plan.omitidas || null, totalCrear: plan.totalCrear != null ? plan.totalCrear : null,
        conFechaCobro: plan.conFechaCobro != null ? plan.conFechaCobro : null
    };
    if (!aplicar) return resumen;
    try {
        for (let i = 0; i < escrituras.length; i += 400) {
            const batch = db.batch();
            escrituras.slice(i, i + 400).forEach(([ref, data, merge]) => batch.set(ref, data, { merge }));
            await batch.commit();
        }
    } catch (e) {
        console.error('importarDeCitrus', entidad, e);
        throw Object.assign(new Error(String((e && e.message) || e)), { codigo: 500, resumen });
    }
    console.log('importarDeCitrus', quien, entidad, `crear=${plan.crear.length} actualizar=${plan.actualizar.length}`);
    return { ...resumen, escritos: escrituras.length };
}

// ---- Gastos desde el DIARIO de Citrus (banco, módulo Gasto, asientos manuales, cargos bancarios) ----
// Corrección 2026-09-18 (la contable lo señaló): `factura-suplidor` es SOLO cuentas por pagar a crédito
// (152). La mayoría de las compras se pagan contra entrega por transferencia y viven en los módulos de
// banco y de gastos de Citrus, que NO tienen endpoint en la API pero sí aparecen en el diario con
// `Fuente`. Se importa cada asiento con débito a una cuenta de costo/gasto (5xxx/6xxx) de esas fuentes
// (2.001 asientos, RD$ ~40 M). Los de Fuente "Factura Suplidor" ya entraron por factura-suplidor
// (no se duplican), depreciaciones y cierres no son gastos de caja y se omiten.
const DIARIO_FUENTES_GASTO = new Set(['Transferencia Bancaria', 'Gasto', 'Diario', 'Cargo Bancario']);
const cuentaEsGasto = (d) => d && d.Tipo === 'Debito' && /^[56]/.test(String(d.Cuenta || ''));
const cuentaEsItbis = (d) => d && d.Tipo === 'Debito' && /ITBIS/i.test(String(d.NombreCuenta || ''));
const capitalizar = (s) => { s = limpio(s).toLowerCase(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
function parseDescripcionAsiento(x) {
    const t = limpio(x.Descripcion), f = limpio(x.Fuente);
    let m;
    if (f === 'Transferencia Bancaria' && (m = t.match(/Beneficiario:\s*(.*?)\s*Concepto:\s*(.*)$/s)))
        return { tercero: limpio(m[1]), concepto: limpio(m[2]), ncf: '' };
    if (f === 'Gasto' && (m = t.match(/a la empresa\s+(.*?)\s+por:\s*[\d.,]*\s*Impuestos:\s*\$?[\d.,]*\s*NCF:\s*(\S*)\s*(?:Concepto:\s*(.*))?$/s)))
        return { tercero: limpio(m[1]), concepto: limpio(m[3]), ncf: limpio(m[2]).toUpperCase() };
    if (f === 'Cargo Bancario') { const n = t.match(/NCF:\s*(\S+)/); const b = t.match(/Cuenta de Banco:\s*(.*?)\s*Número/); return { tercero: b ? limpio(b[1]) : 'Banco', concepto: 'Cargo bancario', ncf: n ? limpio(n[1]).toUpperCase() : '' }; }
    return { tercero: '', concepto: t, ncf: '' };
}
function metodoDeCredito(nombre) {
    const n = String(nombre || '').toUpperCase();
    if (/BANCO/.test(n)) return 'Transferencia (banco, según Citrus)';
    if (/CAJA/.test(n)) return 'Efectivo (caja, según Citrus)';
    if (/NOMINA|APORTE|RETENCION/.test(n)) return 'Provisión de nómina (Citrus)';
    if (/POR PAGAR A DYLAN/.test(n)) return 'Pagado por Dylan (CxP socio, Citrus)';
    return 'Asiento de diario (Citrus)';
}
function mapAsientoCitrus(x) {
    const det = Array.isArray(x.Detalles) ? x.Detalles : [];
    const gastos = det.filter(cuentaEsGasto).map(d => ({ cuenta: String(d.Cuenta), nombre: limpio(d.NombreCuenta), monto: r2(d.Monto) })).sort((a, b) => b.monto - a.monto);
    const base = r2(gastos.reduce((s, g) => s + g.monto, 0));
    const itbis = r2(det.filter(cuentaEsItbis).reduce((s, d) => s + (Number(d.Monto) || 0), 0));
    const creditos = det.filter(d => d.Tipo === 'Credito').sort((a, b) => (Number(b.Monto) || 0) - (Number(a.Monto) || 0));
    const credito = creditos[0] || {};
    const p = parseDescripcionAsiento(x);
    const centro = (det.find(cuentaEsGasto) || {}).CentroNombre || '';
    return {
        tipo: 'gasto',
        fecha: limpio(x.Fecha).slice(0, 10),
        monto: r2(base + itbis),
        itbis,
        montoPagado: r2(base + itbis),
        fechaPago: limpio(x.Fecha).slice(0, 10),
        tercero: p.tercero || (limpio(x.Fuente) === 'Diario' ? '' : ''),
        rnc: '',
        ncf: p.ncf,
        conceptoCitrus: p.concepto,
        cuentaContable: gastos.length ? gastos[0].cuenta : '',
        cuentaContableNombre: gastos.length ? gastos[0].nombre : '',
        lineas: gastos.length > 1 ? gastos : [],
        metodoCitrus: metodoDeCredito(credito.NombreCuenta),
        cuentaBancoNombre: /BANCO/i.test(String(credito.NombreCuenta || '')) ? limpio(credito.NombreCuenta) : '',
        centroCostoCitrus: centro && centro !== 'Principal' ? centro : '',
        citrusFuente: limpio(x.Fuente),
        citrusReferencia: x.NumeroReferencia != null ? Number(x.NumeroReferencia) : null,
        citrusUsuario: limpio(x.CrearUsuario),
        citrusEstatus: limpio(x.Estatus)
    };
}
const CAMPOS_CITRUS_ASIENTO = ['fecha', 'monto', 'itbis', 'montoPagado', 'fechaPago', 'tercero', 'ncf', 'conceptoCitrus', 'cuentaContable', 'cuentaContableNombre', 'lineas', 'metodoCitrus', 'cuentaBancoNombre', 'citrusFuente', 'citrusReferencia', 'citrusUsuario', 'citrusEstatus'];

function planDiario(registros, existentes, ahora, plan, escrituras, coleccion, desde) {
    const porCitrusId = new Map(), porFechaMonto = new Map();
    existentes.forEach(d => {
        const x = d.data();
        if (x.tipo !== 'gasto') return;
        if (x.citrusId != null && String(d.id).startsWith('citrus-dj-')) porCitrusId.set(Number(x.citrusId), d);
        else if (x.citrusId == null && x.fecha) porFechaMonto.set(`${x.fecha}|${r2(x.monto)}`, d);
    });
    plan.omitidas = { canceladas: 0, antesDeDesde: 0, otrasFuentes: 0, sinCuentaGasto: 0 };
    plan.totalCrear = 0; plan.porAnio = {}; plan.porFuente = {};
    for (const x of registros) {
        if (!DIARIO_FUENTES_GASTO.has(limpio(x.Fuente))) { plan.omitidas.otrasFuentes++; continue; }
        if (!(Array.isArray(x.Detalles) && x.Detalles.some(cuentaEsGasto))) { plan.omitidas.sinCuentaGasto++; continue; }
        const m = mapAsientoCitrus(x);
        if (!m.fecha || !(m.monto > 0)) continue;
        if (desde && m.fecha < desde) { plan.omitidas.antesDeDesde++; continue; }
        const ex = porCitrusId.get(Number(x.Id)) || porFechaMonto.get(`${m.fecha}|${m.monto}`);
        if (ex) {
            const d = ex.data(); const cambios = {};
            if (!String(ex.id).startsWith('citrus-dj-') && Number(d.citrusId) !== Number(x.Id)) {
                // Gasto registrado a mano en el panel (caja chica, etc.) que coincide en fecha y monto: se enlaza.
                cambios.citrusId = Number(x.Id); cambios.citrusFuente = m.citrusFuente; cambios.citrusEstatus = m.citrusEstatus; cambios.cuentaContable = m.cuentaContable; cambios.cuentaContableNombre = m.cuentaContableNombre;
                ['itbis', 'tercero', 'ncf'].forEach(k => { if ((!limpio(d[k]) || Number(d[k]) === 0) && m[k] !== '' && m[k] !== 0) cambios[k] = m[k]; });
            } else {
                CAMPOS_CITRUS_ASIENTO.forEach(k => { if (!igualJSON(d[k], m[k])) cambios[k] = m[k]; });
                if (m.citrusEstatus === 'Cancelado' && d.citrusEstatus !== 'Cancelado') cambios.concepto = '⚠ ANULADO en Citrus · ' + String(d.concepto || '');
            }
            if (Object.keys(cambios).length) { plan.actualizar.push({ id: ex.id, nombre: `${m.fecha} · ${m.tercero || m.conceptoCitrus} · RD$ ${m.monto}`, campos: Object.keys(cambios) }); escrituras.push([ex.ref, { ...cambios, citrusSync: ahora }, true]); }
            else plan.sinCambios.push(`${m.fecha} · ${m.tercero || m.conceptoCitrus}`);
        } else {
            if (m.citrusEstatus === 'Cancelado') { plan.omitidas.canceladas++; continue; }
            const id = `citrus-dj-${x.Id}`;
            const concepto = [m.conceptoCitrus, m.tercero && !m.conceptoCitrus ? m.tercero : ''].filter(Boolean).join('') || m.cuentaContableNombre || 'Gasto';
            plan.crear.push({ id, nombre: `${m.fecha} · ${m.tercero || capitalizar(m.cuentaContableNombre)} · ${m.citrusFuente}`, precio: m.monto, fecha: m.fecha });
            plan.totalCrear = r2(plan.totalCrear + m.monto);
            plan.porAnio[m.fecha.slice(0, 4)] = (plan.porAnio[m.fecha.slice(0, 4)] || 0) + 1;
            plan.porFuente[m.citrusFuente] = (plan.porFuente[m.citrusFuente] || 0) + 1;
            escrituras.push([db.collection(coleccion).doc(id), {
                ...m,
                concepto: capitalizar(concepto),
                categoria: capitalizar(m.cuentaContableNombre) || 'Otro gasto',
                centroCosto: m.centroCostoCitrus, metodo: m.metodoCitrus, cuentaBancoId: '',
                notas: `Importado del diario de Citrus · ${m.citrusFuente}${m.citrusReferencia != null ? ' #' + m.citrusReferencia : ''} · cuenta ${m.cuentaContable} ${m.cuentaContableNombre}${m.citrusUsuario ? ' · registró ' + m.citrusUsuario : ''}`,
                origen: 'citrus', creadoPor: 'Importación Citrus', fechaCreacion: ahora, citrusSync: ahora
            }, true]);
        }
    }
}

exports.citrusImportar = onRequest({ secrets: [citrusToken, citrusTokenProd], cors: true, timeoutSeconds: 300, memory: '512MiB' }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'solo admin' }); return; }
    const b = req.body || {};
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(b.desde || '')) ? b.desde : '';
    try {
        const r = await importarDeCitrus({
            entidad: String(b.entidad || '').trim(), aplicar: !!b.aplicar, desde,
            incluirProformas: b.incluirProformas !== false, ctx: citrusCtx(req, true), quien: admin
        });
        res.status(200).json(r);
    } catch (e) {
        const codigo = e && e.codigo;
        if (codigo === 400) res.status(400).json({ error: 'entidad', permitidas: e.permitidas });
        else if (codigo === 502) res.status(502).json({ error: 'citrus', detalle: e.message });
        else res.status(500).json({ error: 'firestore', detalle: String((e && e.message) || e), ...(e && e.resumen || {}) });
    }
});

// ---- Sincronización automática (6:30 am, 12:30 pm y 5:30 pm RD): trae lo nuevo de Citrus y actualiza estados ----
// Corre las 4 importaciones con las mismas reglas que los botones (nunca borra, nunca duplica, nunca escribe en
// Citrus). Solo con CITRUS_ENV=prod: en pruebas no se ensucia el Panel con datos del entorno de test. Deja un
// registro en `citrusSync/{fecha}` y `citrusSync/ultimo` (lo muestra la sección 4 de ops/citrus.html).
const SYNC_ENTIDADES = ['cliente', 'suplidor', 'factura-suplidor', 'diario', 'factura-cliente'];
async function sincronizarCitrus(motivo) {
    const ctx = citrusCtx({ body: {} }, true);
    const fecha = hoySantoDomingo();
    const inicio = Date.now();
    const registro = { fecha, motivo, entorno: ctx.entorno, iniciado: new Date().toISOString(), resultados: {} };
    if (ctx.entorno !== 'prod') {
        registro.omitida = 'entorno de pruebas';
    } else {
        for (const entidad of SYNC_ENTIDADES) {
            try {
                const r = await importarDeCitrus({ entidad, aplicar: true, desde: '', incluirProformas: true, ctx, quien: motivo });
                registro.resultados[entidad] = { enCitrus: r.enCitrus, crear: r.crear, actualizar: r.actualizar, sinCambios: r.sinCambios, escritos: r.escritos || 0 };
            } catch (e) {
                registro.resultados[entidad] = { error: String((e && e.message) || e) };
                console.error('sincronizarCitrus', entidad, e);
            }
        }
    }
    registro.duracionSeg = Math.round((Date.now() - inicio) / 1000);
    registro.terminado = new Date().toISOString();
    await db.collection('citrusSync').doc(fecha).set(registro, { merge: true });
    await db.collection('citrusSync').doc('ultimo').set(registro);
    return registro;
}
exports.citrusSincronizarDiario = onSchedule({ schedule: '30 6,12,17 * * *', timeZone: 'America/Santo_Domingo', secrets: [citrusToken, citrusTokenProd], timeoutSeconds: 540, memory: '512MiB' }, async () => {
    await sincronizarCitrus('programada');
});
// Mismo proceso a pedido desde la pantalla (solo admin), para no esperar a la mañana siguiente.
exports.citrusSincronizarAhora = onRequest({ secrets: [citrusToken, citrusTokenProd], cors: true, timeoutSeconds: 540, memory: '512MiB' }, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST' }); return; }
    const admin = await callerAdmin(req);
    if (!admin) { res.status(403).json({ error: 'solo admin' }); return; }
    try { res.status(200).json(await sincronizarCitrus('manual · ' + admin)); }
    catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
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
