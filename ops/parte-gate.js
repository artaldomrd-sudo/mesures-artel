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
    if (!encargados.some((e) => e && String(e.email).toLowerCase() === String(email).toLowerCase())) return [];
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
    const pend = [];
    for (const f of candidatas) {
        if (feriados.has(f)) continue;
        const p = await getDoc(doc(db, 'partesDiarios', f + '_' + claveEmail(email))).catch(() => null);
        if (!p || !p.exists()) pend.push(f);
    }
    return pend;
}
