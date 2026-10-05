// Bloqueo por parte diario pendiente (encargados de instalación). Lo usa auth-common.js en cada
// pantalla: si el usuario es encargado (rrhhConfig/parteDiario.encargados) y tiene partes sin enviar,
// solo puede usar ops/parte-diario.html hasta ponerse al día. Admin nunca se bloquea.
// Regla: cuentan los días laborables (lunes a sábado, sin feriados de rrhhFeriados) de los últimos
// 7 días; el día de HOY cuenta como pendiente desde las 6:00 pm.
import { db } from './firebase-config.js';
import { doc, getDoc, collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const claveEmail = (em) => String(em || '').trim().toLowerCase().replace(/[.@]/g, '_');

// Devuelve la lista de fechas 'YYYY-MM-DD' pendientes (vacía si no es encargado o está al día).
export async function partesPendientes(email, dias = 7) {
    const cfg = await getDoc(doc(db, 'rrhhConfig', 'parteDiario')).catch(() => null);
    const encargados = cfg && cfg.exists() && Array.isArray(cfg.data().encargados) ? cfg.data().encargados : [];
    const yo = encargados.find((e) => e && String(e.email).toLowerCase() === String(email).toLowerCase());
    if (!yo) return [];
    // Bloqueo activo solo a partir de rrhhConfig/parteDiario.bloqueoDesde (arranque suave del módulo).
    const bloqueoDesde = cfg.data().bloqueoDesde ? Date.parse(cfg.data().bloqueoDesde) : 0;
    if (bloqueoDesde && Date.now() < bloqueoDesde) return [];
    const desde = yo.desde || '0000-00-00';
    const hoy = new Date(); const candidatas = [];
    for (let k = 0; k < dias; k++) {
        const d = new Date(hoy); d.setDate(d.getDate() - k);
        if (d.getDay() === 0) continue;
        if (k === 0 && hoy.getHours() < 18) continue;
        candidatas.push(ymd(d));
    }
    if (!candidatas.length) return [];
    // Rendimiento (usuario 2026-10-05, «en el teléfono la plataforma tiene dificultad en cargar»): antes esto hacía una lectura
    // + una consulta POR DÍA, en serie (≈12 viajes al servidor, 4 s con buena conexión, 10–20 s con datos móviles, y la pantalla
    // se quedaba en «Entrando…»). Ahora son TRES consultas en paralelo: feriados, feriados trabajados y TODOS los partes de esos
    // días (los míos y los de los demás encargados) con un solo `where fecha in`, y el resto se resuelve en memoria.
    const dias10 = candidatas.slice(0, 10);
    const [fs, ft, ps] = await Promise.all([
        getDocs(query(collection(db, 'rrhhFeriados'), where('fecha', 'in', dias10))).catch(() => null),
        getDocs(query(collection(db, 'rrhhFeriadosTrabajados'), where('fecha', 'in', dias10))).catch(() => null),
        getDocs(query(collection(db, 'partesDiarios'), where('fecha', 'in', dias10))).catch(() => null)
    ]);
    const feriados = new Set(fs ? fs.docs.map((x) => x.data().fecha) : []);
    // Un feriado que gerencia avisó por comunicado que SE TRABAJA (rrhhFeriadosTrabajados/{fecha}) cuenta como día normal.
    if (ft) ft.docs.forEach((x) => feriados.delete(x.data().fecha));
    // Si la consulta de partes falla (sin red, permiso denegado…) NO se bloquea a nadie: mejor dejar pasar que encerrar por un error.
    if (!ps) { console.warn('parte-gate: no se pudieron leer los partes; no se bloquea'); return []; }
    const partes = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
    const em = String(email).toLowerCase(); const miId = (f) => f + '_' + claveEmail(email);
    const pend = [];
    for (const f of candidatas) {
        if (feriados.has(f) || f < desde) continue;
        const mio = partes.find((p) => p.id === miId(f));
        if (mio && !mio.borrador) continue;   // un borrador (horas cargadas al validar un trabajo) NO es parte enviado
        // Si otro encargado ya lo incluyó ese día (trabajaron juntos), no le toca enviar parte.
        const otro = partes.some((p) => p.fecha === f && !p.borrador && String(p.encargadoEmail || '').toLowerCase() !== em && Array.isArray(p.incluidosEmails) && p.incluidosEmails.includes(em));
        if (!otro) pend.push(f);
    }
    return pend;
}
