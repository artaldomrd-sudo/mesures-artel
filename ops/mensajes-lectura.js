// Lectura de Mensajería ARTAL con las reglas por destinatario (F1, revisión 2026-10-09).
// Antes cada pantalla bajaba TODOS los mensajes (volantes de nómina con sueldos, informes de costo…) y filtraba en el
// cliente. Ahora firestore.rules solo deja leer lo que es para uno (paraTodos, destinatario o remitente; admin y
// comunicaciones lo leen todo), así que la consulta tiene que ir acotada igual: dos/tres suscripciones que se unen aquí.
//   suscribirMensajes(db, { email, roles }, (mensajes) => {...}, { todo: true|false })
//   - email: el correo de la persona (requireAuth ya devuelve el real aunque entre un espejo).
//   - todo: true = admin/comunicaciones ven todos los enviados (Mensajería); false/omitido = solo lo mío (badges, equipo).
// Devuelve una función para cancelar las suscripciones.
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export function suscribirMensajes(db, usuario, cb, opts) {
    const email = String((usuario && usuario.email) || '').trim().toLowerCase();
    const roles = Array.isArray(usuario && usuario.roles) ? usuario.roles : (usuario && usuario.rol ? [].concat(usuario.rol) : []);
    const todo = !!(opts && opts.todo) && roles.some((r) => r === 'admin' || r === 'comunicaciones');
    const base = collection(db, 'mensajes');
    const partes = {}; const subs = [];
    const emitir = () => { const m = new Map(); Object.values(partes).forEach((docs) => docs.forEach((d) => m.set(d.id, d))); cb([...m.values()]); };
    const sub = (k, q) => subs.push(onSnapshot(q, (s) => { partes[k] = s.docs.map((d) => ({ id: d.id, ...d.data() })); emitir(); }, (e) => { partes[k] = []; emitir(); if (opts && opts.onError) opts.onError(e); }));
    if (todo) sub('todo', query(base, where('estado', '==', 'enviado')));
    else {
        sub('todos', query(base, where('estado', '==', 'enviado'), where('paraTodos', '==', true)));
        if (email) sub('mios', query(base, where('estado', '==', 'enviado'), where('destinatarios', 'array-contains', email)));
        if (email && opts && opts.enviados) sub('enviados', query(base, where('estado', '==', 'enviado'), where('remitenteEmail', '==', email)));
    }
    return () => subs.forEach((u) => { try { u(); } catch (_) { } });
}
// ¿Este mensaje es para esta persona? (misma regla que las reglas de Firestore, por si llega algo de más)
export const esParaMi = (m, email) => {
    const e = String(email || '').trim().toLowerCase();
    return m.paraTodos === true || (Array.isArray(m.destinatarios) && m.destinatarios.some((d) => String(d || '').trim().toLowerCase() === e));
};
