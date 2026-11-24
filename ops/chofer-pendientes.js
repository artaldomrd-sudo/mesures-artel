// Qué tiene que buscar el chofer (2026-11-03, Dylan: «no podemos permitir que siga sucediendo; todo más sencillo de entender y ver»).
// Lo comparten Transportes (chofer.html) e Instalación (banda arriba para quien tiene rol chofer). La misma regla vive en
// functions/index.js (push «Resto listo para recoger»): si cambia una, cambiar la otra.
//
// «RESTO POR RECOGER»: un pedido de fábrica que se entregó en parte (marcos primero, hojas/vidrios después) quedaba para siempre en
// la pestaña Entregado aunque ALUCUFEL marcara después el resto listo (caso Villa Cocoloba, 2026-11-03). Ahora cada entrega guarda
// qué piezas se llevó (`entregaPartes` = { itemId: ['marco', 'hojas', …] }, 'todo' = el ítem completo) y el pedido vuelve a
// «En espera» cuando fábrica marca piezas que no estaban en esa foto. `restoEnRuta` = el chofer ya salió a buscar el resto.

import { vaEnTransportes } from './envios.js';
import { listasFabrica, recibidas, restoPorRecoger, PARTE_TXT as _PARTE_TXT, labelParte } from './partes.js';

// 2026-11-24 (caso Shirley): la regla vive en partes.js y se calcula contra lo RECIBIDO en obra (`recibidoPartes`), no contra la
// foto de lo que fábrica decía tener listo. `entregaPartes` se sigue escribiendo con el mismo valor (compat servidor y entregas viejas).
export const PARTE_TXT = _PARTE_TXT;
const ESTADOS_RESTO = ['listo_para_cargar', 'parcialmente_listo', 'parcialmente_instalado'];

// Piezas que fábrica tiene listas de un ítem ('todo' de un pedido viejo = todas las partes del ítem).
export const partesListas = (o, iid) => listasFabrica(o, iid);
// Foto de lo que hay listo AHORA (se guardaba al entregar; hoy marcarEntregado guarda lo recibido).
export function fotoPartes(o) {
    const out = {};
    (o.items || []).forEach(it => { const iid = String(it.id); const l = listasFabrica(o, iid); if (l.length) out[iid] = l; });
    return out;
}
// Lo que fábrica marcó listo y todavía no llegó a la obra: [{ iid, nombre, partes: [...] }]. Solo pedidos de fábrica ya entregados en parte y no cerrados.
export function restoPendiente(o) {
    if (!o || o.docType === 'COMPRA_DIRECTA' || o.entregado !== true || !ESTADOS_RESTO.includes(o.status)) return [];
    if (!o.recibidoPartes && !o.entregaPartes) return [];   // entregas viejas sin foto: no se inventa un resto (ver migración 2026-11-03)
    return restoPorRecoger(o).map(r => { const it = (o.items || []).find(x => String(x.id) === r.iid) || {}; return { iid: r.iid, nombre: (it.tipo || 'Ítem ' + r.iid) + (it.ubicacion ? ' · ' + it.ubicacion : ''), partes: r.partes, labels: r.partes.map(k => labelParte(o, r.iid, k)) }; });
}
export const restoTxt = (resto) => resto.map(r => `ítem ${r.iid} ${r.nombre} (${(r.labels || r.partes.map(p => PARTE_TXT[p] || p)).join(', ')})`).join(' · ');

// Lo que Transportes muestra en cada pestaña (misma regla que su render).
export function visibleEnTransportes(o) {
    if (o.directoInstalacion === true) return false;
    // Cómo llega (envios.js): a Transportes solo lo que lleva el camión de ARTAL o llega por guagua. Lo que va con transporte externo,
    // en la Hilux o lo trae el contratista no es tarea de Wilson (las entregas viejas siguen visibles en «Entregado»).
    if (o.entregado !== true && !vaEnTransportes(o)) return false;
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
        else if (['pendiente_fabrica', 'en_fabrica'].includes(o.status)) return;   // fábrica interna aún sin marcar listo: se ve en Transportes, no cuenta como tarea
        else if (o.entregado === true) r.restos.push(o);
        else r.pedidos.push(o);
    });
    return r;
}
