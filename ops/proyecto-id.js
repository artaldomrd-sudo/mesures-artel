// Nº de proyecto PRY-AAAA-NNN visible en el sistema interno (Dylan 2026-11-03): los proveedores nunca ven el cliente, sus
// pedidos llevan solo el número; dentro de ARTAL se ven cliente y obra como siempre, con el número AL LADO para poder hacer
// siempre la relación nombre ↔ ID. Lo asigna el cuaderno (index.html, `appJSON.header.idProveedor`) al guardar o enviar, y
// cada pedido lo copia en `orders.idProyecto`. Regla única de lectura: orders.idProyecto → appJSON.header.idProveedor → nada
// («sin Nº», nunca se inventa). Un trabajo de Instalación, una compra directa, un informe o una fila de Costo de obras no
// tienen número propio: lo toman del pedido enlazado o, si no hay enlace, de los pedidos de la misma obra (`mismaObra`).
import { mismaObra } from './obras-util.js';

export const PRY_RE = /^PRY-\d{4}-\d{3,}$/i;
const limpio = (v) => String(v || '').trim().toUpperCase();

// Número de un pedido (orders) o de un proyecto guardado ({ jsonData }).
export function idProyectoDe(o) {
    if (!o) return '';
    const a = limpio(o.idProyecto);
    if (a) return a;
    const h = (o.appJSON && o.appJSON.header) || (o.jsonData && o.jsonData.header) || {};
    return limpio(h.idProveedor);
}

// Números de una obra según una lista de pedidos [{ data } | order]: primero el enlace directo (ids), si no, misma obra.
// Devuelve una lista sin repetir (normalmente 0 o 1).
export function idsProyectoObra(orders, { cliente = '', obra = '', ids = [] } = {}) {
    const lista = (orders || []).map((x) => (x && x.data && typeof x.data === 'object' && !x.cliente ? { _id: x.id, ...x.data } : x)).filter(Boolean);
    const out = [];
    const add = (v) => { if (v && !out.includes(v)) out.push(v); };
    const idSet = new Set((ids || []).filter(Boolean).map(String));
    if (idSet.size) lista.forEach((o) => { if (idSet.has(String(o._id || o.id))) add(idProyectoDe(o)); });
    if (!out.length && (cliente || obra)) lista.forEach((o) => { if (o.docType !== 'COMPRA_DIRECTA' && mismaObra(cliente, obra, o.cliente, o.obra)) add(idProyectoDe(o)); });
    return out;
}

const escP = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Chip visual. `id` puede ser string o lista. Sin número: «sin Nº» en gris (opts.ocultarSin = no pintar nada).
export function pryChipHTML(id, opts = {}) {
    const ids = (Array.isArray(id) ? id : [id]).map(limpio).filter(Boolean);
    const base = 'display:inline-block;vertical-align:middle;margin-left:6px;padding:1px 7px;border-radius:6px;font-size:11.5px;font-weight:700;letter-spacing:.3px;white-space:nowrap;font-family:ui-monospace,Menlo,Consolas,monospace;';
    if (!ids.length) return opts.ocultarSin ? '' : `<span class="pry-chip pry-sin" title="Este pedido no tiene Nº de proyecto (pedido anterior al 3/11/2026 o sin enviar desde el cuaderno)" style="${base}background:#f3f4f6;color:#8a929b;border:1px dashed #c4cad1;font-weight:600;">sin Nº</span>`;
    return ids.map((v) => `<span class="pry-chip" title="Nº de proyecto: es lo que ve el proveedor en lugar del cliente" style="${base}background:#eaf2fb;color:#0A3D62;border:1px solid #b9cfe6;">${escP(v)}</span>`).join('');
}
export const pryChipDe = (o, opts) => pryChipHTML(idProyectoDe(o), opts);
// Texto plano para buscadores y CSV.
export const pryTxt = (o) => idProyectoDe(o);
