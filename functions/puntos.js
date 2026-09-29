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
//   · jornada  — (usuario 2026-09-27, para que un ayudante también gane) día trabajado: aparecer en algún
//                parte del día con horas (+); horas extra si el total del día pasa la jornada (+ adicional).
//                Regla GENÉRICA a propósito (usuario, mismo día): el parte solo recoge las obras registradas y
//                muchos días van a sitios que no son obra, así que no se exige que las horas sumen la jornada.
//   · falta    — día laborable marcado 'ausente' por gerencia en Asistencia de RRHH, sin permiso aprobado (−).
//                (El parte diario NO alimenta RRHH — usuario 2026-09-27; solo da costos de obra y los puntos de arriba.)
//   · valoracion — el encargado, en la ventana de horas al completar, marca 👍 bien (+) / 👌 normal (0) /
//                ⚠ flojo (−, con motivo) a cada persona que trabajó (colección `valoracionesEquipo`).
//                SIEMPRE anónimo entre ellos (usuario 2026-09-27): el detalle no nombra a quien valora y las
//                colecciones solo las leen gerencia y el autor.
//   · valoracion_enc — al revés: cada compañero que trabajó marca cómo se portó el encargado con él
//                (colección `valoracionesEncargado`, que solo leen gerencia y el autor); los puntos van al
//                encargado sin decirle quién; el comentario queda para gerencia en esa colección.
// «Quien está en el parte, cuenta» (usuario 2026-09-27): los puntos de trabajo y de encuesta van a los
// asignados Y a toda persona con horas en el parte de esa obra (mismaObra), porque a los ayudantes no los
// asignan en la agenda pero sí aparecen en el parte con sus horas.
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
        encuesta5: 15, encuesta4: 5, encuesta3: 0, encuesta2: -10, encuesta1: -20,
        diaTrabajado: 2, horasExtra: 1, faltaSinPermiso: -5,
        valoracionBien: 3, valoracionFlojo: -3, valoracionEncBien: 3, valoracionEncFlojo: -3
    }
};
const ROLES_EQUIPO = ['instalador', 'ayudante', 'chofer'];
const URL_BASE = 'https://artaldomrd-sudo.github.io/mesures-artel/';
const URL_CORTA_ENCUESTA = 'https://artaldominicana.com/e/';   // redirección en el sitio → ops/satisfaccion.html?t=CODIGO

