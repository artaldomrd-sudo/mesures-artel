// ---------------------------------------------------------------------------------------------
// PUNTOS DEL EQUIPO (primer paso del sistema de Nivel / bonificaciones; usuario 2026-09-24).
//
// Cada noche (23:45 RD) se evalúa el día y se escriben eventos en el ledger `puntos` (uno por
// persona + tipo + referencia, id determinista → correr dos veces no duplica). Suben si se usó la
// plataforma a tiempo y bajan si no. Valores en `puntosConfig/general.reglas` (editables desde
// ops/puntos.html); si falta la config se usan los DEFAULTS de abajo. `visibleEquipo` (false al
// arrancar): mientras sea false el equipo no ve nada, solo gerencia. `desde`: primer día evaluado.
//
// Eventos automáticos:
//   · parte    — encargado con parte del día antes de la hora límite (+), después (+ menor),
//                sin parte esa noche (−). Incluido en el parte de otro encargado = cumplido.
//   · trabajo  — trabajo de instalación completado: el día agendado (+), 1 día tarde (0), 2+ (−).
//   · trabajo_vencido — agendado hace > N días y sin completar ni reprogramar (− una sola vez).
//   · msg      — comunicado de Mensajería: acuse en < 24 h (+), sin acuse a las 48 h (−).
//   · encuesta — el cliente califica el trabajo (satisfaccion.html): 5★ +, 4★ +, 3★ 0, 2★ −, 1★ −.
// Además la Academia ya escribe `academia` al aprobar un examen, y gerencia puede dar/quitar puntos
// a mano (`supervisor`) desde ops/puntos.html.
//
// La encuesta: al completarse un trabajo se crea `encuestas/{token}` (token aleatorio = el enlace
// público ops/satisfaccion.html?t=TOKEN, sin sesión). El instalador o gerencia lo manda al cliente
// por WhatsApp desde la tarjeta del trabajo. Al responder, se aplican los puntos a los asignados y
// gerencia recibe el resultado por Mensajería.
// ---------------------------------------------------------------------------------------------
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const crypto = require('crypto');

const DEFAULTS = {
    visibleEquipo: false,
    desde: '2026-09-24',
    horaLimiteParte: '18:00',
    diasVencido: 3,
    reglas: {
        parteATiempo: 10, parteTarde: 3, parteFalta: -10,
        trabajoATiempo: 10, trabajoUnDia: 0, trabajoTarde: -10, trabajoVencido: -5,
        msgLeido24: 2, msgNoLeido48: -3,
        encuesta5: 15, encuesta4: 5, encuesta3: 0, encuesta2: -10, encuesta1: -20
    }
};
const ROLES_EQUIPO = ['instalador', 'ayudante', 'chofer'];
const URL_BASE = 'https://artaldomrd-sudo.github.io/mesures-artel/';

