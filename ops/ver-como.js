// «👁 Ver como…» (2026-11-03): abre en una pestaña nueva la pantalla de una persona del equipo tal como la ve ella (cuenta espejo,
// solo lectura). Lo usan el Panel y Usuarios y roles. La función espejoCrear (acción 'acceso') devuelve la clave del espejo (la
// guarda en `espejosClaves`, que nadie lee desde el navegador) y la crea si hace falta. La pestaña nueva entra sola (firebase-config.js).
import { auth } from './firebase-config.js';
const FN = 'https://us-central1-artal-operaciones.cloudfunctions.net/espejoCrear';

// Pantalla de inicio según el rol de la persona real.
export function paginaInicio(roles = [], paginasExtra = []) {
    const r = Array.isArray(roles) ? roles : [roles];
    if (r.some(x => ['instalador', 'ayudante', 'chofer'].includes(x))) return 'instalacion.html';
    if (r.some(x => ['fabrica', 'contratista'].includes(x))) return 'alucufel/index.html';
    if ((paginasExtra || []).includes('index.html')) return 'index.html';
    if (r.some(x => ['cotizaciones', 'contable', 'comunicaciones', 'capacitador'].includes(x))) return 'erp.html';
    return 'index.html';
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