module.exports = function ({ db, FieldValue, hoySantoDomingo, enviarPushUsuario, tokensPorRol, pushATokens, callerAdmin, mismaObra }) {

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
    // rrhhEmpleados: id → { email, nombre }. Las líneas del parte van por empleadoId; el ledger de puntos por email
    // (el `correo` del empleado en RRHH es el del login).
    async function empleadosPorId() {
        const snap = await db.collection('rrhhEmpleados').get();
        const out = new Map();
        snap.docs.forEach((d) => { const x = d.data() || {}; out.set(d.id, { email: String(x.correo || '').toLowerCase(), nombre: x.nombre || d.id }); });
        return out;
    }
    // Quiénes tuvieron horas en el parte (enviado o borrador) en ESA obra entre dos fechas → Map email → nombre.
    // Solo equipo de obra. Las líneas traen obraKey "cliente|obra" (normalizado) u obraLabel "Cliente — Obra".
    async function personasEnObra(inst, desde, hasta, eq, emps) {
        const out = new Map();
        if (!inst || !desde || !hasta || desde > hasta) return out;
        const partes = (await db.collection('partesDiarios').where('fecha', '>=', desde).where('fecha', '<=', hasta).get()).docs.map((d) => d.data());
        for (const p of partes) for (const l of (p.lineas || [])) {
            if (l.tipo !== 'obra' || !(Number(l.horas) > 0)) continue;
            const k = String(l.obraKey || ''), lab = String(l.obraLabel || '').split(' — ');
            const cli = k.includes('|') ? k.split('|')[0] : (lab[0] || ''), obra = k.includes('|') ? k.split('|').slice(1).join('|') : (lab.slice(1).join(' — ') || '');
            if (!cli || !mismaObra(inst.cliente, inst.obra, cli, obra)) continue;
            const e = emps.get(l.empleadoId); const em = e && e.email;
            if (!em || !eq.has(em)) continue;
            out.set(em, (eq.get(em) || {}).nombre || e.nombre || em);
        }
        return out;
    }
    // Escribe un evento del ledger con id determinista (idempotente). `puntos` puede ser 0: se guarda
    // igual para que la persona vea que ese día se evaluó (transparencia), salvo que `omitirCero`.
    async function evento({ email, nombre, tipo, ref, puntos, detalle, fechaEvento, origen, omitirCero, ...extra }) {
        if (!email) return;
        if (omitirCero && !puntos) return;
        const id = `${ek(email)}__${tipo}__${String(ref).replace(/[^A-Za-z0-9_-]/g, '_')}`;
        const ex = {}; for (const [k, v] of Object.entries(extra)) if (v !== undefined) ex[k] = v;   // p. ej. comentarioGerencia/por (solo admin los ve)
        await db.doc('puntos/' + id).set({
            email: email.toLowerCase(), nombre: nombre || email, origen: origen || 'plataforma', tipo, ref: String(ref),
            puntos: Number(puntos) || 0, detalle, fechaEvento, fecha: FieldValue.serverTimestamp(), creadoPor: 'sistema', ...ex
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
        const res = { fecha: D, partes: 0, jornadas: 0, faltas: 0, trabajos: 0, vencidos: 0, mensajes: 0, omitido: false };
        if (D < cfg.desde) { res.omitido = true; return res; }
        const eq = await equipo();
        const emps = await empleadosPorId();
        const nombreDe = (em) => (eq.get(String(em || '').toLowerCase()) || {}).nombre || em;
        const laborable = await esLaborable(D);

        // 1) Parte diario de los encargados.
        if (laborable) {
            const cfgP = await db.doc('rrhhConfig/parteDiario').get();
            const encargados = (cfgP.exists && Array.isArray(cfgP.data().encargados)) ? cfgP.data().encargados : [];
            const delDia = (await db.collection('partesDiarios').where('fecha', '==', D).get()).docs.map((d) => d.data());
            for (const e of encargados) {
                if (!e || !e.email) continue;
                const em = String(e.email).toLowerCase();
                if (e.desde && D < e.desde) continue;
                const mio = delDia.find((x) => String(x.encargadoEmail || '').toLowerCase() === em && !x.borrador);   // un borrador no es parte enviado
                const incluido = !mio && delDia.some((x) => !x.borrador && String(x.encargadoEmail || '').toLowerCase() !== em && Array.isArray(x.incluidosEmails) && x.incluidosEmails.map((z) => String(z).toLowerCase()).includes(em));
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

        // 1b) Día trabajado — para TODO el equipo (ayudantes incluidos): aparecer con horas en algún parte del día
        // (enviado o borrador; las horas validadas al completar son reales) = día trabajado (+). Si el total del día
        // pasa la jornada, horas extra (+ adicional). No se exige que las horas sumen la jornada: el parte solo recoge
        // las obras registradas. Un solo evento por persona y día con el desglose.
        {
            const cfgP2 = await db.doc('rrhhConfig/parteDiario').get();
            const jornada = Number(cfgP2.exists && cfgP2.data().horasJornada) || 9;
            const partesDia = (await db.collection('partesDiarios').where('fecha', '==', D).get()).docs.map((d) => d.data());
            const horasPor = new Map();   // email → { horas, obras:Set, ausente }
            for (const p of partesDia) for (const l of (p.lineas || [])) {
                const e = emps.get(l.empleadoId); const em = e && e.email; if (!em || !eq.has(em)) continue;
                const h = horasPor.get(em) || { horas: 0, obras: new Set(), ausente: false };
                if (l.tipo === 'ausente') h.ausente = true;
                else {
                    h.horas += Number(l.horas) || 0;
                    const lab = String(l.obraLabel || '').split(' — ').pop();
                    if (l.tipo === 'obra' && lab) h.obras.add(lab); else if (l.tipo && l.tipo !== 'obra') h.obras.add(l.tipo);
                }
                horasPor.set(em, h);
            }
            for (const [em, h] of horasPor) {
                if (!(h.horas > 0)) continue;
                let pts = Number(R.diaTrabajado) || 0; const tramos = ['día trabajado'];
                if (h.horas > jornada) { pts += Number(R.horasExtra) || 0; tramos.push(`${Math.round((h.horas - jornada) * 10) / 10} h extra`); }
                const donde = h.obras.size ? ' en ' + [...h.obras].slice(0, 3).join(', ') + (h.obras.size > 3 ? '…' : '') : '';
                await evento({ email: em, nombre: nombreDe(em), tipo: 'jornada', ref: D, puntos: pts, fechaEvento: D, detalle: `${fmtF(D)}: ${tramos.join(' + ')} (${Math.round(h.horas * 10) / 10} h en el parte${donde}).` });
                res.jornadas++;
            }
            // Falta sin permiso (solo día laborable): SOLO lo que gerencia registró a mano en Asistencia de RRHH
            // ('ausente'), sin horas en ningún parte ese día y sin permiso aprobado que cubra la fecha. Una línea 'ausente'
            // del parte NO cuenta (usuario 2026-09-27: el parte no influye en RRHH).
            if (laborable) {
                const ausentes = new Set();
                (await db.collection('rrhhAsistencia').where('fecha', '==', D).get()).docs.forEach((d) => {
                    const x = d.data(); if (x.estado !== 'ausente') return;
                    const e = emps.get(x.empleadoId); if (!e || !e.email || !eq.has(e.email)) return;
                    if (!((horasPor.get(e.email) || {}).horas > 0)) ausentes.add(e.email);
                });
                if (ausentes.size) {
                    const permisos = (await db.collection('rrhhPermisos').where('estado', '==', 'aprobado').get()).docs.map((d) => d.data()).filter((p) => p.fechaInicio <= D && D <= p.fechaFin);
                    for (const em of ausentes) {
                        const idsEmp = [...emps].filter(([, v]) => v.email === em).map(([k]) => k);
                        if (permisos.some((p) => idsEmp.includes(p.empleadoId))) continue;
                        await evento({ email: em, nombre: nombreDe(em), tipo: 'falta', ref: D, puntos: R.faltaSinPermiso, fechaEvento: D, detalle: `Falta del ${fmtF(D)} sin permiso registrado en RRHH.` });
                        res.faltas++;
                    }
                }
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
                // Asignados + quien tenga horas en el parte de esa obra desde el día agendado (máx. 14 días atrás) hasta hoy.
                const ini = fechaRD(j.fecha) || D, piso = addDias(D, -14);
                const enParte = await personasEnObra(j, [ini < D ? ini : D, piso].sort()[1], D, eq, emps);
                const gente = new Map(); asignadosDe(j).forEach((em) => gente.set(em, nombreDe(em))); enParte.forEach((n, em) => gente.set(em, n));
                for (const [em, n] of gente) { await evento({ email: em, nombre: n, tipo: 'trabajo', ref: j.id, puntos: pts, detalle: det + (enParte.has(em) && !asignadosDe(j).includes(em) ? ' Contado por tus horas en el parte.' : ''), fechaEvento: D }); res.trabajos++; }
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
            // Código corto (usuario 2026-09-27: el enlace era larguísimo): 8 caracteres sin letras/números que se confundan
            // (sin 0/O/1/I/L). Enlace corto artaldominicana.com/e/CODIGO → redirige a ops/satisfaccion.html?t=CODIGO
            // (página de redirección en el repo del sitio, artal-web: 404.html + e/index.html).
            const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
            const token = [...crypto.randomBytes(8)].map((b) => ABC[b % ABC.length]).join('');
            const asignados = (Array.isArray(after.asignados) && after.asignados.length ? after.asignados : (after.instaladorEmail ? [{ email: after.instaladorEmail, nombre: after.instaladorNombre || '' }] : []))
                .filter((a) => a && a.email).map((a) => ({ email: String(a.email).toLowerCase(), nombre: a.nombre || '' }));
            const url = URL_CORTA_ENCUESTA + token;
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
        // Guarda por FECHA de aplicación, no por el valor de puntos: con 3★ (0 puntos) `puntosAplicados` era 0 → falsy →
        // el trigger se repetía sin fin (mensaje + push a admins cada vez). Auditoría 2026-09-28, crítico 1.
        if (!after || after.estado !== 'respondida' || !after.respuesta || after.puntosFecha || after.puntosAplicados != null) return;
        try {
            const cfg = await cargarConfig(); const R = cfg.reglas;
            const r = after.respuesta; const g = Math.max(1, Math.min(5, Math.round(Number(r.general) || 0)));
            const pts = Number(R['encuesta' + g]) || 0;
            const lugar = [after.cliente, after.obra].filter(Boolean).join(' — ');
            const estrellas = '★'.repeat(g) + '☆'.repeat(5 - g);
            const D = hoySantoDomingo().fecha;
            // Participantes = asignados + quien tenga horas en el parte de esa obra alrededor del día del trabajo
            // (desde el día agendado, o el anterior al trabajo, hasta 2 días después; nunca más allá de hoy).
            const participantes = new Map();
            (after.asignados || []).forEach((a) => { if (a && a.email) participantes.set(String(a.email).toLowerCase(), a.nombre || ''); });
            try {
                const eq = await equipo(); const emps = await empleadosPorId();
                const instS = after.instalacionId ? await db.doc('instalaciones/' + after.instalacionId).get() : null;
                const inst = instS && instS.exists ? instS.data() : { cliente: after.cliente, obra: after.obra };
                const fT = after.fechaTrabajo || D, ini = fechaRD(inst.fecha) || fT;
                const desde = addDias(ini < fT ? ini : fT, -1), hasta = [addDias(fT, 2), D].sort()[0];
                (await personasEnObra({ cliente: inst.cliente || after.cliente, obra: inst.obra || after.obra }, desde < addDias(fT, -14) ? addDias(fT, -14) : desde, hasta, eq, emps)).forEach((n, em) => { if (!participantes.has(em)) participantes.set(em, n); });
            } catch (e) { console.error('encuestaRespondida participantes', e); }
            for (const [em, n] of participantes) {
                await evento({ email: em, nombre: n, tipo: 'encuesta', ref: after.instalacionId || event.params.token, puntos: pts, origen: 'cliente', fechaEvento: D,
                    detalle: `El cliente calificó ${lugar} con ${estrellas} (${g}/5)${r.comentario ? ': «' + String(r.comentario).slice(0, 160) + '»' : ''}.` });
            }
            const listaEquipo = [...participantes].map(([em, n]) => n || em);
            await db.doc('encuestas/' + event.params.token).update({ puntosAplicados: pts, puntosFecha: FieldValue.serverTimestamp(), participantes: [...participantes].map(([email, nombre]) => ({ email, nombre })) });
            if (after.instalacionId) { try { await db.doc('instalaciones/' + after.instalacionId).update({ encuestaEstado: 'respondida', encuestaGeneral: g, encuestaFecha: D }); } catch (_) { } }
            // Aviso a gerencia por Mensajería + push.
            const admins = (await db.collection('usuarios').get()).docs.filter((d) => { const x = d.data().rol; return (Array.isArray(x) ? x : [x]).includes('admin') && d.data().activo !== false; }).map((d) => d.id);
            const sub = (k, t) => (r[k] ? `${t}: ${'★'.repeat(Math.round(Number(r[k]) || 0))} (${r[k]}/5)` : null);
            const cuerpo = [
                `⭐ ${lugar}`, `Calificación general: ${estrellas} (${g}/5)`,
                sub('puntualidad', 'Puntualidad'), sub('limpieza', 'Limpieza y orden'), sub('trato', 'Trato del equipo'),
                r.recomendaria != null ? `¿Nos recomendaría? ${r.recomendaria ? 'Sí' : 'No'}` : null,
                r.comentario ? `Comentario: «${r.comentario}»` : null,
                '', `Equipo: ${listaEquipo.join(', ') || '—'} → ${pts >= 0 ? '+' : ''}${pts} puntos cada uno.`
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

    // ---- valoración del encargado al completar (usuario 2026-09-27) ------------------------------
    // instalacion.html escribe `valoracionesEquipo/{instId}_{empleadoId}` = { instalacionId, cliente, obra, empleadoId, email,
    // nombre, nivel:'bien'|'ok'|'flojo', motivo, por, porNombre, fecha }. Solo gerencia y el autor leen esa colección; el
    // encargado no puede escribir en `puntos`, así que se aplica aquí. Id determinista por persona + trabajo → cambiar la
    // valoración reemplaza el evento. Nadie se valora a sí mismo. El detalle NO nombra al encargado. Un 👌 normal solo se
    // escribe (con 0) si antes había otra valoración.
    const valoracionEquipoAplicar = onDocumentWritten('valoracionesEquipo/{id}', async (event) => {
        const v = event.data.after.exists ? event.data.after.data() : null; if (!v) return;
        const b = event.data.before.exists ? event.data.before.data() : null;
        if (b && b.nivel === v.nivel && (b.motivo || '') === (v.motivo || '')) return;
        try {
            const cfg = await cargarConfig(); const R = cfg.reglas; const eq = await equipo();
            const em = String(v.email || '').toLowerCase(); if (!em || !eq.has(em)) return;
            if (em === String(v.por || '').toLowerCase()) return;
            const fe = String(v.fecha || hoySantoDomingo().fecha); if (fe < cfg.desde) return;
            const lugar = [v.cliente, v.obra].filter(Boolean).join(' — ') || 'un trabajo';
            const nivel = String(v.nivel || 'ok'); const motivo = String(v.motivo || '').slice(0, 200);
            const pts = nivel === 'bien' ? (Number(R.valoracionBien) || 0) : nivel === 'flojo' ? (Number(R.valoracionFlojo) || 0) : 0;
            const det = nivel === 'bien' ? `El encargado del trabajo valoró tu trabajo en ${lugar}: 👍 bien${motivo ? ' («' + motivo + '»)' : ''}.`
                : nivel === 'flojo' ? `El encargado del trabajo valoró tu trabajo en ${lugar}: ⚠️ flojo («${motivo || 'sin motivo'}»).`
                : `El encargado del trabajo valoró tu trabajo en ${lugar}: 👌 normal.`;
            await evento({ email: em, nombre: v.nombre || (eq.get(em) || {}).nombre, tipo: 'valoracion', ref: `${v.instalacionId || event.params.id}_${String(v.empleadoId || '')}`, puntos: pts, fechaEvento: fe, origen: 'encargado', detalle: det, omitirCero: !b });
        } catch (e) { console.error('valoracionEquipoAplicar', event.params.id, e); }
    });

    // Valoración inversa: compañero → encargado. Doc `valoracionesEncargado/{instId}_{emailKeyAutor}` = { instalacionId,
    // cliente, obra, nivel, comentario, para, paraNombre, por, porNombre, fecha }. Un evento por autor y trabajo (ref = id
    // del doc con el autor reemplazado por un hash, para que ni el id delate quién fue); el detalle no dice quién; el
    // comentario NO viaja al ledger (los eventos de `puntos` los puede leer cualquier usuario con sesión).
    const valoracionEncargadoAplicar = onDocumentWritten('valoracionesEncargado/{id}', async (event) => {
        const v = event.data.after.exists ? event.data.after.data() : null; if (!v) return;
        const b = event.data.before.exists ? event.data.before.data() : null;
        if (b && b.nivel === v.nivel) return;
        try {
            const cfg = await cargarConfig(); const R = cfg.reglas; const eq = await equipo();
            const em = String(v.para || '').toLowerCase(); if (!em || !eq.has(em)) return;
            if (em === String(v.por || '').toLowerCase()) return;
            const fe = String(v.fecha || hoySantoDomingo().fecha); if (fe < cfg.desde) return;
            const lugar = [v.cliente, v.obra].filter(Boolean).join(' — ') || 'un trabajo';
            const nivel = String(v.nivel || 'ok');
            const pts = nivel === 'bien' ? (Number(R.valoracionEncBien) || 0) : nivel === 'flojo' ? (Number(R.valoracionEncFlojo) || 0) : 0;
            const det = nivel === 'bien' ? `Un compañero valoró cómo lo trataste en ${lugar} (explicaciones, trato, actitud): 👍 bien.`
                : nivel === 'flojo' ? `Un compañero valoró cómo lo trataste en ${lugar} (explicaciones, trato, actitud): ⚠️ flojo. Gerencia tiene el comentario.`
                : `Un compañero valoró cómo lo trataste en ${lugar}: 👌 normal.`;
            const refAnon = `${v.instalacionId || event.params.id.split('_')[0]}_${crypto.createHash('sha256').update('artal-val-' + String(v.por || '').toLowerCase()).digest('hex').slice(0, 10)}`;
            await evento({ email: em, nombre: v.paraNombre || (eq.get(em) || {}).nombre, tipo: 'valoracion_enc', ref: refAnon, puntos: pts, fechaEvento: fe, origen: 'equipo', detalle: det, omitirCero: !b });
        } catch (e) { console.error('valoracionEncargadoAplicar', event.params.id, e); }
    });

    return { puntosEvaluarDiario, puntosEvaluarAhora, encuestaAlCompletar, encuestaRespondida, valoracionEquipoAplicar, valoracionEncargadoAplicar };
};