module.exports = function ({ db, FieldValue, hoySantoDomingo, enviarPushUsuario, tokensPorRol, pushATokens, callerAdmin }) {

    // ---- utilidades de fecha en hora de RD --------------------------------------------------
    const TZ = 'America/Santo_Domingo';
    function partesRD(d) {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
        const g = (t) => (p.find((x) => x.type === t) || {}).value;
        return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}` };
    }
    // Acepta Timestamp de Firestore, Date, ISO string o 'YYYY-MM-DD'. Devuelve Date o null.
    function aDate(v) {
        if (!v) return null;
        if (v.toDate) return v.toDate();
        if (v instanceof Date) return v;
        if (typeof v === 'string') { const d = new Date(v.length === 10 ? v + 'T12:00:00-04:00' : v); return isNaN(d) ? null : d; }
        if (typeof v === 'object' && v._seconds != null) return new Date(v._seconds * 1000);
        return null;
    }
    const fechaRD = (v) => { const d = aDate(v); return d ? partesRD(d).fecha : ''; };
    const addDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const diffDias = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);   // a − b
    const ek = (email) => String(email || '').toLowerCase().replace(/[.@]/g, '_');
    const fmtF = (f) => String(f || '').split('-').reverse().join('/');

    async function cargarConfig() {
        const s = await db.doc('puntosConfig/general').get();
        const c = s.exists ? s.data() : {};
        return { ...DEFAULTS, ...c, reglas: { ...DEFAULTS.reglas, ...(c.reglas || {}) } };
    }
    async function equipo() {
        const snap = await db.collection('equipo').get();
        const out = new Map();
        snap.docs.forEach((d) => {
            const x = d.data() || {};
            const roles = Array.isArray(x.rol) ? x.rol : [x.rol];
            if (x.activo === false) return;
            if (!roles.some((r) => ROLES_EQUIPO.includes(r))) return;
            out.set(d.id.toLowerCase(), { email: d.id.toLowerCase(), nombre: x.nombre || d.id, roles });
        });
        return out;
    }
    // Escribe un evento del ledger con id determinista (idempotente). `puntos` puede ser 0: se guarda
    // igual para que la persona vea que ese día se evaluó (transparencia), salvo que `omitirCero`.
    async function evento({ email, nombre, tipo, ref, puntos, detalle, fechaEvento, origen, omitirCero }) {
        if (!email) return;
        if (omitirCero && !puntos) return;
        const id = `${ek(email)}__${tipo}__${String(ref).replace(/[^A-Za-z0-9_-]/g, '_')}`;
        await db.doc('puntos/' + id).set({
            email: email.toLowerCase(), nombre: nombre || email, origen: origen || 'plataforma', tipo, ref: String(ref),
            puntos: Number(puntos) || 0, detalle, fechaEvento, fecha: FieldValue.serverTimestamp(), creadoPor: 'sistema'
        });
    }

    // ---- evaluación de un día ----------------------------------------------------------------
    async function esLaborable(fecha) {
        const d = new Date(fecha + 'T12:00:00Z');
        if (d.getUTCDay() === 0) return false;
        const fer = await db.collection('rrhhFeriados').where('fecha', '==', fecha).limit(1).get();
        if (fer.empty) return true;
        return (await db.doc('rrhhFeriadosTrabajados/' + fecha).get()).exists;
    }

    async function evaluarDia(D) {
        const cfg = await cargarConfig();
        const R = cfg.reglas;
        const res = { fecha: D, partes: 0, trabajos: 0, vencidos: 0, mensajes: 0, omitido: false };
        if (D < cfg.desde) { res.omitido = true; return res; }
        const eq = await equipo();
        const nombreDe = (em) => (eq.get(String(em || '').toLowerCase()) || {}).nombre || em;

        // 1) Parte diario de los encargados.
        if (await esLaborable(D)) {
            const cfgP = await db.doc('rrhhConfig/parteDiario').get();
            const encargados = (cfgP.exists && Array.isArray(cfgP.data().encargados)) ? cfgP.data().encargados : [];
            const delDia = (await db.collection('partesDiarios').where('fecha', '==', D).get()).docs.map((d) => d.data());
            for (const e of encargados) {
                if (!e || !e.email) continue;
                const em = String(e.email).toLowerCase();
                if (e.desde && D < e.desde) continue;
                const mio = delDia.find((x) => String(x.encargadoEmail || '').toLowerCase() === em);
                const incluido = !mio && delDia.some((x) => String(x.encargadoEmail || '').toLowerCase() !== em && Array.isArray(x.incluidosEmails) && x.incluidosEmails.map((z) => String(z).toLowerCase()).includes(em));
                let pts, det;
                if (incluido) { pts = R.parteATiempo; det = `Parte del ${fmtF(D)}: trabajaste con otro encargado y él te incluyó en su parte.`; }
                else if (!mio) { pts = R.parteFalta; det = `Parte del ${fmtF(D)}: no se envió ese día.`; }
                else {
                    const c = partesRD(aDate(mio.creado) || new Date());
                    if (c.fecha < D || (c.fecha === D && c.hora <= cfg.horaLimiteParte)) { pts = R.parteATiempo; det = `Parte del ${fmtF(D)} enviado a tiempo (${c.hora}).`; }
                    else if (c.fecha === D) { pts = R.parteTarde; det = `Parte del ${fmtF(D)} enviado el mismo día pero tarde (${c.hora}, límite ${cfg.horaLimiteParte}).`; }
                    else { pts = R.parteFalta; det = `Parte del ${fmtF(D)} enviado días después (${fmtF(c.fecha)}).`; }
                }
                await evento({ email: em, nombre: e.nombre || nombreDe(em), tipo: 'parte', ref: D, puntos: pts, detalle: det, fechaEvento: D });
                res.partes++;
            }
        }

        // 2) Trabajos de instalación completados hoy + vencidos sin cerrar.
        const asignadosDe = (j) => {
            const a = Array.isArray(j.asignados) && j.asignados.length ? j.asignados.map((x) => x && x.email).filter(Boolean) : (j.instaladorEmail ? [j.instaladorEmail] : []);
            return [...new Set(a.map((x) => String(x).toLowerCase()))].filter((em) => eq.has(em));   // solo equipo de obra (no gerencia)
        };
        const limiteDe = (j) => fechaRD(j.modoFecha === 'rango' && j.fechaFin ? j.fechaFin : j.fecha);
        const insts = (await db.collection('instalaciones').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
        for (const j of insts) {
            const lim = limiteDe(j);
            if (!lim) continue;   // "por programar": sin fecha no se evalúa
            const lugar = [j.cliente, j.obra].filter(Boolean).join(' — ') || 'trabajo';
            if (j.estado === 'completado') {
                if (fechaRD(j.validadoFecha || j.estadoFecha) !== D) continue;
                const dif = diffDias(D, lim);
                let pts, det;
                if (dif <= 0) { pts = R.trabajoATiempo; det = `${lugar}: completado el día agendado (${fmtF(lim)}).`; }
                else if (dif === 1) { pts = R.trabajoUnDia; det = `${lugar}: completado un día después de lo agendado (${fmtF(lim)}).`; }
                else { pts = R.trabajoTarde; det = `${lugar}: completado ${dif} días después de lo agendado (${fmtF(lim)}).`; }
                for (const em of asignadosDe(j)) { await evento({ email: em, nombre: nombreDe(em), tipo: 'trabajo', ref: j.id, puntos: pts, detalle: det, fechaEvento: D }); res.trabajos++; }
            } else if (diffDias(D, lim) > cfg.diasVencido) {
                for (const em of asignadosDe(j)) {
                    const id = `${ek(em)}__trabajo_vencido__${j.id}`;
                    if ((await db.doc('puntos/' + id).get()).exists) continue;
                    await evento({ email: em, nombre: nombreDe(em), tipo: 'trabajo_vencido', ref: j.id, puntos: R.trabajoVencido, detalle: `${lugar}: agendado para el ${fmtF(lim)} y sigue sin completar ni reprogramar.`, fechaEvento: D });
                    res.vencidos++;
                }
            }
        }

        // 3) Comunicados de Mensajería con más de 48 h: acuse en < 24 h (+) o sin acuse (−).
        const ahora = new Date();
        const h48 = new Date(ahora - 48 * 3600000), h72 = new Date(ahora - 72 * 3600000);
        const msgs = (await db.collection('mensajes').where('fecha', '>=', h72).where('fecha', '<=', h48).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
        for (const m of msgs) {
            if (m.tipo === 'informe_obra' || m.tipo === 'encuesta') continue;   // avisos del sistema a gerencia
            const env = aDate(m.fecha); if (!env) continue;
            const dests = m.paraTodos ? [...eq.keys()] : (Array.isArray(m.destinatarios) ? m.destinatarios.map((x) => String(x).toLowerCase()) : []);
            for (const em of dests) {
                if (!eq.has(em) || em === String(m.remitenteEmail || '').toLowerCase()) continue;
                const a = (m.acuses || {})[ek(em)];
                const leidoEn = a && a.leido ? aDate(a.fecha) : null;
                const asunto = m.asunto || '(sin asunto)';
                let pts, det;
                if (leidoEn && leidoEn - env <= 24 * 3600000) { pts = R.msgLeido24; det = `Comunicado «${asunto}» leído en menos de 24 h.`; }
                else if (!leidoEn || leidoEn - env > 48 * 3600000) { pts = R.msgNoLeido48; det = `Comunicado «${asunto}» sin leer 48 h después de enviado.`; }
                else { pts = 0; det = `Comunicado «${asunto}» leído entre 24 y 48 h.`; }
                await evento({ email: em, nombre: nombreDe(em), tipo: 'msg', ref: m.id, puntos: pts, detalle: det, fechaEvento: D });
                res.mensajes++;
            }
        }
        await db.doc('puntosConfig/ultimaEvaluacion').set({ ...res, corrida: FieldValue.serverTimestamp() });
        return res;
    }

    const puntosEvaluarDiario = onSchedule({ schedule: '45 23 * * *', timeZone: TZ, timeoutSeconds: 300 }, async () => {
        const { fecha } = hoySantoDomingo();
        try { console.log('puntosEvaluarDiario', await evaluarDia(fecha)); }
        catch (e) { console.error('puntosEvaluarDiario', e); }
    });
    // Gerencia: evaluar hoy (o una fecha) a pedido desde ops/puntos.html. POST {fecha?}.
    const puntosEvaluarAhora = onRequest({ cors: true, timeoutSeconds: 300 }, async (req, res) => {
        if (req.method !== 'POST') { res.status(405).json({ error: 'POST' }); return; }
        if (!(await callerAdmin(req))) { res.status(403).json({ error: 'solo admin' }); return; }
        const f = String((req.body || {}).fecha || '').trim() || hoySantoDomingo().fecha;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) { res.status(400).json({ error: 'fecha' }); return; }
        try { res.status(200).json({ ok: true, ...(await evaluarDia(f)) }); }
        catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
    });

    // ---- encuesta de satisfacción del cliente ------------------------------------------------
    const encuestaAlCompletar = onDocumentWritten('instalaciones/{id}', async (event) => {
        const after = event.data.after.exists ? event.data.after.data() : null;
        if (!after) return;
        const before = event.data.before.exists ? event.data.before.data() : {};
        if (after.estado !== 'completado' || before.estado === 'completado' || after.encuestaToken) return;
        try {
            const cfg = await cargarConfig();
            if (hoySantoDomingo().fecha < cfg.desde) return;
            const cli = String(after.cliente || '').trim();
            // Sin cliente, o trabajo interno (viajes, almacén, taller) → no hay a quién encuestar.
            if (!cli || /^artal\b|almac[eé]n|taller/i.test(cli)) return;
            const token = crypto.randomBytes(16).toString('hex');
            const asignados = (Array.isArray(after.asignados) && after.asignados.length ? after.asignados : (after.instaladorEmail ? [{ email: after.instaladorEmail, nombre: after.instaladorNombre || '' }] : []))
                .filter((a) => a && a.email).map((a) => ({ email: String(a.email).toLowerCase(), nombre: a.nombre || '' }));
            const url = URL_BASE + 'ops/satisfaccion.html?t=' + token;
            await db.doc('encuestas/' + token).set({
                instalacionId: event.params.id, cliente: cli, obra: String(after.obra || ''), asignados,
                completadoPor: after.validadoPor || '', fechaTrabajo: fechaRD(after.validadoFecha) || hoySantoDomingo().fecha,
                estado: 'pendiente', creada: FieldValue.serverTimestamp(), url
            });
            await db.doc('instalaciones/' + event.params.id).update({ encuestaToken: token, encuestaUrl: url, encuestaEstado: 'pendiente' });
            for (const a of asignados) {
                try { await enviarPushUsuario(a.email, '⭐ Encuesta lista para el cliente', `${cli}${after.obra ? ' — ' + after.obra : ''}: envíale el enlace de satisfacción desde la tarjeta del trabajo (botón WhatsApp).`, 'ops/instalacion.html'); } catch (_) { }
            }
        } catch (e) { console.error('encuestaAlCompletar', event.params.id, e); }
    });

    const encuestaRespondida = onDocumentWritten('encuestas/{token}', async (event) => {
        const after = event.data.after.exists ? event.data.after.data() : null;
        if (!after || after.estado !== 'respondida' || !after.respuesta || after.puntosAplicados) return;
        try {
            const cfg = await cargarConfig(); const R = cfg.reglas;
            const r = after.respuesta; const g = Math.max(1, Math.min(5, Math.round(Number(r.general) || 0)));
            const pts = Number(R['encuesta' + g]) || 0;
            const lugar = [after.cliente, after.obra].filter(Boolean).join(' — ');
            const estrellas = '★'.repeat(g) + '☆'.repeat(5 - g);
            const D = hoySantoDomingo().fecha;
            for (const a of (after.asignados || [])) {
                await evento({ email: a.email, nombre: a.nombre, tipo: 'encuesta', ref: after.instalacionId || event.params.token, puntos: pts, origen: 'cliente', fechaEvento: D,
                    detalle: `El cliente calificó ${lugar} con ${estrellas} (${g}/5)${r.comentario ? ': «' + String(r.comentario).slice(0, 160) + '»' : ''}.` });
            }
            await db.doc('encuestas/' + event.params.token).update({ puntosAplicados: pts, puntosFecha: FieldValue.serverTimestamp() });
            if (after.instalacionId) { try { await db.doc('instalaciones/' + after.instalacionId).update({ encuestaEstado: 'respondida', encuestaGeneral: g, encuestaFecha: D }); } catch (_) { } }
            // Aviso a gerencia por Mensajería + push.
            const admins = (await db.collection('usuarios').get()).docs.filter((d) => { const x = d.data().rol; return (Array.isArray(x) ? x : [x]).includes('admin') && d.data().activo !== false; }).map((d) => d.id);
            const sub = (k, t) => (r[k] ? `${t}: ${'★'.repeat(Math.round(Number(r[k]) || 0))} (${r[k]}/5)` : null);
            const cuerpo = [
                `⭐ ${lugar}`, `Calificación general: ${estrellas} (${g}/5)`,
                sub('puntualidad', 'Puntualidad'), sub('limpieza', 'Limpieza y orden'), sub('trato', 'Trato del equipo'),
                r.recomendaria != null ? `¿Nos recomendaría? ${r.recomendaria ? 'Sí' : 'No'}` : null,
                r.comentario ? `Comentario: «${r.comentario}»` : null,
                '', `Equipo: ${(after.asignados || []).map((a) => a.nombre || a.email).join(', ') || '—'} → ${pts >= 0 ? '+' : ''}${pts} puntos cada uno.`
            ].filter((x) => x !== null).join('\n');
            await db.collection('mensajes').add({
                estado: 'enviado', asunto: `⭐ Encuesta del cliente — ${lugar} (${g}/5)`, cuerpo,
                remitenteEmail: 'sistema@artal', remitenteNombre: 'Sistema ARTAL (encuesta de satisfacción)',
                fecha: FieldValue.serverTimestamp(), paraTodos: false, destinatarios: admins, requiereFirma: false, adjuntos: [],
                enlace: { titulo: 'Ver puntos del equipo', url: URL_BASE + 'ops/puntos.html' }, acuses: {}, tipo: 'encuesta', encuestaToken: event.params.token
            });
            for (const em of admins) { try { await enviarPushUsuario(em, `⭐ El cliente calificó ${lugar}`, `${estrellas} (${g}/5)${r.comentario ? ' · «' + String(r.comentario).slice(0, 80) + '»' : ''}`, 'ops/mensajes.html'); } catch (_) { } }
        } catch (e) { console.error('encuestaRespondida', event.params.token, e); }
    });

    return { puntosEvaluarDiario, puntosEvaluarAhora, encuestaAlCompletar, encuestaRespondida };
};
