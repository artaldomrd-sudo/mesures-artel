// Cómo llega el material (2026-11-03, Dylan: «tenemos 4 formas de recibir materiales… vamos a reconstruir los caminos»). Campo
// `orders.envio = { via, quien, nota, por, fechaISO }`. Lo eligen ALUCUFEL al marcar listo (y sus compras directas), la oficina en
// Compras y en Fábrica interna. Lo leen Transportes, Instalación, el Panel (Hilux) y el push (functions/index.js → viaEnvioSrv: si
// cambia una regla, cambiar la otra).
//   camion      → Wilson en Transportes.
//   guagua      → Wilson en Transportes y TODO el equipo de obra en Instalación; cualquiera marca «Recibido». Push a obra + gerencia.
//   externo     → el equipo asignado a esa obra lo recibe en la obra (Instalación). Push a ese equipo.
//   hilux       → solo Dylan, en el Panel.
//   contratista → lo trae e instala un contratista (Delvis): no es tarea de nadie de ARTAL; solo se informa.
// Sin `envio`: camión, salvo que el pedido esté asignado a un contratista externo (→ contratista).
import { doc, updateDoc, serverTimestamp, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { fotoPartes, restoPendiente, restoTxt } from './chofer-pendientes.js';   // (auditoría 2026-11-12) importación circular inofensiva: solo se usa dentro de funciones

export const VIAS = {
    camion: { ico: '🚚', txt: 'Camión ARTAL (Wilson)', corto: 'Camión ARTAL' },
    guagua: { ico: '🚌', txt: 'Guagua SDQ–LT', corto: 'Guagua SDQ–LT' },
    externo: { ico: '🚛', txt: 'Transporte externo', corto: 'Transporte externo', pideQuien: 'Transportista (Winston, Miguel…)' },
    hilux: { ico: '🛻', txt: 'Dylan en la Hilux', corto: 'Hilux (Dylan)' },
    contratista: { ico: '🧰', txt: 'Lo trae e instala el contratista', corto: 'Contratista', pideQuien: 'Contratista (Delvis…)' },
};
export const VIAS_ALUCUFEL = ['camion', 'guagua', 'externo', 'hilux'];   // lo que puede elegir ALUCUFEL

export function viaDe(o) {
    const v = o && o.envio && o.envio.via;
    if (v && VIAS[v]) return v;
    const asig = Array.isArray(o && o.asignadosInstalador) ? o.asignadosInstalador : [];
    if (asig.some(a => a && (a.externo === true || String(a.email || '').startsWith('contratista:')))) return 'contratista';
    return 'camion';
}
export function quienDe(o) {
    if (o && o.envio && o.envio.quien) return o.envio.quien;
    const asig = Array.isArray(o && o.asignadosInstalador) ? o.asignadosInstalador : [];
    const c = asig.find(a => a && (a.externo === true || String(a.email || '').startsWith('contratista:')));
    return c ? String(c.nombre || '').replace(/\s*\(contratista\)\s*/i, '') : '';
}
export const envioTxt = (o) => { const v = viaDe(o), q = quienDe(o); return `${VIAS[v].ico} ${VIAS[v].corto}${q ? ' · ' + q : ''}`; };
// ¿Le toca a Wilson (Transportes)?
export const vaEnTransportes = (o) => ['camion', 'guagua'].includes(viaDe(o));
// ¿Se recibe desde Instalación? (guagua → todo el equipo de obra; externo → los asignados a esa obra, o todo el equipo si no hay)
export function seRecibeEnInstalacion(o, email) {
    const v = viaDe(o);
    if (v === 'guagua') return true;
    if (v !== 'externo') return false;
    const asig = (Array.isArray(o.asignadosInstalador) ? o.asignadosInstalador : []).map(a => String(a && a.email || '').toLowerCase()).filter(e => e.includes('@'));
    if (o.asignadoInstaladorEmail) asig.push(String(o.asignadoInstaladorEmail).toLowerCase());
    return !asig.length || asig.includes(String(email || '').toLowerCase());
}

// Selector reutilizable: radios + campo «quién» cuando la vía lo pide. `prefijo` hace únicos los ids.
export function selectorEnvioHTML(prefijo, o, vias = Object.keys(VIAS)) {
    const actual = viaDe(o || {}), q = (o && o.envio && o.envio.quien) || quienDe(o || {});
    return `<div class="envio-sel" style="display:grid;gap:6px;">
        ${vias.map(v => `<label style="display:flex;gap:8px;align-items:center;font-size:14px;font-weight:normal;margin:0;padding:7px 10px;border:1.5px solid #e3e8ee;border-radius:8px;cursor:pointer;background:#fff;"><input type="radio" name="${prefijo}-via" value="${v}" ${v === actual ? 'checked' : ''} onchange="document.getElementById('${prefijo}-quien-row').style.display = ['externo','contratista'].includes(this.value) ? 'block' : 'none'" style="width:18px;height:18px;min-height:0;margin:0;flex:none;"> <span>${VIAS[v].ico} ${VIAS[v].txt}</span></label>`).join('')}
        <div id="${prefijo}-quien-row" style="display:${['externo', 'contratista'].includes(actual) ? 'block' : 'none'};"><input type="text" id="${prefijo}-quien" value="${String(q || '').replace(/"/g, '&quot;')}" placeholder="¿Quién lo lleva? (nombre)" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;"></div>
    </div>`;
}
// Lee el selector → objeto `envio` (o null si no se eligió nada).
export function leerSelectorEnvio(prefijo, usuario) {
    const r = document.querySelector(`input[name="${prefijo}-via"]:checked`); if (!r) return null;
    const via = r.value; const qEl = document.getElementById(prefijo + '-quien');
    const quien = ['externo', 'contratista'].includes(via) && qEl ? qEl.value.trim() : '';
    return { via, quien, por: (usuario && usuario.nombre) || '', fechaISO: new Date().toISOString() };
}

// ---------------------------------------------------------------------------------------------------------------------
// UNA sola escritura de «Entregado» (auditoría 2026-11-12: la hacían por su cuenta Transportes, Instalación («Recibido») y
// Mi día («Entregado»), cada una con un juego de campos distinto). Escribe lo que escribía Transportes:
//   entregado, fechaEntregado, enRuta:false, restoEnRuta:false, recepcionInstalador {nombre, firma, fecha[, via]},
//   entregaPartes (foto de lo que había listo), entregas[] (arrayUnion con el resto pendiente), y status:'completado' solo si
//   el pedido no necesita instalador (compra directa / «solo recoger») o ya está instalado. Lo demás lo hacen los triggers
//   del servidor (pedidoSigueTrabajo / pedidoEntregadoInterno).
// opts: { via, recibio, firma (dataURL o null), nota, desde ('mi-dia', 'instalacion'…), quien }
// fs: opcional, { doc, updateDoc, serverTimestamp, arrayUnion } para quien tenga su propio Firestore (Mi día en modo demo).
export async function marcarEntregado(db, orderId, o, usuario, opts = {}, fs = null) {
    const F = fs || { doc, updateDoc, serverTimestamp, arrayUnion };
    o = o || {};
    const recibio = String(opts.recibio || (usuario && usuario.nombre) || '').trim();
    const chofer = (usuario && usuario.nombre) || '';
    const noNecesitaInstalador = o.docType === 'COMPRA_DIRECTA' || o.sinInstalacion === true;
    const completa = o.instalado === true || noNecesitaInstalador;
    const resto = restoPendiente(o);
    const ahoraISO = new Date().toISOString();
    const entrega = { fechaISO: ahoraISO, recibio, chofer, resto: resto.length ? restoTxt(resto) : '' };
    if (opts.via) { entrega.via = opts.via; entrega.quien = opts.quien || ''; }
    const datos = {
        entregado: true, fechaEntregado: F.serverTimestamp(), enRuta: false, restoEnRuta: false,
        recepcionInstalador: { nombre: recibio, firma: opts.firma || null, fecha: F.serverTimestamp(), ...(opts.via ? { via: opts.via } : {}) },
        entregaPartes: fotoPartes(o),
        entregas: F.arrayUnion(entrega),
        ...(opts.nota ? { notaEntrega: opts.nota } : {}),
        ...(opts.desde ? { entregadoDesde: opts.desde } : {}),
        ...(completa ? { status: 'completado' } : {})
    };
    await F.updateDoc(F.doc(db, 'orders', orderId), datos);
    return datos;
}
