// PARTES DE UN PEDIDO — una sola regla para fábrica, Transportes, Instalación y el Panel (Dylan 2026-11-24, caso Shirley:
// fábrica interna no marcaba partes, el chofer recibió solo accesorios y el pedido quedó «entregado» completo).
//
//   «Un pedido está entregado cuando TODAS las partes de TODOS sus ítems han llegado a la obra.»
//
// Datos en `orders`:
//   partesFabrica.{iid}.{k}  = true   → lo que FÁBRICA marcó listo (interna o ALUCUFEL; mismo campo que la hoja ?checklist=fabrica).
//   itemsListosFabrica.{iid} = bool   → derivado: todas las partes del ítem marcadas (lo leen parcialmente_listo, badges, etc.).
//   recibidoPartes.{iid}     = [k…]   → lo que ya LLEGÓ a la obra (acumulado entrega tras entrega). Es la verdad.
//   entregaPartes            = igual que recibidoPartes (compat con el push «resto por recoger» del servidor y entregas viejas).
//   entregaCompleta          = bool   → todas las partes recibidas. `entregado: true` sigue significando «hubo al menos una entrega».
//   entregaFaltan            = texto  → «vidrios de B1 y B2» (lo que aún no ha llegado), para Instalación / Historial / Panel.
// Lo que fábrica marcó y el chofer NO recibió va a itemStatus.{iid} (estado 'problema', faltantes[]) → alerta roja en el Panel y
// push a fábrica (functions/index.js, enviarNotificacionPedido 3).
// El servidor espeja PARTES_SETS y restoPorRecoger en functions/index.js (restoPendienteSrv): si cambia una regla, cambiar la otra.

