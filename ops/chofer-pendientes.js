// Qué tiene que buscar el chofer (2026-11-03, Dylan: «no podemos permitir que siga sucediendo; todo más sencillo de entender y ver»).
// Lo comparten Transportes (chofer.html) e Instalación (banda arriba para quien tiene rol chofer). La misma regla vive en
// functions/index.js (push «Resto listo para recoger»): si cambia una, cambiar la otra.
//
// «RESTO POR RECOGER»: un pedido de fábrica que se entregó en parte (marcos primero, hojas/vidrios después) quedaba para siempre en
// la pestaña Entregado aunque ALUCUFEL marcara después el resto listo (caso Villa Cocoloba, 2026-11-03). Ahora cada entrega guarda
// qué piezas se llevó (`entregaPartes` = { itemId: ['marco', 'hojas', …] }, 'todo' = el ítem completo) y el pedido vuelve a
// «En espera» cuando fábrica marca piezas que no estaban en esa foto. `restoEnRuta` = el chofer ya salió a buscar el resto.

export const PARTE_TXT = { marco: 'marco', hojas: 'hojas', vidrios: 'vidrios', accesorios: 'accesorios', herrajes: 'herrajes', perfiles: 'perfiles', estructura: 'estructura', tela: 'tela', mecanismo: 'mecanismo', todo: 'completo' };
const ESTADOS_RESTO = ['listo_para_cargar', 'parcialmente_listo', 'parcialmente_instalado'];

// Piezas que fábrica tiene listas de un ítem: las partes marcadas, o 'todo' si solo está el «listo» del ítem (pedidos viejos).
export function partesListas(o, iid) {
    const pf = (o.partesFabrica || {})[iid];
    if (pf && typeof pf === 'object') { const l = Object.keys(pf).filter(k => pf[k] === true); if (l.length) return l; }
    return (o.itemsListosFabrica || {})[iid] === true ? ['todo'] : [];
}
// Foto de lo que hay listo AHORA (se guarda al entregar).
export function fotoPartes(o) {
    const out = {};
    (o.items || []).forEach(it => { const iid = String(it.id); const l = partesListas(o, iid); if (l.length) out[iid] = l; });
    return out;
}
// Lo que fábrica marcó listo y todavía no se llevó: [{ iid, nombre, partes: [...] }]. Solo pedidos de fábrica ya entregados y no cerrados.
export function restoPendiente(o) {
    if (!o || o.docType === 'COMPRA_DIRECTA' || o.entregado !== true || !ESTADOS_RESTO.includes(o.status)) return [];
    const foto = o.entregaPartes;
    if (!foto || typeof foto !== 'object') return [];   // entregas viejas sin foto: no se inventa un resto (ver migración 2026-11-03)
    const out = [];
    (o.items || []).forEach(it => {
        const iid = String(it.id), ya = foto[iid] || [];
        if (ya.includes('todo')) return;
        const listas = partesListas(o, iid);
        const faltan = listas.includes('todo') ? (ya.length ? ['resto del ítem'] : ['todo']) : listas.filter(p => !ya.includes(p));
        if (faltan.length) out.push({ iid, nombre: (it.tipo || 'Ítem ' + iid) + (it.ubicacion ? ' · ' + it.ubicacion : ''), partes: faltan });
    });
    return out;
}
export const restoTxt = (resto) => resto.map(r => `ítem ${r.iid} ${r.nombre} (${r.partes.map(p => PARTE_TXT[p] || p).join(', ')})`).join(' · ');

// Lo que Transportes muestra en cada pestaña (misma regla que su render).
export function visibleEnTransportes(o) {
    if (o.directoInstalacion === true) return false;
    if (['pendiente_fabrica', 'en_fabrica'].includes(o.status) && !((o.destino === 'interno' && o.docType !== 'COMPRA_DIRECTA') || o.enRuta === true)) return false;
    return o.entregado === true || (o.status !== 'completado' && o.instalado !== true);
}
export function pestanaDe(o) {
    if (!visibleEnTransportes(o)) return null;
    if (o.entregado === true) return restoPendiente(o).length ? (o.restoEnRuta === true ? 'ruta' : 'espera') : 'entregado';
    return o.enRuta === true ? 'ruta' : 'espera';
}
// Resumen para la banda de Instalación: lo que el chofer tiene que buscar ahora.
export function pendientesChofer(orders) {
    const r = { compras: [], pedidos: [], restos: [] };
    orders.forEach(o => {
        if (pestanaDe(o) !== 'espera') return;
        if (o.docType === 'COMPRA_DIRECTA') r.compras.push(o);
        else if (o.entregado === true) r.restos.push(o);
        else r.pedidos.push(o);
    });
    return r;
}
