// Pedidos de material y herramientas del equipo a la oficina (2026-11-01, Dylan: «me envían todo por WhatsApp o me lo
// dicen de boca, no puedo seguir así»). Colección `solicitudesMaterial`. Lo comparten:
//   · inventario.html → botón «🙋 Pedir» en cada ítem + «Pedir algo que no está en la lista» + sección «Mis pedidos».
//   · solicitudes-material.html → tablero de la oficina (Sara = compras, Roosevelt = inventario Terrenas, Wilson = chofer;
//     todo provisional, se cambia en `rrhhConfig/solicitudesMaterial` sin tocar código).
//   · index.html (Panel) → mosaico con badge + tarjeta de notificación solo para lo URGENTE (gerencia).
// Reglas del flujo: el pedido tiene estado y dueño; la oficina lo marca «Visto» el mismo día aunque no se compre todavía;
// el que pidió ve en qué va sin preguntar. Nada de obra obligatoria ni costeo por obra (regla de Dylan 2026-10-27).
import { db } from './firebase-config.js';
import {
    collection, doc, addDoc, updateDoc, onSnapshot, query, where, getDoc, increment, serverTimestamp, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export const COL = 'solicitudesMaterial';
export const ESTADOS = ['pedida', 'vista', 'comprando', 'lista', 'entregada', 'rechazada', 'cancelada'];
export const ABIERTOS = ['pedida', 'vista', 'comprando', 'lista'];
export const ESTADO_TXT = {
    pedida: 'Pedida', vista: 'Vista por la oficina', comprando: 'Comprando', lista: 'Lista para recoger',
    entregada: 'Entregada', rechazada: 'No se compra', cancelada: 'Cancelada por quien la pidió'
};
export const ESTADO_ICO = { pedida: '🙋', vista: '👀', comprando: '🛒', lista: '📦', entregada: '✅', rechazada: '✖', cancelada: '↩' };
export const ESTADO_COLOR = { pedida: '#e67e22', vista: '#2980b9', comprando: '#8e44ad', lista: '#16a085', entregada: '#27ae60', rechazada: '#c0392b', cancelada: '#95a5a6' };
export const URGENCIAS = { hoy: '🔥 Hoy (no puedo seguir sin esto)', semana: '📅 Esta semana', cuando: '🕓 Cuando se pueda' };
export const URGENCIA_CORTA = { hoy: '🔥 Hoy', semana: '📅 Esta semana', cuando: '🕓 Cuando se pueda' };
export const ORIGEN_DINERO = { caja_chica: 'Caja chica', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito del proveedor', otro: 'Otro' };
export const LUGARES = ['Ferretería Las Terrenas', 'Santo Domingo', 'Pedido al proveedor', 'Ya lo teníamos en inventario', 'Otro'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ahoraISO = () => new Date().toISOString();
export function hace(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime(); if (!(ms >= 0)) return '';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    return d >= 1 ? `hace ${d} d` : h >= 1 ? `hace ${h} h` : m >= 1 ? `hace ${m} min` : 'ahora mismo';
}
const fechaCorta = (iso) => iso ? new Date(iso).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const nombreDe = (s) => (s.itemTipo ? s.itemTipo + (s.itemColor ? ' — ' + s.itemColor : '') : (s.texto || 'Sin nombre'));
export const cantidadTxt = (s) => `${Number(s.cantidad) || 0}${s.unidad ? ' ' + s.unidad : ''}`;

// ---------- configuración de quién atiende (provisional; editable en el tablero por gerencia) ----------
// rrhhConfig/solicitudesMaterial = { compras: [emails], inventario: [emails], chofer: [emails] }
let cfgCache = { compras: [], inventario: [], chofer: [] };
export function escucharConfig(onChange) {
    return onSnapshot(doc(db, 'rrhhConfig', 'solicitudesMaterial'), (s) => {
        const d = s.exists() ? s.data() : {};
        cfgCache = { compras: d.compras || [], inventario: d.inventario || [], chofer: d.chofer || [] };
        onChange && onChange(cfgCache);
    }, () => { onChange && onChange(cfgCache); });
}
export const configActual = () => cfgCache;
// Gestiona = gerencia/oficina (admin o quien entra sin rol de obra, p. ej. Sara) o quien está en las listas de compras/inventario.
export function esGestor(usuario, cfg = cfgCache) {
    const roles = usuario.roles || [];
    if (roles.includes('admin')) return true;
    if (!roles.some(r => ['chofer', 'instalador', 'ayudante'].includes(r))) return true;
    const em = (usuario.email || '').toLowerCase();
    return (cfg.compras || []).concat(cfg.inventario || []).map(e => String(e).toLowerCase()).includes(em);
}
export function rolEn(usuario, cfg = cfgCache) {
    const em = (usuario.email || '').toLowerCase(), has = (l) => (l || []).map(e => String(e).toLowerCase()).includes(em);
    return { compras: has(cfg.compras), inventario: has(cfg.inventario), chofer: has(cfg.chofer) };
}

// ---------- suscripción ----------
// Abiertas + cerradas de los últimos 14 días (por `fechaISO`, string ISO → se puede comparar).
export function escucharSolicitudes(onChange) {
    const desde = new Date(Date.now() - 14 * 86400000).toISOString();
    const todas = { abiertas: [], recientes: [] };
    const emitir = () => {
        const m = new Map(); [...todas.abiertas, ...todas.recientes].forEach(s => m.set(s.id, s));
        const arr = [...m.values()].sort((a, b) => (b.fechaISO || '').localeCompare(a.fechaISO || ''));
        onChange(arr);
    };
    const u1 = onSnapshot(query(collection(db, COL), where('estado', 'in', ABIERTOS)), (snap) => { todas.abiertas = snap.docs.map(d => ({ id: d.id, ...d.data() })); emitir(); }, (e) => { console.warn('solicitudes abiertas', e && e.code); onChange([]); });
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
        cantidad: Number(datos.cantidad) || 1, urgencia: URGENCIAS[datos.urgencia] ? datos.urgencia : 'semana',
        nota: (datos.nota || '').trim(), obra: (datos.obra || '').trim(),
        pedidoPor: { nombre: usuario.nombre || '', email: usuario.email || '' },
        fecha: serverTimestamp(), fechaISO: ahoraISO(), sumados: [], atiende: null, precio: null, origenDinero: null, lugarCompra: null,
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
    if (['vista', 'comprando', 'lista', 'entregada', 'rechazada'].includes(estado) && !extra.atiende) cambios.atiende = { nombre: usuario.nombre || '', email: usuario.email || '' };
    await updateDoc(doc(db, COL, id), cambios);
}
export async function guardarGestion(id, usuario, campos) {
    await updateDoc(doc(db, COL, id), { ...campos, historial: arrayUnion(entradaHistorial('nota', usuario, 'Datos de compra actualizados')) });
}
// Entregada + entrada al inventario (si el pedido venía de un ítem del catálogo): suma la cantidad comprada y deja el
// movimiento `restock` como lo hace «Agregar stock» de inventario.html.
export async function darEntradaInventario(s, usuario, cantidad, costoU) {
    if (!s.itemId) throw new Error('Este pedido no está ligado a un ítem del inventario.');
    const n = Number(cantidad) || 0; if (n <= 0) throw new Error('Cantidad inválida');
    const cambios = { cantidad: increment(n) }; if (costoU > 0) cambios.costo = costoU;
    await updateDoc(doc(db, 'inventario', s.itemId), cambios);
    await addDoc(collection(db, 'movimientosInventario'), {
        itemId: s.itemId, itemTipo: s.itemTipo, itemColor: s.itemColor || null, tipo: 'restock', cantidad: n,
        nota: 'Compra por pedido del equipo (' + (s.pedidoPor && s.pedidoPor.nombre || '') + ')' + (s.lugarCompra ? ' · ' + s.lugarCompra : ''),
        costoUnitario: costoU || null, proveedor: s.lugarCompra || null, ncf: null, solicitudId: s.id,
        usuarioNombre: usuario.nombre, usuarioEmail: usuario.email, fecha: serverTimestamp()
    });
    await updateDoc(doc(db, COL, s.id), { entradaInventario: { cantidad: n, costoUnitario: costoU || null, fechaISO: ahoraISO(), por: usuario.nombre || '' } });
}

// ---------- UI compartida: modal «Pedir» ----------
// `getItem(id)` devuelve el ítem del inventario (para el nombre/unidad) o null si es texto libre.
let _usuario = null, _getItem = () => null, _onCreada = null, _matchItem = () => null;
// `matchItem(texto)` (opcional): en el tablero, si el texto libre coincide con un ítem del inventario, se liga a él.
export function montarPedir({ usuario, getItem, onCreada, matchItem }) {
    _usuario = usuario; _getItem = getItem || (() => null); _onCreada = onCreada || null; _matchItem = matchItem || (() => null);
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
            <input type="text" id="sol-unidad" placeholder="unidades, cajas, latas…" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;"></div>
        </div>
        <label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">¿Para cuándo?</label>
        <div id="sol-urg" style="display:flex;flex-direction:column;gap:6px;">${Object.entries(URGENCIAS).map(([k, v], i) => `<label style="display:flex;gap:10px;align-items:center;justify-content:flex-start;font-size:14px;font-weight:normal;margin:0;padding:8px 10px;border:1.5px solid #e3e8ee;border-radius:8px;cursor:pointer;"><input type="radio" name="sol-urg" value="${k}" ${i === 1 ? 'checked' : ''} style="width:18px;height:18px;min-height:0;margin:0;flex:none;"> <span>${v}</span></label>`).join('')}</div>
        <label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">Nota <span style="font-weight:normal;color:#888">(opcional: medida, marca, para qué)</span></label>
        <input type="text" id="sol-nota" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;">
        <label style="display:block;font-size:12.5px;font-weight:bold;margin:8px 0 3px;color:#334;">Obra <span style="font-weight:normal;color:#888">(opcional)</span></label>
        <input type="text" id="sol-obra" placeholder="Solo si es para una obra en concreto" style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;font-family:inherit;">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
          <button type="button" onclick="solCerrarPedir()" style="background:transparent;border:1.5px solid #ddd;color:#888;border-radius:8px;padding:10px 14px;font-family:inherit;font-weight:bold;cursor:pointer;">Cancelar</button>
          <button type="button" id="sol-guardar" onclick="solGuardarPedir()" style="background:#e67e22;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-family:inherit;font-weight:bold;cursor:pointer;">Enviar pedido</button>
        </div>
        <div style="font-size:11.5px;color:#778;margin-top:10px;">La oficina lo ve al instante y lo marca «Visto», «Comprando», «Lista para recoger»… Tú ves el estado en «Mis pedidos».</div>
      </div>
    </div>`);
    let itemSel = null;
    window.solAbrirPedir = (itemId) => {
        itemSel = itemId ? _getItem(itemId) : null;
        document.getElementById('sol-pedir-item').innerHTML = itemSel ? `<b>${esc(itemSel.tipo)}${itemSel.color ? ' — ' + esc(itemSel.color) : ''}</b> <span style="color:#889">· hay ${Number(itemSel.cantidad) || 0} ${esc(itemSel.unidad || '')} en inventario</span>` : '';
        document.getElementById('sol-pedir-libre').style.display = itemSel ? 'none' : 'block';
        document.getElementById('sol-texto').value = ''; document.getElementById('sol-cant').value = 1;
        document.getElementById('sol-unidad').value = itemSel ? (itemSel.unidad || '') : '';
        document.getElementById('sol-nota').value = ''; document.getElementById('sol-obra').value = '';
        const ov = document.getElementById('sol-pedir-ov'); ov.style.display = 'flex';
        setTimeout(() => (itemSel ? document.getElementById('sol-cant') : document.getElementById('sol-texto')).focus(), 50);
    };
    window.solCerrarPedir = () => { document.getElementById('sol-pedir-ov').style.display = 'none'; };
    window.solGuardarPedir = async () => {
        const btn = document.getElementById('sol-guardar'); btn.disabled = true;
        try {
            const urg = (document.querySelector('input[name="sol-urg"]:checked') || {}).value || 'semana';
            if (!itemSel) { const m = _matchItem(document.getElementById('sol-texto').value); if (m) itemSel = m; }
            const id = await crearSolicitud(_usuario, {
                texto: itemSel ? '' : document.getElementById('sol-texto').value,
                itemId: itemSel ? itemSel.id : null, itemTipo: itemSel ? itemSel.tipo : null, itemColor: itemSel ? (itemSel.color || null) : null,
                categoria: itemSel ? (itemSel.categoria || null) : null,
                unidad: document.getElementById('sol-unidad').value, cantidad: document.getElementById('sol-cant').value, urgencia: urg,
                nota: document.getElementById('sol-nota').value, obra: document.getElementById('sol-obra').value
            });
            window.solCerrarPedir(); _onCreada && _onCreada(id);
        } catch (e) { alert(e.message || e); } finally { btn.disabled = false; }
    };
}

// ---------- tarjeta de un pedido (la misma en «Mis pedidos» y en el tablero) ----------
// opts: { usuario, gestor:bool, compacta:bool }
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
    const detalle = [
        s.nota ? `📝 ${esc(s.nota)}` : '', s.obra ? `🏗️ ${esc(s.obra)}` : '',
        s.lugarCompra ? `🛒 ${esc(s.lugarCompra)}` : '', s.precio != null && s.precio !== '' ? `💲 RD$ ${Number(s.precio).toLocaleString('es-DO')}${s.origenDinero ? ' · ' + esc(ORIGEN_DINERO[s.origenDinero] || s.origenDinero) : ''}` : '',
        s.notaGestor ? `🏢 ${esc(s.notaGestor)}` : '', s.estado === 'rechazada' && s.rechazoMotivo ? `✖ Motivo: ${esc(s.rechazoMotivo)}` : '',
        s.entregadaA ? `📬 Entregado a ${esc(s.entregadaA)}` : '', s.entradaInventario ? `📥 Entró al inventario: ${s.entradaInventario.cantidad}` : '',
        s.llevaNombre ? `🚚 Lo lleva ${esc(s.llevaNombre)}` : ''
    ].filter(Boolean).map(t => `<div style="font-size:13px;color:#445;margin-top:3px;">${t}</div>`).join('');
    const urgCol = s.urgencia === 'hoy' ? '#c0392b' : s.urgencia === 'semana' ? '#b9770e' : '#7f8c8d';
    let acciones = '';
    if (abierta) {
        if (!opts.gestor && !mia) acciones += `<button onclick="solSumarse('${s.id}')" style="background:#f0f4f8;color:#0A3D62;border:1.5px solid #cfd8e3;border-radius:8px;padding:8px 12px;font-weight:bold;font-size:13px;font-family:inherit;cursor:pointer;">➕ Yo también lo necesito</button>`;
        if (mia && s.estado === 'pedida') acciones += `<button onclick="solCancelar('${s.id}')" style="background:transparent;color:#888;border:1.5px solid #ddd;border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;cursor:pointer;">Ya no hace falta</button>`;
        if (opts.gestor) acciones += gestorAccionesHTML(s);
    }
    return `<div class="sol-card" id="sol-${s.id}" style="background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.06);padding:12px 14px;border-left:6px solid ${color};margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
            <div><b style="color:#0A3D62;font-size:15px;">${esc(nombreDe(s))}</b> <span style="font-size:14px;color:#223;">× ${esc(cantidadTxt(s))}</span>${s.itemId ? '' : ' <span style="font-size:11px;color:#889;border:1px solid #dde;border-radius:6px;padding:1px 5px;">no está en inventario</span>'}</div>
            <span style="font-size:12px;font-weight:bold;color:${urgCol};white-space:nowrap;">${esc(URGENCIA_CORTA[s.urgencia] || '')}</span>
        </div>
        <div style="font-size:12.5px;color:#667;margin-top:3px;">${mia ? 'Pediste tú' : 'Pidió ' + esc(quien)}${sum} · ${esc(fechaCorta(s.fechaISO))}</div>
        <div style="margin-top:6px;">${estadoLinea}</div>
        ${detalle}
        ${acciones ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">${acciones}</div>` : ''}
        <div id="sol-form-${s.id}"></div>
    </div>`;
}
function gestorAccionesHTML(s) {
    const b = (txt, fn, bg) => `<button onclick="${fn}" style="background:${bg};color:#fff;border:none;border-radius:8px;padding:8px 12px;font-weight:bold;font-size:13px;font-family:inherit;cursor:pointer;">${txt}</button>`;
    let h = '';
    if (s.estado === 'pedida') h += b('👀 Visto', `solEstado('${s.id}','vista')`, '#2980b9');
    if (['pedida', 'vista'].includes(s.estado)) h += b('🛒 Comprando', `solEstado('${s.id}','comprando')`, '#8e44ad');
    if (['pedida', 'vista', 'comprando'].includes(s.estado)) h += b('📦 Lista para recoger', `solForm('${s.id}','lista')`, '#16a085');
    if (s.estado !== 'entregada') h += b('✅ Entregada', `solForm('${s.id}','entregada')`, '#27ae60');
    if (['pedida', 'vista'].includes(s.estado)) h += b('✖ No se compra', `solForm('${s.id}','rechazada')`, '#c0392b');
    h += `<button onclick="solForm('${s.id}','datos')" style="background:#f0f4f8;color:#0A3D62;border:1.5px solid #cfd8e3;border-radius:8px;padding:8px 12px;font-weight:bold;font-size:13px;font-family:inherit;cursor:pointer;">💲 Precio / dónde</button>`;
    return h;
}

// Handlers del tablero y de «Mis pedidos». `getSolicitud(id)` devuelve el doc en caché. `choferes` = [{email,nombre}] para «¿quién lo lleva?».
export function montarAcciones({ usuario, getSolicitud, getChoferes }) {
    const inp = (id, ph, type = 'text', val = '') => `<input type="${type}" id="${id}" placeholder="${esc(ph)}" value="${esc(val)}" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;">`;
    const sel = (id, opciones, val) => `<select id="${id}" style="width:100%;box-sizing:border-box;padding:9px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;background:#fff;">${opciones.map(([v, t]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const caja = (id, inner, okTxt, okFn, okBg) => `<div style="background:#f6f8fa;border-radius:10px;padding:10px 12px;margin-top:10px;display:grid;gap:8px;">${inner}
        <div style="display:flex;gap:8px;justify-content:flex-end;"><button onclick="document.getElementById('sol-form-${id}').innerHTML=''" style="background:transparent;border:1.5px solid #ddd;color:#888;border-radius:8px;padding:8px 12px;font-family:inherit;font-weight:bold;cursor:pointer;">Cancelar</button>
        <button onclick="${okFn}" style="background:${okBg};color:#fff;border:none;border-radius:8px;padding:8px 14px;font-family:inherit;font-weight:bold;cursor:pointer;">${okTxt}</button></div></div>`;
    window.solSumarse = async (id) => {
        const n = prompt('¿Cuántos necesitas tú? (se suman al pedido)', '1'); if (n == null) return;
        try { await sumarse(id, usuario, n); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solCancelar = async (id) => {
        if (!confirm('¿Cancelar este pedido?')) return;
        try { await cambiarEstado(id, 'cancelada', usuario, {}, 'Cancelado por quien lo pidió'); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solEstado = async (id, estado) => {
        try { await cambiarEstado(id, estado, usuario); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solForm = (id, tipo) => {
        const s = getSolicitud(id); if (!s) return; const box = document.getElementById('sol-form-' + id); if (!box) return;
        const lugares = LUGARES.map(l => [l, l]);
        if (tipo === 'lista') {
            const chs = (getChoferes ? getChoferes() : []).map(c => [c.email, c.nombre]);
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">📦 Lista para recoger</div>
                <label style="font-size:12px;">¿Dónde está?</label>${sel('sf-lugar-' + id, [['', '— elegir —'], ...lugares], s.lugarCompra || '')}
                ${chs.length ? `<label style="font-size:12px;">¿Quién lo lleva? (opcional, le avisa)</label>${sel('sf-lleva-' + id, [['', 'Lo recoge quien lo pidió'], ...chs], '')}` : ''}
                <label style="font-size:12px;">Nota para el equipo (opcional)</label>${inp('sf-nota-' + id, 'Ej: está en la oficina, en la caja azul')}`,
                'Marcar lista', `solOkLista('${id}')`, '#16a085');
        } else if (tipo === 'entregada') {
            const conInv = !!s.itemId;
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">✅ Entregada</div>
                <label style="font-size:12px;">¿A quién se le entregó?</label>${inp('sf-a-' + id, 'Nombre', 'text', s.pedidoPor ? s.pedidoPor.nombre : '')}
                ${conInv ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;"><input type="checkbox" id="sf-inv-${id}" checked> Dar entrada al inventario (${esc(nombreDe(s))})</label>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><label style="font-size:12px;">Cantidad que entra</label>${inp('sf-invcant-' + id, '', 'number', String(Number(s.cantidad) || 1))}</div><div><label style="font-size:12px;">Costo por ${esc(s.unidad || 'unidad')} (opcional)</label>${inp('sf-invcosto-' + id, '0', 'number', '')}</div></div>
                <div style="font-size:11.5px;color:#778;">Si lo que compraste va directo a la obra y no al almacén, desmarca la casilla.</div>` : `<div style="font-size:11.5px;color:#778;">Este pedido no está ligado a un ítem del inventario. Si debe quedar en stock, créalo en Inventario y dale entrada ahí.</div>`}`,
                'Confirmar entrega', `solOkEntregada('${id}')`, '#27ae60');
        } else if (tipo === 'rechazada') {
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#c0392b;">✖ No se compra</div>
                <label style="font-size:12px;">Motivo (lo ve quien lo pidió)</label>${inp('sf-motivo-' + id, 'Ej: ya hay uno en el bulto del equipo 2 / se compra con el próximo pedido grande')}`,
                'Confirmar', `solOkRechazada('${id}')`, '#c0392b');
        } else if (tipo === 'datos') {
            box.innerHTML = caja(id, `<div style="font-size:13px;font-weight:bold;color:#0A3D62;">💲 Precio y lugar de compra (opcional)</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><div><label style="font-size:12px;">Precio pagado (RD$)</label>${inp('sf-precio-' + id, '0', 'number', s.precio != null ? String(s.precio) : '')}</div>
                <div><label style="font-size:12px;">De dónde salió</label>${sel('sf-origen-' + id, [['', '—'], ...Object.entries(ORIGEN_DINERO)], s.origenDinero || '')}</div></div>
                <label style="font-size:12px;">Dónde se compró</label>${sel('sf-lugar2-' + id, [['', '— elegir —'], ...lugares], s.lugarCompra || '')}
                <label style="font-size:12px;">Nota de la oficina (opcional)</label>${inp('sf-ng-' + id, 'Ej: pedido al proveedor, llega el martes', 'text', s.notaGestor || '')}`,
                'Guardar', `solOkDatos('${id}')`, '#0A3D62');
        }
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    window.solOkLista = async (id) => {
        const lleva = v('sf-lleva-' + id), ch = (getChoferes ? getChoferes() : []).find(c => c.email === lleva);
        try { await cambiarEstado(id, 'lista', usuario, { lugarCompra: v('sf-lugar-' + id) || null, notaGestor: v('sf-nota-' + id) || null, llevaEmail: ch ? ch.email : null, llevaNombre: ch ? ch.nombre : null }, v('sf-nota-' + id)); }
        catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solOkEntregada = async (id) => {
        const s = getSolicitud(id); if (!s) return;
        const chk = document.getElementById('sf-inv-' + id);
        try {
            if (chk && chk.checked) await darEntradaInventario(s, usuario, v('sf-invcant-' + id), Number(v('sf-invcosto-' + id)) || 0);
            await cambiarEstado(id, 'entregada', usuario, { entregadaA: v('sf-a-' + id) || null });
        } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solOkRechazada = async (id) => {
        const m = (v('sf-motivo-' + id) || '').trim(); if (!m) { alert('Escribe el motivo: quien pidió tiene que entenderlo.'); return; }
        try { await cambiarEstado(id, 'rechazada', usuario, { rechazoMotivo: m }, m); } catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
    window.solOkDatos = async (id) => {
        const p = v('sf-precio-' + id);
        try { await guardarGestion(id, usuario, { precio: p === '' ? null : Number(p), origenDinero: v('sf-origen-' + id) || null, lugarCompra: v('sf-lugar2-' + id) || null, notaGestor: v('sf-ng-' + id) || null }); document.getElementById('sol-form-' + id).innerHTML = ''; }
        catch (e) { alert('No se pudo: ' + (e.message || e)); }
    };
}

// ---------- lista de compras (texto para copiar / WhatsApp) ----------
export function listaDeComprasTxt(solicitudes) {
    const pend = solicitudes.filter(s => ['pedida', 'vista', 'comprando'].includes(s.estado));
    if (!pend.length) return 'No hay nada pendiente de comprar.';
    const grupos = {}; pend.forEach(s => { const k = s.lugarCompra || 'Sin lugar definido'; (grupos[k] = grupos[k] || []).push(s); });
    const orden = { hoy: 0, semana: 1, cuando: 2 };
    const lineas = ['🛒 LISTA DE COMPRAS ARTAL — ' + new Date().toLocaleDateString('es-DO', { day: 'numeric', month: 'long' }), ''];
    Object.entries(grupos).forEach(([lugar, arr]) => {
        lineas.push('📍 ' + lugar.toUpperCase());
        arr.sort((a, b) => (orden[a.urgencia] ?? 1) - (orden[b.urgencia] ?? 1)).forEach(s => {
            lineas.push(`${s.urgencia === 'hoy' ? '🔥' : '•'} ${nombreDe(s)} × ${cantidadTxt(s)}${s.nota ? ' (' + s.nota + ')' : ''} — ${s.pedidoPor ? s.pedidoPor.nombre : ''}${s.obra ? ' · ' + s.obra : ''}`);
        });
        lineas.push('');
    });
    return lineas.join('\n').trim();
}
export { esc as escSol, getDoc as _getDoc };
