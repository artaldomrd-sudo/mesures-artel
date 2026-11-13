// «👁 Ver como…» (2026-11-03): abre en una pestaña nueva la pantalla de una persona del equipo tal como la ve ella (cuenta espejo,
// solo lectura). Lo usan el Panel y Usuarios y roles. La función espejoCrear (acción 'acceso') devuelve la clave del espejo (la
// guarda en `espejosClaves`, que nadie lee desde el navegador) y la crea si hace falta. La pestaña nueva entra sola (firebase-config.js).
import { auth } from './firebase-config.js';
import { homePorRol } from './auth-common.js';
const FN = 'https://us-central1-artal-operaciones.cloudfunctions.net/espejoCrear';

// Pantalla de inicio según el rol de la persona real: la MISMA regla que usa requireAuth/«Volver» (`homePorRol`), para que
// la vista espejo abra donde aterriza la persona (auditoría 2026-11-12: antes tenía su propia regla y divergían). Si por
// permiso de página puede ver el Panel, se abre el Panel.
export function paginaInicio(roles = [], paginasExtra = []) {
    const r = Array.isArray(roles) ? roles : [roles];
    if ((paginasExtra || []).includes('index.html')) return 'index.html';
    return homePorRol(r.filter(Boolean));
}
export async function verComo(emailReal, { roles = [], paginasExtra = [], pagina = null } = {}) {
    const w = window.open('about:blank', '_blank');   // se abre en el mismo toque para que el navegador no la bloquee
    if (w) w.document.write('<p style="font:15px Arial;padding:30px;color:#333">Abriendo la vista…</p>');
    try {
        const token = await auth.currentUser.getIdToken();
        const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ email: emailReal, accion: 'acceso' }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.password) throw new Error(j.error || ('HTTP ' + r.status));
        const n = Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('artal_vercomo_' + n, JSON.stringify({ email: j.espejo, password: j.password, t: Date.now() }));
        const destino = new URL((pagina || paginaInicio(roles, paginasExtra)) + '?vercomo=' + n, location.href.replace(/[^/]*$/, ''));
        if (w) w.location.href = destino.href; else location.href = destino.href;
    } catch (e) {
        if (w) w.close();
        alert('No se pudo abrir la vista: ' + (e.message || e));
    }
}