export const PARTES_SETS = {
    corredera: [{ k: 'marco', l: 'Marco' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }],
    galandaje: [{ k: 'marco', l: 'Marco' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }],
    plegable: [{ k: 'marco', l: 'Marco/Riel' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Bisagras/Carros/Cierres' }],
    ventana: [{ k: 'marco', l: 'Marco' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }],
    puerta_vidrio: [{ k: 'marco', l: 'Marco' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }],
    fachada: [{ k: 'marco', l: 'Marco' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }],
    fachada_grid: [{ k: 'marco', l: 'Marco' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }],
    mampara: [{ k: 'vidrios', l: 'Vidrios' }, { k: 'herrajes', l: 'Herrajes' }, { k: 'accesorios', l: 'Accesorios' }],
    ducha: [{ k: 'perfiles', l: 'Perfiles' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'herrajes', l: 'Herrajes' }, { k: 'accesorios', l: 'Accesorios' }],
    cerramiento: [{ k: 'vidrios', l: 'Vidrios' }, { k: 'herrajes', l: 'Herrajes' }, { k: 'accesorios', l: 'Accesorios' }],
    baranda: [{ k: 'estructura', l: 'Estructura/Postes' }, { k: 'vidrios', l: 'Vidrios/Tableros' }, { k: 'accesorios', l: 'Accesorios' }],
    cortina: [{ k: 'tela', l: 'Tela/Lamas' }, { k: 'mecanismo', l: 'Mecanismo' }, { k: 'accesorios', l: 'Accesorios' }],
    mosquitera: [{ k: 'marco', l: 'Marco/Perfil' }, { k: 'tela', l: 'Tela' }, { k: 'accesorios', l: 'Accesorios' }],
    lamas: [{ k: 'marco', l: 'Marco' }, { k: 'vidrios', l: 'Lamas de vidrio' }, { k: 'accesorios', l: 'Operadores/clips' }, { k: 'tela', l: 'Mosquitera (si lleva)' }],
};
export const PARTES_DEFAULT = [{ k: 'marco', l: 'Marco' }, { k: 'hojas', l: 'Hojas' }, { k: 'vidrios', l: 'Vidrios' }, { k: 'accesorios', l: 'Accesorios' }];
export const PARTE_TXT = { marco: 'marco', hojas: 'hojas', vidrios: 'vidrios', accesorios: 'accesorios', herrajes: 'herrajes', perfiles: 'perfiles', estructura: 'estructura', tela: 'tela', mecanismo: 'mecanismo', todo: 'completo' };

// Categoría a partir del `type` del cuaderno (espejo reducido de getCategoriaByType de index.html).
export function categoriaDeTipo(t) {
    t = String(t || '');
    if (!t) return '';
    if (t === 'fachada_grid') return 'fachada_grid';
    if (t === 'pleg') return 'plegable';
    if (t === 'mosq') return 'mosquitera';
    if (t === 'win_lamas') return 'lamas';
    if (t.startsWith('cort_')) return 'cortina';
    if (t.startsWith('cor')) return 'corredera';
    if (t.startsWith('gal')) return 'galandaje';
    if (t.startsWith('win_') || t === 'door_abat') return 'ventana';
    if (t === 'door_glass' || t === 'door_slide' || t === 'door_slide_conn' || t === 'door_flot') return 'puerta_vidrio';
    if (t === 'mamp_fija') return 'mampara';
    if (t === 'ducha_cab') return 'ducha';
    if (t === 'ducha_facade') return 'cerramiento';
    if (t === 'baranda_bal') return 'baranda';
    if (t === 'fachada_din' || t === 'draw') return 'fachada';
    return '';
}
// Categoría por el texto del ítem («Baranda de Vidrio», «Corredera 2 Hojas»…) cuando no hay appJSON.
function categoriaDeTexto(s) {
    s = String(s || '').toLowerCase();
    if (/baranda/.test(s)) return 'baranda';
    if (/corredera/.test(s)) return 'corredera';
    if (/galandaje/.test(s)) return 'galandaje';
    if (/plegable/.test(s)) return 'plegable';
    if (/mosquitera/.test(s)) return 'mosquitera';
    if (/lamas/.test(s)) return 'lamas';
    if (/cortina|shutter|persiana|enrollable/.test(s)) return 'cortina';
    if (/ducha/.test(s)) return 'cerramiento';
    if (/mampara/.test(s)) return 'mampara';
    if (/puerta flotante|puerta de vidrio/.test(s)) return 'puerta_vidrio';
    if (/fachada|paño fijo|pano fijo/.test(s)) return 'fachada';
    if (/ventana|puerta/.test(s)) return 'ventana';
    return '';
}
const itemDe = (o, iid) => (Array.isArray(o && o.items) ? o.items : []).find(x => String(x.id) === String(iid)) || {};
const estadoDe = (o, iid) => (((o || {}).appJSON || {}).cardsState || {})[iid] || {};

// Las partes que componen un ítem: [{k, l}].
export function partesDeItem(o, iid) {
    const st = estadoDe(o, iid);
    const cat = categoriaDeTipo(st.type) || categoriaDeTexto(itemDe(o, iid).tipo);
    return PARTES_SETS[cat] || PARTES_DEFAULT;
}
export const labelParte = (o, iid, k) => { const p = partesDeItem(o, iid).find(x => x.k === k); return p ? p.l : (PARTE_TXT[k] || k); };
// Referencia visible del ítem: «B1 · Baranda de Vidrio» (ref del cuaderno + tipo).
export function refItem(o, iid) {
    const it = itemDe(o, iid);
    const ref = ((((o || {}).appJSON || {}).inputsData || {})[iid] || {}).ref || '';
    return [ref, it.tipo || ('Ítem ' + iid)].filter(Boolean).join(' · ');
}
export const itemsDe = (o) => (Array.isArray(o && o.items) ? o.items : []).map(it => String(it.id));

// Lo que fábrica marcó listo de un ítem (claves). 'todo' en un pedido viejo = todas las partes del ítem.
export function listasFabrica(o, iid) {
    const pf = ((o || {}).partesFabrica || {})[iid];
    if (pf && typeof pf === 'object') { const l = Object.keys(pf).filter(k => pf[k] === true); if (l.length) return l; }
    return ((o || {}).itemsListosFabrica || {})[iid] === true ? partesDeItem(o, iid).map(p => p.k) : [];
}
// Lo que ya llegó a la obra de un ítem (claves).
export function recibidas(o, iid) {
    const r = ((o || {}).recibidoPartes || (o || {}).entregaPartes || {})[iid];
    if (!Array.isArray(r)) return [];
    return r.includes('todo') ? partesDeItem(o, iid).map(p => p.k) : r.slice();
}
// Lo que fábrica ya tiene listo y todavía no ha llegado a la obra: [{iid, ref, partes:[k]}] (solo pedidos de fábrica).
export function restoPorRecoger(o) {
    if (!o || o.docType === 'COMPRA_DIRECTA') return [];
    const out = [];
    itemsDe(o).forEach(iid => {
        const ya = recibidas(o, iid);
        const faltan = listasFabrica(o, iid).filter(k => !ya.includes(k));
        if (faltan.length) out.push({ iid, ref: refItem(o, iid), partes: faltan });
    });
    return out;
}
// Lo que fábrica aún no marcó listo (sigue en fábrica): [{iid, ref, partes:[k]}].
export function faltaEnFabrica(o) {
    if (!o || o.docType === 'COMPRA_DIRECTA') return [];
    const out = [];
    itemsDe(o).forEach(iid => {
        const listas = listasFabrica(o, iid), ya = recibidas(o, iid);
        const faltan = partesDeItem(o, iid).map(p => p.k).filter(k => !listas.includes(k) && !ya.includes(k));
        if (faltan.length) out.push({ iid, ref: refItem(o, iid), partes: faltan });
    });
    return out;
}
// Lo que aún no ha llegado a la obra (en fábrica o listo sin recoger): [{iid, ref, partes:[k]}].
export function faltaEnObra(o) {
    if (!o || o.docType === 'COMPRA_DIRECTA') return [];
    const out = [];
    itemsDe(o).forEach(iid => {
        const ya = recibidas(o, iid);
        const faltan = partesDeItem(o, iid).map(p => p.k).filter(k => !ya.includes(k));
        if (faltan.length) out.push({ iid, ref: refItem(o, iid), partes: faltan });
    });
    return out;
}
export const entregaCompleta = (o) => !!o && (o.docType === 'COMPRA_DIRECTA' ? o.entregado === true : (o.entregado === true && !faltaEnObra(o).length));
// Texto corto: «vidrios de B1 y B2 · estructura de B2».
export function partesTxt(o, lista) {
    const porParte = new Map();
    lista.forEach(r => r.partes.forEach(k => { const l = labelParte(o, r.iid, k).toLowerCase(); if (!porParte.has(l)) porParte.set(l, []); porParte.get(l).push((r.ref || '').split(' · ')[0] || ('ítem ' + r.iid)); }));
    return [...porParte.entries()].map(([l, refs]) => l + ' de ' + refs.join(' y ')).join(' · ');
}
// Estado de la entrega para pintar: {clave, txt}.
export function estadoEntrega(o) {
    if (!o || o.entregado !== true) return { clave: 'no', txt: '' };
    if (entregaCompleta(o)) return { clave: 'completa', txt: 'Entregado completo' };
    const fab = faltaEnFabrica(o), resto = restoPorRecoger(o);
    const partes = [];
    if (resto.length) partes.push('listo en fábrica sin recoger: ' + partesTxt(o, resto));
    if (fab.length) partes.push('aún en fábrica: ' + partesTxt(o, fab));
    return { clave: 'parcial', txt: 'Entregado en parte · ' + partes.join(' · ') };
}
export const todasLasPartesListas = (o) => !faltaEnFabrica(o).length && !itemsDe(o).some(iid => listasFabrica(o, iid).length < partesDeItem(o, iid).length);

// ---- Chips de partes por ítem para las tarjetas de FÁBRICA (interna y ALUCUFEL: la misma pantalla) ----
const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function partesFabricaHTML(id, o, { editable = true } = {}) {
    const items = itemsDe(o); if (!items.length) return '';
    const filas = items.map(iid => {
        const listas = listasFabrica(o, iid), ya = recibidas(o, iid), set = partesDeItem(o, iid);
        const completo = set.every(p => listas.includes(p.k) || ya.includes(p.k));
        const chips = set.map(p => {
            const enObra = ya.includes(p.k), ok = enObra || listas.includes(p.k);
            const st = enObra ? 'background:#e7f7ee;border-color:#1e8449;color:#145c39;' : ok ? 'background:#e7f7ee;border-color:#1e8449;color:#145c39;' : 'background:#fff;border-color:#cfd8e3;color:#35424f;';
            const click = editable && !enObra ? `onclick="partesToggle('${id}','${iid}','${p.k}')"` : '';
            return `<button type="button" class="pf-chip" ${click} ${enObra ? 'disabled title="Ya está en la obra"' : ''} style="${st}">${ok ? '✓' : '○'} ${escH(p.l)}${enObra ? ' · en obra' : ''}</button>`;
        }).join('');
        return `<div class="pf-item"><div class="pf-ref">${escH(refItem(o, iid))}${completo ? ' <span style="color:#1e8449;font-weight:bold;">· completo</span>' : ''}${editable && !completo ? ` <a href="#" onclick="partesTodo('${id}','${iid}'); return false;" style="font-size:12px;font-weight:bold;">todo listo</a>` : ''}</div><div class="pf-chips">${chips}</div></div>`;
    }).join('');
    const fab = faltaEnFabrica(o), resto = restoPorRecoger(o);
    const resumen = !fab.length ? '<span style="color:#1e8449;font-weight:bold;">Todo marcado listo.</span>'
        : (resto.length || itemsDe(o).some(iid => listasFabrica(o, iid).length) ? `<b>Listo para cargar:</b> ${escH(partesTxt(o, resto.length ? resto : []) || 'nada todavía')} · <span style="color:#b9770e;"><b>sigue en fábrica:</b> ${escH(partesTxt(o, fab))}</span>` : '<span style="color:#8a93a0;">Nada marcado todavía: marca lo que ya está hecho.</span>');
    return `<div class="pf-box"><div class="pf-t">Partes listas · lo que marques es lo que el chofer vendrá a recoger</div>${filas}<div class="pf-res">${resumen}</div></div>`;
}
export const PARTES_CSS = `
    .pf-box { margin-top: 10px; background: #f6f8fa; border-radius: 12px; padding: 10px 12px; }
    .pf-t { font-size: 12.5px; font-weight: bold; color: #0A3D62; margin-bottom: 6px; }
    .pf-item { padding: 6px 0; border-top: 1px solid #e6eaef; } .pf-item:first-of-type { border-top: 0; }
    .pf-ref { font-size: 13.5px; font-weight: bold; color: #1b2733; margin-bottom: 5px; }
    .pf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-chip { border: 2px solid; border-radius: 10px; padding: 7px 10px; font-size: 13px; font-weight: bold; font-family: 'Arimo', Arial, sans-serif; cursor: pointer; min-height: 36px; }
    .pf-chip:disabled { cursor: default; opacity: .85; }
    .pf-res { font-size: 12.5px; color: #35424f; margin-top: 8px; line-height: 1.45; }`;

// Escrituras de fábrica (interna y ALUCUFEL): una parte, o todo el ítem. Mantienen itemsListosFabrica derivado.
export function cambiosParte(o, iid, k, valor) {
    const set = partesDeItem(o, iid);
    const listas = new Set(listasFabrica(o, iid));
    if (valor) listas.add(k); else listas.delete(k);
    const cambios = {};
    set.forEach(p => { cambios[`partesFabrica.${iid}.${p.k}`] = listas.has(p.k); });
    cambios[`itemsListosFabrica.${iid}`] = set.every(p => listas.has(p.k));
    return cambios;
}
export function cambiosItemTodo(o, iid) {
    const cambios = {};
    partesDeItem(o, iid).forEach(p => { cambios[`partesFabrica.${iid}.${p.k}`] = true; });
    cambios[`itemsListosFabrica.${iid}`] = true;
    return cambios;
}
// Estado del pedido según lo marcado (lo usa «Listo para cargar» en las dos fábricas): si no hay nada marcado se marca todo.
export function cambiosListoParaCargar(o) {
    const cambios = {};
    const nadaMarcado = !itemsDe(o).some(iid => listasFabrica(o, iid).length);
    if (nadaMarcado) itemsDe(o).forEach(iid => Object.assign(cambios, cambiosItemTodo(o, iid)));
    const simulado = nadaMarcado ? { ...o, partesFabrica: Object.fromEntries(itemsDe(o).map(iid => [iid, Object.fromEntries(partesDeItem(o, iid).map(p => [p.k, true]))])), itemsListosFabrica: Object.fromEntries(itemsDe(o).map(iid => [iid, true])) } : o;
    const completo = todasLasPartesListas(simulado);
    cambios.status = completo ? 'listo_para_cargar' : 'parcialmente_listo';
    return { cambios, completo, nadaMarcado };
}
