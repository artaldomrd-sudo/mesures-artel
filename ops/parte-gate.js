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
    let feriados = new Set();
    try { const fs = await getDocs(query(collection(db, 'rrhhFeriados'), where('fecha', 'in', candidatas.slice(0, 10)))); feriados = new Set(fs.docs.map((x) => x.data().fecha)); } catch (_) { }
    // Un feriado que gerencia avisó por comunicado que SE TRABAJA (rrhhFeriadosTrabajados/{fecha}) cuenta como día normal.
    try { const ft = await getDocs(query(collection(db, 'rrhhFeriadosTrabajados'), where('fecha', 'in', candidatas.slice(0, 10)))); ft.docs.forEach((x) => feriados.delete(x.data().fecha)); } catch (_) { }
    const pend = [];
    const em = String(email).toLowerCase();
    for (const f of candidatas) {
        if (feriados.has(f) || f < desde) continue;
        const p = await getDoc(doc(db, 'partesDiarios', f + '_' + claveEmail(email))).catch(() => null);
        if (p && p.exists()) continue;
        // Si otro encargado ya lo incluyó ese día (trabajaron juntos), no le toca enviar parte.
        let otro = false;
        try { const qs = await getDocs(query(collection(db, 'partesDiarios'), where('fecha', '==', f))); otro = qs.docs.some((d) => { const x = d.data(); return String(x.encargadoEmail || '').toLowerCase() !== em && Array.isArray(x.incluidosEmails) && x.incluidosEmails.includes(em); }); } catch (_) { }
        if (!otro) pend.push(f);
    }
    return pend;
}
