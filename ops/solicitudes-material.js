// Pedidos de material y herramientas del equipo a la oficina (2026-11-01; flujo simplificado 2026-11-02 a pedido de Dylan: «más
// fluidez, está muy complejo»). Colección `solicitudesMaterial`. Lo comparten:
//   · inventario.html → botón «🙋 Pedir» en cada ítem + «Pedir algo que no está en la lista» + sección «Mis pedidos».
//   · solicitudes-material.html → tablero de la oficina (Sara y Dylan) y del chofer (Wilson); quién es quién se configura en
//     `rrhhConfig/solicitudesMaterial` { compras:[emails oficina], chofer:[emails] } sin tocar código.
//   · index.html (Panel) → mosaico con badge + tarjeta de notificación solo para lo URGENTE.
// FLUJO: el equipo pide porque sabe que falta (nadie verifica stock; eso vendrá cuando haya una persona dedicada al almacén).
//   pedida → la oficina elige: 📲 «Pedir al proveedor por WhatsApp» (abre WhatsApp con el pedido; estado pedido_proveedor; luego
//   sube la factura u orden de compra y «Enviar al chofer») o 🚚 «Pasar directo al chofer» (compra en persona; estado chofer).
//   chofer → el chofer ve el pedido con sus adjuntos, lo compra/retira en su ruta y marca «Recogido» → la oficina o él marcan
//   «Entregada» (con entrada al inventario si el pedido venía de un ítem). «No se compra» exige motivo.
// Estados viejos (vista, comprando, lista) se siguen mostrando por compatibilidad pero ya no se crean.
import { db } from './firebase-config.js';
import {
    collection, doc, addDoc, updateDoc, onSnapshot, query, where, getDoc, increment, serverTimestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { fotosThumbsHTML, fotoAddBtnHTML } from './fotos.js?v=20260812';

export const COL = 'solicitudesMaterial';
export const ESTADOS = ['pedida', 'pedido_proveedor', 'chofer', 'recogido', 'entregada', 'rechazada', 'cancelada', 'vista', 'comprando', 'lista'];
export const POR_DECIDIR = ['pedida', 'vista', 'comprando'];
export const ABIERTOS = ['pedida', 'pedido_proveedor', 'chofer', 'recogido', 'vista', 'comprando', 'lista'];
export const ESTADO_TXT = {
    pedida: 'Pedida', pedido_proveedor: 'Pedida al proveedor', chofer: 'Para el chofer', recogido: 'Recogido',
    entregada: 'Entregada', rechazada: 'No se compra', cancelada: 'Cancelada por quien la pidió',
    vista: 'Vista por la oficina', comprando: 'Comprando', lista: 'Lista para recoger'
};
export const ESTADO_ICO = { pedida: '🙋', pedido_proveedor: '📲', chofer: '🚚', recogido: '📦', entregada: '✅', rechazada: '✖', cancelada: '↩', vista: '👀', comprando: '🛒', lista: '📦' };
export const ESTADO_COLOR = { pedida: '#e67e22', pedido_proveedor: '#2980b9', chofer: '#8e44ad', recogido: '#16a085', entregada: '#27ae60', rechazada: '#c0392b', cancelada: '#95a5a6', vista: '#2980b9', comprando: '#8e44ad', lista: '#16a085' };
export const URGENCIAS = { hoy: '🔥 Hoy (no puedo seguir sin esto)', semana: '📅 Esta semana', cuando: '🕓 Cuando se pueda' };
export const URGENCIA_CORTA = { hoy: '🔥 Hoy', semana: '📅 Esta semana', cuando: '🕓 Cuando se pueda' };
// Unidades de pedido (lo que se cuenta o el empaque): la lista fija + lo que diga el ítem del inventario (unidad o empaque).
export const UNIDADES = ['unidades', 'fundas', 'paquetes', 'cajas', 'rollos', 'bultos', 'sacos', 'latas', 'galones', 'tubos', 'barras', 'metros', 'pies', 'pares', 'juegos'];

const plur = (e) => { e = String(e || '').trim(); return !e || /s$/.test(e) ? e : (/[aeo]$/.test(e) ? e + 's' : e + 'es'); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ahoraISO = () => new Date().toISOString();
// Fechas: en la app `fechaISO` es un string ISO; un doc escrito desde fuera puede traer un Timestamp → se tolera.
const toMs = (v) => v && typeof v.toDate === 'function' ? v.toDate().getTime() : (typeof v === 'string' || typeof v === 'number') ? new Date(v).getTime() : NaN;
export function hace(iso) {
    const t = toMs(iso); if (!(t > 0)) return '';
    const ms = Date.now() - t; if (!(ms >= 0)) return '';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return d >= 1 ? `hace ${d} d` : h >= 1 ? `hace ${h} h` : m >= 1 ? `hace ${m} min` : 'ahora mismo';
}
const fechaCorta = (iso) => { const t = toMs(iso); return t > 0 ? new Date(t).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
// Conversión de la unidad del PEDIDO a la unidad que cuenta el INVENTARIO (2026-11-03, Dylan: «2 fundas» sumaba 2 unidades).
// Devuelve el factor (1 = misma unidad; porCaja = el pedido viene en el empaque del ítem) o null si no se puede saber.
const mismaU = (a, b) => plur(String(a || '').trim().toLowerCase()) === plur(String(b || '').trim().toLowerCase());
export function factorInventario(s, item) {
    const it = item || {};
    const invU = it.unidad || 'unidades', emp = it.empaque || (Number(it.porCaja) > 0 ? 'caja' : ''), pc = Number(it.porCaja) || 0;
    if (!s.unidad || mismaU(s.unidad, invU)) return 1;
    if (emp && pc > 0 && mismaU(s.unidad, emp)) return pc;
    return null;
}
export const nombreDe = (s) => (s.itemTipo ? s.itemTipo + (s.itemColor ? ' — ' + s.itemColor : '') : (s.texto || 'Sin nombre'));
export const cantidadTxt = (s) => `${Number(s.cantidad) || 0}${s.unidad ? ' ' + s.unidad : ''}`;
const telWa = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 10 ? '1' + d : d; };

// ---------- configuración de quién atiende (provisional; editable en el tablero por gerencia) ----------
// rrhhConfig/solicitudesMaterial = { compras: [emails de oficina], chofer: [emails] }  (`inventario` queda reservado para el futuro encargado de almacén)
let cfgCache = { compras: [], inventario: [], chofer: [] };
export function escucharConfig(onChange) {
    return onSnapshot(doc(db, 'rrhhConfig', 'solicitudesMaterial'), (s) => {
        const d = s.exists() ? s.data() : {};
        cfgCache = { compras: d.compras || [], inventario: d.inventario || [], chofer: d.chofer || [] };
        onChange && onChange(cfgCache);
    }, () => { onChange && onChange(cfgCache); });
}
export const configActual = () => cfgCache;
// Oficina (gestiona) = gerencia/oficina (admin o quien entra sin rol de obra, p. ej. Sara) o quien está en la lista de compras.
export function esGestor(usuario, cfg = cfgCache) {
    const roles = usuario.roles || [];
    if (roles.includes('admin')) return true;
    if (!roles.some(r => ['chofer', 'instalador', 'ayudante'].includes(r))) return true;
    const em = (usuario.email || '').toLowerCase();
    return (cfg.compras || []).concat(cfg.inventario || []).map(e => String(e).toLowerCase()).includes(em);
}
export function rolEn(usuario, cfg = cfgCache) {
    const em = (usuario.email || '').toLowerCase(), has = (l) => (l || []).map(e => String(e).toLowerCase()).includes(em);
    return { compras: has(cfg.compras), inventario: has(cfg.inventario), chofer: has(cfg.chofer) || (usuario.roles || []).includes('chofer') };
}
// Proveedores con teléfono: la misma lista de `rrhhConfig/contratistasExternos` que usa Fábrica interna (suplidor-wa.js).
let provCache = [];
export function escucharProveedores(onChange) {
    return onSnapshot(doc(db, 'rrhhConfig', 'contratistasExternos'), (s) => {
        const l = s.exists() && Array.isArray(s.data().lista) ? s.data().lista : [];
        provCache = l.filter(p => p && p.activo !== false && p.nombre).map(p => ({ id: p.id || p.nombre, nombre: p.nombre + (p.empresa && p.empresa !== p.nombre ? ' (' + p.empresa + ')' : ''), telefono: p.telefono || '' }));
        onChange && onChange(provCache);
    }, () => { onChange && onChange(provCache); });
}
export const proveedoresActuales = () => provCache;

// ---------- suscripción ----------
// Abiertas + cerradas de los últimos 14 días (por `fechaISO`, string ISO → se puede comparar).
export function escucharSolicitudes(onChange) {
    const desde = new Date(Date.now() - 14 * 86400000).toISOString();
    const todas = { abiertas: [], recientes: [] };
    const emitir = () => {
        const m = new Map(); [...todas.abiertas, ...todas.recientes].forEach(s => m.set(s.id, s));
        const arr = [...m.values()].sort((a, b) => String(b.fechaISO || '').localeCompare(String(a.fechaISO || '')));
        onChange(arr);
    };
    const u1 = onSnapshot(query(collection(db, COL), where('estado', 'in', ABIERTOS.slice(0, 10))), (snap) => { todas.abiertas = snap.docs.map(d => ({ id: d.id, ...d.data() })); emitir(); }, (e) => { console.warn('solicitudes abiertas', e && e.code); onChange([]); });
    const u2 = onSnapshot(query(collection(db, COL), where('fechaISO', '>=', desde)), (snap) => { todas.recientes = snap.docs.map(d => ({ id: d.id, ...d.data() })); emitir(); }, () => { });
    return () => { u1(); u2(); };
}

// ---------- escritura ----------
function entradaHistorial(estado, usuario, nota) { return { estado, por: usuario.nombre || '', email: usuario.email || '', fechaISO: ahoraISO(), nota: nota || '' }; }
export async function crearSolicitud(usuario, datos) {
    const s = {
        sede: 'terrenas', estado: 'pedida',
        texto: (datos.texto || '').trim(), itemId: datos.itemId || null, itemTipo: datos.itemTipo || null, itemColor: datos.itemColor || null,
        unidad: datos.unidad || '', categoria: datos.categoria || null,
        itemUnidad: datos.itemUnidad || null, itemEmpaque: datos.itemEmpaque || null, itemPorCaja: Number(datos.itemPorCaja) || null,
        cantidad: Number(datos.cantidad) || 1, urgencia: URGENCIAS[datos.urgencia] ? datos.urgencia : 'semana',
        nota: (datos.nota || '').trim(), obra: (datos.obra || '').trim(),
        pedidoPor: { nombre: usuario.nombre || '', email: usuario.email || '' },
        fecha: serverTimestamp(), fechaISO: ahoraISO(), sumados: [], atiende: null, precio: null, proveedor: null, notaChofer: null,
        historial: [entradaHistorial('pedida', usuario, '')], fotos: []
    };
    if (!s.texto && !s.itemTipo) throw new Error('Escribe qué necesitas.');
    const ref = await addDoc(collection(db, COL), s);
    return ref.id;
}
export async function sumarse(id, usuario, cantidad) {
    const n = Number(cantidad) || 1;
    await updateDoc(doc(db, COL, id), {
        cantidad: increment(n),
        sumados: arrayUnion({ nombre: usuario.nombre || '', email: usuario.email || '', cantidad: n, fechaISO: ahoraISO() }),
        historial: arrayUnion(entradaHistorial('sumado', usuario, `${usuario.nombre} también necesita ${n}`))
    });
}
export async function cambiarEstado(id, estado, usuario, extra = {}, nota = '') {
    if (!ESTADOS.includes(estado)) throw new Error('Estado inválido');
    const cambios = { estado, [estado + 'Fecha']: ahoraISO(), historial: arrayUnion(entradaHistorial(estado, usuario, nota)), ...extra };
    if (['pedido_proveedor', 'chofer', 'rechazada'].includes(estado) && !extra.atiende) cambios.atiende = { nombre: usuario.nombre || '', email: usuario.email || '' };
    await updateDoc(doc(db, COL, id), cambios);
}
// Entregada + entrada al inventario (si el pedido venía de un ítem del catálogo): suma la cantidad comprada y deja el
// movimiento `restock` como lo hace «Agregar stock» de inventario.html.
export async function darEntradaInventario(s, usuario, cantidad, costoU, detalle) {
    if (!s.itemId) throw new Error('Este pedido no está ligado a un ítem del inventario.');
    const n = Number(cantidad) || 0; if (n <= 0) throw new Error('Cantidad inválida');
    const cambios = { cantidad: increment(n) }; if (costoU > 0) cambios.costo = costoU;
    await updateDoc(doc(db, 'inventario', s.itemId), cambios);
    await addDoc(collection(db, 'movimientosInventario'), {
        itemId: s.itemId, itemTipo: s.itemTipo, itemColor: s.itemColor || null, tipo: 'restock', cantidad: n,
        nota: 'Compra por pedido del equipo (' + (s.pedidoPor && s.pedidoPor.nombre || '') + ')' + (detalle ? ' · ' + detalle : '') + (s.proveedor && s.proveedor.nombre ? ' · ' + s.proveedor.nombre : ''),
        costoUnitario: costoU || null, proveedor: s.proveedor && s.proveedor.nombre || null, ncf: null, solicitudId: s.id,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, fecha: serverTimestamp()
    });
    await updateDoc(doc(db, COL, s.id), { entradaInventario: { cantidad: n, detalle: detalle || null, costoUnitario: costoU || null, fechaISO: ahoraISO(), por: usuario.nombre || '' } });
}
// Texto del pedido para el proveedor (WhatsApp). Nunca precios, teléfonos de clientes ni anticipos.
export function mensajeProveedor(s, nombreProv) {
    const l = [`Hola${nombreProv ? ' ' + nombreProv : ''}, le escribe ARTAL Dominicana.`, '', `Pedido: ${cantidadTxt(s)} de ${nombreDe(s)}${s.nota ? ' (' + s.nota + ')' : ''}.`];
    if (s.urgencia === 'hoy') l.push('Lo necesitamos hoy.'); else if (s.urgencia === 'semana') l.push('Lo necesitamos esta semana.');
    l.push('', '¿Tiene disponible y a qué precio? Lo retira nuestro chofer; por favor envíenos la factura u orden por aquí.', '', 'Gracias.');
    return l.join('\n');
}

// ---------- UI compartida: modal «Pedir» ----------
let _usuario = null, _getItem = () => null, _onCreada = null, _matchItem = () => null, _getAbierta = () => null;
// `matchItem(texto)` (opcional): en el tablero, si el texto libre coincide con un ítem del inventario, se liga a él.
// `getAbierta(itemId)` (opcional): pedido abierto de ese ítem → el modal no crea otro, suma la cantidad a ese (2026-11-03: Roosevelt
// pidió dos veces las mismas puntas PH2).
export function montarPedir({ usuario, getItem, onCreada, matchItem, getAbierta }) {
    _usuario = usuario; _getItem = getItem || (() => null); _onCreada = onCreada || null; _matchItem = matchItem || (() => null); _getAbierta = getAbierta || (() => null);
    if (document.getElementById('sol-pedir-ov')) return;
    document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay" id="sol-pedir-ov" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1200;align-items:center;justify-content:center;padding:14px;">
      <div class="modal-box" style="background:#fff;border-radius:14px;width:100%;max-width:440px;padding:20px;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:'Arimo',Arial,sans-serif;">
        <h2 style="margin:0 0 4px;color:#0A3D62;font-size:18px;">🙋 Pedir material o herramienta</h2>
        <div id="sol-pedir-item" style="font-size:14px;color:#334;margin-bottom:8px;"></div>
        <div id="sol-pedir-libre" style="display:none;"><label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">¿Qué necesitas?</label>
          <input type="text" id="sol-texto" list="sol-texto-list" placeholder="Ej: broca de 5/16 para concreto" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;"></div>
        <datalist id="sol-texto-list"></datalist>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">Cantidad</label>
            <input type="number" id="sol-cant" min="1" value="1" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:16px;font-family:inherit;"></div>
          <div><label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">Unidad</label>
            <select id="sol-unidad" onchange="document.getElementById('sol-unidad-otro').style.display = this.value === 'otro' ? 'block' : 'none'" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;background:#fff;">${UNIDADES.map(u => `<option value="${u}">${u}</option>`).join('')}<option value="otro">otra…</option></select>
            <input type="text" id="sol-unidad-otro" placeholder="escribe la unidad" style="display:none;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;"></div>
        </div>
        <label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">¿Para cuándo?</label>
        <div id="sol-urg" style="display:flex;flex-direction:column;gap:6px;">${Object.entries(URGENCIAS).map(([k, v], i) => `<label style="display:flex;gap:10px;align-items:center;justify-content:flex-start;font-size:14px;font-weight:normal;margin:0;padding:8px 10px;border:1.5px solid #e3e8ee;border-radius:8px;cursor:pointer;"><input type="radio" name="sol-urg" value="${k}" ${i === 1 ? 'checked' : ''} style="width:18px;height:18px;min-height:0;margin:0;flex:none;"> <span>${v}</span></label>`).join('')}</div>
        <details id="sol-mas" style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;color:#0A3D62;font-weight:bold;">＋ Nota u obra (opcional)</summary>
        <label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">Nota <span style="font-weight:normal;color:#888">(opcional: medida, marca, para qué)</span></label>
        <input type="text" id="sol-nota" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;">
        <label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">Obra <span style="font-weight:normal;color:#888">(opcional)</span></label>
        <input type="text" id="sol-obra" placeholder="Solo si es para una obra en concreto" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;">
        </details>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
          <button type="button" onclick="solCerrarPedir()" style="background:transparent;border:1.5px solid #ddd;color:#888;border-radius:8px;padding:10px 14px;font-family:inherit;font-weight:bold;cursor:pointer;">Cancelar</button>
          <button type="button" id="sol-guardar" data-txt="Enviar pedido" onclick="solGuardarPedir()" style="background:#e67e22;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-family:inherit;font-weight:bold;cursor:pointer;">Enviar pedido</button>
        </div>
        <div style="font-size:11.5px;color:#778;margin-top:10px;">A la oficina le llega al instante; lo pide al proveedor o se lo pasa al chofer, y tú ves el estado en «Mis pedidos».</div>
      </div>
    </div>`);
    let itemSel = null, abiertaSel = null;
    window.solAbrirPedir = (itemId) => {
        itemSel = itemId ? _getItem(itemId) : null;
        abiertaSel = itemId ? _getAbierta(itemId) : null;
        document.getElementById('sol-pedir-item').innerHTML = itemSel ? `<b>${esc(itemSel.tipo)}${itemSel.color ? ' — ' + esc(itemSel.color) : ''}</b> <span style="color:#889">· hay ${Number(itemSel.cantidad) || 0} ${esc(itemSel.unidad || '')} en inventario</span>` : '';
        document.getElementById('sol-pedir-libre').style.display = itemSel ? 'none' : 'block';
        document.getElementById('sol-texto').value = ''; document.getElementById('sol-cant').value = 1;
        const selU = document.getElementById('sol-unidad'), otroU = document.getElementById('sol-unidad-otro');
        const extra = itemSel ? [itemSel.unidad, itemSel.empaque ? plur(itemSel.empaque) : ''].filter(u => u && !UNIDADES.includes(u)) : [];
        selU.innerHTML = UNIDADES.concat(extra).map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('') + '<option value="otro">otra…</option>';
        const pref = itemSel ? (itemSel.empaque && Number(itemSel.porCaja) > 0 ? plur(itemSel.empaque) : (itemSel.unidad || 'unidades')) : 'unidades';
        selU.value = [...selU.options].some(o => o.value === pref) ? pref : 'unidades'; otroU.style.display = 'none'; otroU.value = '';
        const eq = itemSel && itemSel.empaque && Number(itemSel.porCaja) > 0 ? ` · 1 ${esc(itemSel.empaque)} = ${Number(itemSel.porCaja)} ${esc(itemSel.unidad || 'unidades')}` : '';
        if (eq) document.getElementById('sol-pedir-item').innerHTML += `<span style="color:#889">${eq}</span>`;
        document.getElementById('sol-nota').value = ''; document.getElementById('sol-obra').value = '';
        const mas = document.getElementById('sol-mas'); if (mas) mas.open = false;
        const urgBox = document.getElementById('sol-urg'), btnG = document.getElementById('sol-guardar');
        if (abiertaSel) {   // ya hay un pedido abierto de esta pieza: lo que se escriba se suma a ese
            document.getElementById('sol-pedir-item').innerHTML += `<div style="margin-top:8px;background:#fff8e1;border:1.5px solid #f0c36d;border-radius:8px;padding:8px 10px;font-size:13px;color:#7a5200;">Ya está pedido: <b>${esc(cantidadTxt(abiertaSel))}</b> · pidió ${esc(abiertaSel.pedidoPor ? abiertaSel.pedidoPor.nombre : '')} · ${esc(ESTADO_TXT[abiertaSel.estado] || abiertaSel.estado)}. Si necesitas más, pon cuánto y se suma a ese pedido.</div>`;
            selU.value = abiertaSel.unidad && [...selU.options].some(o => o.value === abiertaSel.unidad) ? abiertaSel.unidad : selU.value; selU.disabled = true;
            urgBox.style.display = 'none'; urgBox.previousElementSibling.style.display = 'none'; if (mas) mas.style.display = 'none';
            btnG.textContent = '➕ Sumar a ese pedido';
        } else {
            selU.disabled = false; urgBox.style.display = ''; urgBox.previousElementSibling.style.display = ''; if (mas) mas.style.display = '';
            btnG.textContent = btnG.dataset.txt || btnG.textContent;
        }
        const ov = document.getElementById('sol-pedir-ov'); ov.style.display = 'flex';
        setTimeout(() => (itemSel ? document.getElementById('sol-cant') : document.getElementById('sol-texto')).focus(), 50);
    };
    window.solCerrarPedir = () => { document.getElementById('sol-pedir-ov').style.display = 'none'; };
    window.solGuardarPedir = async () => {
        const btn = document.getElementById('sol-guardar'); btn.disabled = true;
        try {
            if (abiertaSel) { await sumarse(abiertaSel.id, _usuario, document.getElementById('sol-cant').value); window.solCerrarPedir(); _onCreada && _onCreada(abiertaSel.id); return; }
            const urg = (document.querySelector('input[name="sol-urg"]:checked') || {}).value || 'semana';
            if (!itemSel) { const m = _matchItem(document.getElementById('sol-texto').value); if (m) itemSel = m; }
            const id = await crearSolicitud(_usuario, {
                texto: itemSel ? '' : document.getElementById('sol-texto').value,
                itemId: itemSel ? itemSel.id : null, itemTipo: itemSel ? itemSel.tipo : null, itemColor: itemSel ? (itemSel.color || null) : null,
                categoria: itemSel ? (itemSel.categoria || null) : null,
                itemUnidad: itemSel ? (itemSel.unidad || 'unidades') : null, itemEmpaque: itemSel ? (itemSel.empaque || null) : null, itemPorCaja: itemSel ? (Number(itemSel.porCaja) || null) : null,
                unidad: document.getElementById('sol-unidad').value === 'otro' ? (document.getElementById('sol-unidad-otro').value.trim() || 'unidades') : document.getElementById('sol-unidad').value,
                cantidad: document.getElementById('sol-cant').value, urgencia: urg,
                nota: document.getElementById('sol-nota').value, obra: document.getElementById('sol-obra').value
            });
            window.solCerrarPedir(); _onCreada && _onCreada(id);
        } catch (e) { alert(e.message || e); } finally { btn.disabled = false; }
    };
}

// ---------- tarjeta de un pedido (la misma en «Mis pedidos» y en el tablero) ----------
// opts: { usuario, gestor:bool (oficina), chofer:bool }
export function solicitudCardHTML(s, opts) {
    const u = opts.usuario, mia = s.pedidoPor && s.pedidoPor.email === u.email;
    const abierta = ABIERTOS.includes(s.estado);
    const color = ESTADO_COLOR[s.estado] || '#999';
    const quien = s.pedidoPor ? s.pedidoPor.nombre : '';
    const sum = Array.isArray(s.sumados) && s.sumados.length ? ` <span style="color:#889;font-size:12px">+ ${s.sumados.map(x => esc(x.nombre)).join(', ')}</span>` : '';
    const ult = Array.isArray(s.historial) && s.historial.length ? s.historial[s.historial.length - 1] : null;
    const estadoLinea = `<span style="display:inline-block;background:${color};color:#fff;border-radius:100px;padding:3px 10px;font-size:11.5px;font-weight:bold;">${ESTADO_ICO[s.estado] || ''} ${esc(ESTADO_TXT[s.estado] || s.estado)}</span>` +
        (s.atiende && s.atiende.nombre && s.estado !== 'pedida' ? ` <span style="font-size:12px;color:#556">· ${esc(s.atiende.nombre)}</span>` : '') +
        (ult && ult.fechaISO ? ` <span style="font-size:12px;color:#889">· ${hace(ult.fechaISO)}</span>` : '');
    const puedeAdjuntar = (opts.gestor || opts.chofer) && ['pedido_proveedor', 'chofer', 'recogido'].includes(s.estado);
    const detalle = [
        s.nota ? `📝 ${esc(s.nota)}` : '', s.obra ? `🏗️ ${esc(s.obra)}` : '',
        s.proveedor && s.proveedor.nombre ? `📲 Pedido a ${esc(s.proveedor.nombre)}${s.proveedor.telefono ? ' · ' + esc(s.proveedor.telefono) : ''}` : '',
        s.notaChofer ? `🚚 Para el chofer: ${esc(s.notaChofer)}` : '',
        s.precio != null && s.precio !== '' ? `💲 RD$ ${Number(s.precio).toLocaleString('es-DO')}` : '',
        s.estado === 'rechazada' && s.rechazoMotivo ? `✖ Motivo: ${esc(s.rechazoMotivo)}` : '',
        s.recogidoPor ? `📦 Recogido por ${esc(s.recogidoPor)}` : '', s.entregadaA ? `📬 Entregado a ${esc(s.entregadaA)}` : '',
        s.entradaInventario ? `📥 Entró al inventario: ${s.entradaInventario.cantidad}` : ''
    ].filter(Boolean).map(t => `<div style="font-size:13px;color:#445;margin-top:3px;">${t}</div>`).join('');
    const adjuntos = (Array.isArray(s.fotos) && s.fotos.length) || puedeAdjuntar
        ? `<div style="margin-top:6px;">${fotosThumbsHTML(s.fotos, { coleccion: COL, id: s.id, puedeBorrar: !!opts.gestor })}${puedeAdjuntar ? fotoAddBtnHTML({ coleccion: COL, id: s.id, label: '📎 Factura u orden de compra (foto o PDF)', pdf: true }) : ''}</div>` : '';
    const urgCol = s.urgencia === 'hoy' ? '#c0392b' : s.urgencia === 'semana' ? '#b9770e' : '#7f8c8d';
    let acciones = '';
    if (abierta) {
        if (!opts.gestor && !opts.chofer && !mia) acciones += `<button onclick="solSumarse('${s.id}')" style="background:#f0f4f8;color:#0A3D62;border:1.5px solid #cfd8e3;border-radius:8px;padding:8px 12px;font-weight:bold;font-size:13px;font-family:inherit;cursor:pointer;">➕ Yo también lo necesito</button>`;
        if (mia && s.estado === 'pedida') acciones += `<button onclick="solCancelar('${s.id}')" style="background:transparent;color:#888;border:1.5px solid #ddd;border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;cursor:pointer;">Ya no hace falta</button>`;
        acciones += accionesHTML(s, opts);
    }
    const selec = opts.seleccionable && opts.gestor && POR_DECIDIR.includes(s.estado)
        ? `<input type="checkbox" class="sol-sel" data-id="${s.id}" onchange="solSelCambio && solSelCambio()" style="width:20px;height:20px;margin:0 8px 0 0;vertical-align:middle;cursor:pointer;" title="Seleccionar para decidir varios juntos">` : '';
    return `<div class="sol-card" id="sol-${s.id}" style="background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.06);padding:12px 14px;border-left:6px solid ${color};margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
            <div>${selec}<b style="color:#0A3D62;font-size:15px;">${esc(nombreDe(s))}</b> <span style="font-size:14px;color:#223;">× ${esc(cantidadTxt(s))}</span>${s.itemId ? '' : ' <span style="font-size:11px;color:#889;border:1px solid #dde;border-radius:6px;padding:1px 5px;">no está en inventario</span>'}</div>
            <span style="font-size:12px;font-weight:bold;color:${urgCol};white-space:nowrap;">${esc(URGENCIA_CORTA[s.urgencia] || '')}</span>
        </div>
        <div style="font-size:12.5px;color:#667;margin-top:3px;">${mia ? 'Pediste tú' : 'Pidió ' + esc(quien)}${sum} · ${esc(fechaCorta(s.fechaISO))}</div>
        <div style="margin-top:6px;">${estadoLinea}</div>
        ${detalle}${adjuntos}
        ${acciones ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${acciones}</div>` : ''}
        <div id="sol-form-${s.id}"></div>
    </div>`;
}
function accionesHTML(s, opts) {
    const b = (txt, fn, bg, title) => `<button onclick="${fn}" title="${esc(title || '')}" style="background:${bg};color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:bold;font-size:13px;font-family:inherit;cursor:pointer;">${txt}</button>`;
    let h = '';
    if (opts.gestor) {
        if (['pedida', 'vista', 'comprando'].includes(s.estado)) {
            h += b('📲 Pedir al proveedor', `solForm('${s.id}','proveedor')`, '#2980b9', 'Abre WhatsApp con el pedido al proveedor');
            h += b('🚚 Pasar al chofer', `solForm('${s.id}','chofer')`, '#8e44ad', 'Se compra en persona: el chofer lo trae en su próxima ruta');
            h += b('✖ No se compra', `solForm('${s.id}','rechazada')`, '#c0392b');
        }
        if (s.estado === 'pedido_proveedor') h += b('🚚 Lo retira el chofer', `solForm('${s.id}','chofer')`, '#8e44ad', 'El chofer lo retira con la factura u orden adjunta');
        if (['pedido_proveedor', 'lista'].includes(s.estado)) h += b('✅ Ya llegó', `solForm('${s.id}','entregada')`, '#27ae60', 'Lo trajo el proveedor o lo recogió la oficina');
    }
    // Un solo paso para el chofer (2026-11-03): «Lo traje» = recogido + entregado + entrada al inventario.
    if ((opts.gestor || opts.chofer) && s.estado === 'chofer') h += b('✅ Lo traje', `solForm('${s.id}','entregada')`, '#27ae60', 'Ya está en Las Terrenas: entra al inventario y avisa a quien lo pidió');
    if ((opts.gestor || opts.chofer) && s.estado === 'recogido') h += b('✅ Ya llegó', `solForm('${s.id}','entregada')`, '#27ae60');
    return h;
}

// Handlers del tablero y de «Mis pedidos». `getSolicitud(id)` devuelve el doc en caché.
export function montarAcciones({ usuario, getSolicitud }) {
    const inp = (id, ph, type = 'text', val = '') => `<input type="${type}" id="${id}" placeholder="${esc(ph)}" value="${esc(val)}" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;">`;
    const sel = (id, opciones, val, onchange = '') => `<select id="${id}" ${onchange ? `onchange="${onchange}"` : ''} style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;background:#fff;">${opciones.map(([v, t]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const caja = (id, inner, okTxt, okFn, okBg) => `<div style="background:#f6f8fa;border-radius:10px;padding:10px 12px;margin-top:10px;display:grid;gap:8px;">${inner}
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;"><button onclick="document.getElementById('sol-form-${id}').innerHTML=''" style="background:transparent;border:1.5px solid #ddd;color:#888;border-radius:8px;padding:8px 12px;font-family:inherit;font-weight:bold;cursor:pointer;">Cancelar</button>
        <button onclick="${okFn}" style="background:${okBg};color:#fff;border:none;border-radius:8px;padding:8px 14px;font-family:inherit;font-weight:bold;cursor:pointer;">${okTxt}</button></div></div>`;
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    window.solSumarse = async (id) => {
        const n = prompt('¿Cuántos necesitas tú? (se suman al pedido)', '1'); if (n == null) return;
        try { await sumarse(id, usuario, n); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solCancelar = async (id) => {
        if (!confirm('¿Cancelar este pedido?')) return;
        try { await cambiarEstado(id, 'cancelada', usuario, {}, 'Cancelado por quien lo pidió'); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solForm = (id, tipo) => {
        const s = getSolicitud(id); if (!s) return; const box = document.getElementById('sol-form-' + id); if (!box) return;
        if (tipo === 'proveedor') {
            const provs = proveedoresActuales();
            const opciones = [['', '— elegir proveedor —'], ...provs.map(p => [p.id, p.nombre + (p.telefono ? ' · ' + p.telefono : ' · sin teléfono')]), ['otro', 'Otro número…']];
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">📲 Pedir al proveedor por WhatsApp</div>
                <label style="font-size:12px;">Proveedor</label>${sel('sf-prov-' + id, opciones, '', `document.getElementById('sf-provotro-${id}').style.display = this.value === 'otro' ? 'grid' : 'none'`)}
                <div id="sf-provotro-${id}" style="display:none;grid-template-columns:1fr 1fr;gap:8px;"><div><label style="font-size:12px;">Nombre</label>${inp('sf-provnom-' + id, 'Ferretería X')}</div><div><label style="font-size:12px;">WhatsApp (10 dígitos)</label>${inp('sf-provtel-' + id, '8095551234', 'tel')}</div></div>
                <label style="font-size:12px;">Mensaje (puedes editarlo)</label><textarea id="sf-msg-${id}" rows="6" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:13px;font-family:inherit;">${esc(mensajeProveedor(s, ''))}</textarea>
                <div style="font-size:11.5px;color:#778;">Se abre WhatsApp con el texto; lo envías tú. El pedido queda «Pedida al proveedor». Cuando el proveedor mande la factura u orden, adjúntala aquí y pásala al chofer.</div>`,
                'Abrir WhatsApp y marcar', `solOkProveedor('${id}')`, '#2980b9');
        } else if (tipo === 'chofer') {
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">🚚 ${s.estado === 'pedido_proveedor' ? 'Enviar al chofer para retirarlo' : 'Pasar directo al chofer'}</div>
                <label style="font-size:12px;">${s.estado === 'pedido_proveedor' ? 'Dónde lo retira y qué debe presentar' : 'Dónde comprarlo y qué pedir exactamente'}</label>${inp('sf-nc-' + id, s.estado === 'pedido_proveedor' ? 'Ej: en el proveedor, ya está pagado; mostrar la orden adjunta' : 'Ej: ferretería de la 27, pedir la caja de 100', 'text', s.notaChofer || '')}
                <div style="font-size:11.5px;color:#778;">Al chofer le llega un aviso. Lo trae en su próxima ruta y marca «Recogido». ${(Array.isArray(s.fotos) && s.fotos.length) ? 'Verá los adjuntos.' : 'Si hay factura u orden de compra, adjúntala en la tarjeta antes o después.'}</div>`,
                'Pasar al chofer', `solOkChofer('${id}')`, '#8e44ad');
        } else if (tipo === 'recogido') {
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">📦 Recogido / comprado</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><label style="font-size:12px;">Precio pagado (RD$, opcional)</label>${inp('sf-precio-' + id, '0', 'number', s.precio != null ? String(s.precio) : '')}</div><div><label style="font-size:12px;">Nota (opcional)</label>${inp('sf-nr-' + id, 'Ej: solo había 80')}</div></div>
                <div style="font-size:11.5px;color:#778;">Avisa a quien lo pidió y a la oficina. Cuando se lo entregues, marca «Entregada».</div>`,
                'Marcar recogido', `solOkRecogido('${id}')`, '#16a085');
        } else if (tipo === 'entregada') {
            const conInv = !!s.itemId;
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">✅ ${s.estado === 'chofer' ? 'Lo traje' : 'Ya llegó'}: ${esc(nombreDe(s))}</div>
                <div style="font-size:12.5px;color:#334;">Se pidió: <b>${esc(cantidadTxt(s))}</b></div>
                ${conInv ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;"><input type="checkbox" id="sf-inv-${id}" checked onchange="document.getElementById('sf-invrow-${id}').style.display = this.checked ? '' : 'none'"> Entra al almacén (inventario)</label>
                <div id="sf-invrow-${id}" style="display:grid;gap:6px;"><div><label style="font-size:12px;" id="sf-invcant-lbl-${id}">Entran al inventario</label>${inp('sf-invcant-' + id, '', 'number', '')}</div>
                <div id="sf-invconv-${id}" style="font-size:12px;color:#778;">Calculando la equivalencia…</div></div>
                <div style="font-size:11.5px;color:#778;">Si va directo a la obra y no al almacén, desmarca la casilla.</div>` : `<div style="font-size:11.5px;color:#778;">No está en la lista del inventario: no entra al almacén. Si debe quedar ahí, la oficina lo crea en Inventario.</div>`}
                <div><label style="font-size:12px;">Precio total pagado (RD$, opcional)</label>${inp('sf-precio2-' + id, '0', 'number', s.precio != null ? String(s.precio) : '')}</div>`,
                'Confirmar', `solOkEntregada('${id}')`, '#27ae60');
            if (conInv) prepararEntrada(s, id);
        } else if (tipo === 'rechazada') {
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#c0392b;">✖ No se compra</div>
                <label style="font-size:12px;">Motivo (lo ve quien lo pidió)</label>${inp('sf-motivo-' + id, 'Ej: ya hay uno en el bulto del equipo 2 / se compra con el próximo pedido grande')}`,
                'Confirmar', `solOkRechazada('${id}')`, '#c0392b');
        }
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    window.solOkProveedor = async (id) => {
        const s = getSolicitud(id); if (!s) return;
        const pid = v('sf-prov-' + id); let prov = null;
        if (pid === 'otro') { prov = { id: null, nombre: v('sf-provnom-' + id).trim() || 'Proveedor', telefono: v('sf-provtel-' + id).trim() }; }
        else { const p = proveedoresActuales().find(x => x.id === pid); if (!p) { alert('Elige el proveedor.'); return; } prov = { id: p.id, nombre: p.nombre, telefono: p.telefono }; }
        const tel = telWa(prov.telefono); if (!tel) { alert('Ese proveedor no tiene WhatsApp cargado. Elige «Otro número…» y escríbelo.'); return; }
        const msg = v('sf-msg-' + id) || mensajeProveedor(s, prov.nombre);
        window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank');
        try { await cambiarEstado(id, 'pedido_proveedor', usuario, { proveedor: { ...prov, fechaISO: ahoraISO(), por: usuario.nombre || '' } }, 'Pedido a ' + prov.nombre + ' por WhatsApp'); }
        catch (e) { alert('No se pudo marcar: ' + (e.message || e)); }
    };
    window.solOkChofer = async (id) => {
        try { await cambiarEstado(id, 'chofer', usuario, { notaChofer: v('sf-nc-' + id).trim() || null }, v('sf-nc-' + id)); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solOkRecogido = async (id) => {
        const p = v('sf-precio-' + id);
        try { await cambiarEstado(id, 'recogido', usuario, { recogidoPor: usuario.nombre || '', ...(p !== '' ? { precio: Number(p) } : {}) }, v('sf-nr-' + id)); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    // Rellena «Entran al inventario» en la unidad que cuenta el inventario (lee el ítem actual: su empaque pudo cambiar).
    const conv = {};
    async function prepararEntrada(s, id) {
        let item = { unidad: s.itemUnidad, empaque: s.itemEmpaque, porCaja: s.itemPorCaja };
        try { const d = await getDoc(doc(db, 'inventario', s.itemId)); if (d.exists()) item = d.data(); } catch (_) { }
        const invU = item.unidad || 'unidades', f = factorInventario(s, item), n = Number(s.cantidad) || 0;
        const el = (k) => document.getElementById(k + id);
        if (!el('sf-invcant-')) return;
        el('sf-invcant-lbl-').textContent = `Entran al inventario (en ${invU})`;
        if (f != null) {
            el('sf-invcant-').value = String(n * f);
            conv[id] = f === 1 ? '' : `${n} ${s.unidad} × ${f} = ${n * f} ${invU}`;
            el('sf-invconv-').innerHTML = f === 1 ? `El inventario cuenta en ${esc(invU)}: entran ${n}.` : `<b style="color:#1e7d4f">${esc(conv[id])}</b> entran al inventario.`;
        } else {
            el('sf-invcant-').value = ''; conv[id] = '';
            el('sf-invconv-').innerHTML = `<b style="color:#c0392b">El pedido dice «${esc(cantidadTxt(s))}» y el inventario cuenta en ${esc(invU)}: escribe cuántas ${esc(invU)} entran.</b>`;
        }
    }
    window.solOkEntregada = async (id) => {
        const s = getSolicitud(id); if (!s) return;
        const chk = document.getElementById('sf-inv-' + id); const p = v('sf-precio2-' + id);
        const cantInv = Number(v('sf-invcant-' + id)) || 0, precio = p !== '' ? Number(p) : null;
        if (chk && chk.checked && !(cantInv > 0)) { alert('Escribe cuánto entra al inventario (o desmarca la casilla si va directo a la obra).'); return; }
        const quienes = [s.pedidoPor && s.pedidoPor.nombre, ...((s.sumados || []).map(x => x.nombre))].filter(Boolean);
        try {
            if (chk && chk.checked) await darEntradaInventario(s, usuario, cantInv, precio > 0 ? Math.round(precio / cantInv * 100) / 100 : 0, conv[id] || '');
            await cambiarEstado(id, 'entregada', usuario, {
                entregadaA: [...new Set(quienes)].join(', ') || null, ...(precio != null ? { precio } : {}),
                ...(['chofer', 'recogido'].includes(s.estado) && !s.recogidoPor ? { recogidoPor: usuario.nombre || '' } : {})
            });
        } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solOkRechazada = async (id) => {
        const m = (v('sf-motivo-' + id) || '').trim(); if (!m) { alert('Escribe el motivo: quien pidió tiene que entenderlo.'); return; }
        try { await cambiarEstado(id, 'rechazada', usuario, { rechazoMotivo: m }, m); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
}

// ---------- decidir VARIOS a la vez (2026-11-03, Dylan: «eficiencia y rapidez»): un solo WhatsApp al proveedor con todo,
// o pasar todo al chofer de una vez. Los pedidos pendientes casi siempre son reposiciones del mismo proveedor.
export function mensajeProveedorVarios(lista, nombreProv) {
    const l = [`Hola${nombreProv ? ' ' + nombreProv : ''}, le escribe ARTAL Dominicana.`, '', 'Pedido:'];
    lista.forEach(s => l.push(`• ${cantidadTxt(s)} de ${nombreDe(s)}${s.nota ? ' (' + s.nota + ')' : ''}`));
    if (lista.some(s => s.urgencia === 'hoy')) l.push('', 'Algunas piezas las necesitamos hoy.');
    l.push('', '¿Tiene disponible y a qué precio? Lo retira nuestro chofer; por favor envíenos la factura u orden por aquí.', '', 'Gracias.');
    return l.join('\n');
}
export async function pedirVariosAlProveedor(ids, prov, usuario) {
    const extra = { proveedor: { ...prov, fechaISO: ahoraISO(), por: usuario.nombre || '' } };
    for (const id of ids) await cambiarEstado(id, 'pedido_proveedor', usuario, extra, 'Pedido a ' + prov.nombre + ' por WhatsApp' + (ids.length > 1 ? ` (junto con ${ids.length - 1} más)` : ''));
}
export async function pasarVariosAlChofer(ids, nota, usuario) {
    // `loteN/loteIndice`: el aviso al chofer sale una sola vez por lote (functions → solicitudMaterialPush).
    for (const [i, id] of ids.entries()) await cambiarEstado(id, 'chofer', usuario, { notaChofer: (nota || '').trim() || null, loteN: ids.length, loteIndice: i }, nota || '');
}
export { telWa };

// ---------- lista para el chofer (texto para copiar / WhatsApp): lo que debe comprar o retirar en su ruta ----------
export function listaChoferTxt(solicitudes) {
    const pend = solicitudes.filter(s => s.estado === 'chofer');
    if (!pend.length) return 'El chofer no tiene nada pendiente de comprar o retirar.';
    const orden = { hoy: 0, semana: 1, cuando: 2 };
    const lineas = ['🚚 PARA EL CHOFER — ' + new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long' }), ''];
    pend.sort((a, b) => (orden[a.urgencia] ?? 1) - (orden[b.urgencia] ?? 1)).forEach(s => {
        lineas.push(`${s.urgencia === 'hoy' ? '🔥' : '•'} ${nombreDe(s)} × ${cantidadTxt(s)}${s.nota ? ' (' + s.nota + ')' : ''}${s.proveedor && s.proveedor.nombre ? ' — retirar en ' + s.proveedor.nombre : ''}${s.notaChofer ? ' — ' + s.notaChofer : ''} — pidió ${s.pedidoPor ? s.pedidoPor.nombre : ''}`);
    });
    return lineas.join('\n').trim();
}
export { esc as escSol, getDoc as _getDoc };
