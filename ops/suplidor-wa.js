// Enviar un pedido de fábrica interna a un SUPLIDOR / contratista por WhatsApp (Dylan 2026-10-29).
//
// - La lista de suplidores vive en `rrhhConfig/contratistasExternos.lista[]` (la misma de Delvis, 2026-10-06): cada entrada
//   {id, nombre, empresa, telefono, especialidad, activo, instala, desde}. `instala !== false` = aparece también como
//   instalador asignable (Fábrica interna / Historial); un suplidor que solo fabrica o vende (vidrio, tubos…) lleva
//   `instala:false`. Lectura: roles operativos (regla general de rrhhConfig); escritura: solo admin (`esAdmin()`).
// - El mensaje se arma SOLO con datos de fabricación: cliente de referencia, obra, ítems (ref, tipo, ubicación, medidas,
//   cantidad), material/acabado/vidrio del encabezado, fecha estimada de salida y el enlace a la ficha. NUNCA teléfono/RNC
//   del cliente, precios ni anticipo (regla literal del usuario). Si el pedido es una PARTE de la hoja (`fichaParcial`),
//   se dice en el mensaje.
// - WhatsApp se abre con `wa.me/<tel>?text=…` en pestaña nueva: el texto queda listo pero HAY QUE TOCAR «Enviar» allí.
//   La plataforma no manda nada sola. El envío se anota en `orders.enviadoASuplidor[]` (ISO, no serverTimestamp: va dentro
//   de un array) y la tarjeta muestra el chip «📲 Enviado a X el dd/mm».
import { db } from './firebase-config.js';
import { doc, setDoc, updateDoc, onSnapshot, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { rootPath } from './paths.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export let suplidores = [];          // lista completa (activos e inactivos), tal cual Firestore
export function suplidoresActivos() { return suplidores.filter(s => s && s.activo !== false); }

// Teléfono → dígitos para wa.me: «+1 (809) 204-4903» → 18092044903; 10 dígitos de RD → se antepone el 1.
export function telWa(t) {
    let d = String(t || '').replace(/\D/g, '');
    if (d.length === 10) d = '1' + d;
    return d.length >= 11 ? d : '';
}

export function escucharSuplidores(onChange) {
    return onSnapshot(doc(db, 'rrhhConfig', 'contratistasExternos'), (s) => {
        suplidores = (s.exists() && Array.isArray(s.data().lista)) ? s.data().lista.filter(Boolean) : [];
        if (onChange) onChange(suplidores);
    }, () => { });
}

const fmt = (n) => (n == null || n === '' || isNaN(Number(n))) ? '?' : String(Math.round(Number(n)));
const fechaCorta = (ymd) => ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' }) : '';

// URL absoluta de la ficha (index.html?orderId=…), calculada desde la página actual (GitHub Pages en producción).
export function urlFicha(id) {
    return new URL(rootPath('index.html') + '?orderId=' + encodeURIComponent(id), location.href).href;
}

// Ítems del pedido con su referencia: `order.items` trae tipo/ubicación/medidas/cantidad y `appJSON.inputsData[id].ref` la
// referencia (PV1, S1…) que el cuaderno escribe por tarjeta.
export function itemsDelPedido(o) {
    const aj = o.appJSON || {};
    const inp = aj.inputsData || {};
    const cs = aj.cardsState || {};
    const items = Array.isArray(o.items) && o.items.length ? o.items : Object.keys(cs).map(k => ({ id: k, tipo: cs[k].label || cs[k].type, ubicacion: '', ancho: cs[k].ancho, alto: cs[k].alto, cantidad: cs[k].cantidad }));
    return items.map(it => {
        const i = inp[it.id] || {};
        const c = cs[it.id] || {};
        return {
            ref: i.ref || '',
            tipo: it.tipo || c.label || c.type || 'Ítem',
            ubicacion: it.ubicacion || i.ubi || '',
            ancho: it.ancho != null ? it.ancho : c.ancho,
            alto: it.alto != null ? it.alto : c.alto,
            cantidad: it.cantidad != null ? it.cantidad : (c.cantidad || 1),
            vidrio: c.vidrio ? [c.vidrio, c.espesor].filter(Boolean).join(' ') : ''
        };
    });
}

export function armarMensajeSuplidor(id, o, sup) {
    const h = (o.appJSON && o.appJSON.header) || {};
    const L = [];
    L.push(`Hola${sup && sup.nombre ? ' ' + sup.nombre : ''}, te paso un pedido de fabricación de ARTAL Dominicana:`);
    L.push('');
    L.push(`*Cliente (referencia):* ${o.cliente || '—'}`);
    L.push(`*Obra:* ${o.obra || '—'}${h.ubicacion ? ' · ' + h.ubicacion : ''}`);
    if (o.fichaParcial && o.fichaParcial.total > o.fichaParcial.enviados) {
        L.push(`⚠ Este pedido es *una parte* de la hoja de la obra (${o.fichaParcial.enviados} de ${o.fichaParcial.total} ítems); el resto va aparte.`);
    }
    const mat = [o.material || h.material, o.color || h.color].filter(Boolean).join(' · ');
    if (mat) L.push(`*Material y acabado:* ${mat}`);
    if (h.vidrio) L.push(`*Vidrio:* ${h.vidrio}`);
    L.push('');
    const its = itemsDelPedido(o);
    L.push(`*Ítems (${its.reduce((s, x) => s + (Number(x.cantidad) || 1), 0)} pzas, medidas en mm):*`);
    its.forEach((it, n) => {
        const partes = [];
        partes.push(`${n + 1}. ${it.ref ? it.ref + ' · ' : ''}${it.tipo}`);
        if (it.ubicacion) partes.push(it.ubicacion);
        partes.push(`${fmt(it.ancho)} × ${fmt(it.alto)} mm`);
        partes.push(`cant. ${it.cantidad || 1}`);
        if (it.vidrio && !h.vidrio) partes.push('vidrio ' + it.vidrio);
        L.push(partes.join(' — '));
    });
    L.push('');
    if (o.fechaSalidaEstimada) L.push(`*Fecha estimada de salida:* ${fechaCorta(o.fechaSalidaEstimada)}`);
    if (o.comentarioParaFabrica && !o.comentarioParaFabricaAtendido) L.push(`*Nota de la oficina:* ${o.comentarioParaFabrica}`);
    L.push(`*Ficha completa con dibujos:* ${urlFicha(id)}`);
    L.push('');
    L.push('Cualquier duda sobre medidas o detalles, escríbenos por aquí. Gracias.');
    return L.join('\n');
}

export function ultimoEnvio(o) {
    const l = Array.isArray(o.enviadoASuplidor) ? o.enviadoASuplidor : [];
    return l.length ? l[l.length - 1] : null;
}
const dmy = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }); };

export function enviadoChipHTML(o) {
    const l = Array.isArray(o.enviadoASuplidor) ? o.enviadoASuplidor : [];
    if (!l.length) return '';
    // un chip por suplidor (el envío más reciente de cada uno)
    const porSup = {};
    l.forEach(e => { porSup[e.proveedorId || e.nombre] = e; });
    return Object.values(porSup).map(e => `<span title="Enviado por ${esc(e.por || '')}${l.filter(x => (x.proveedorId || x.nombre) === (e.proveedorId || e.nombre)).length > 1 ? ' · reenviado' : ''}" style="background:#e8f8ee;color:#1e7e4a;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:bold;display:inline-block;">📲 Enviado a ${esc(e.nombre)} el ${dmy(e.fecha)}</span>`).join(' ');
}

// Bloque de la tarjeta: botón + desplegable (solo suplidores activos con teléfono) + aclaración.
export function suplidorBotonHTML(id, o) {
    const act = suplidoresActivos();
    const conTel = act.filter(s => telWa(s.telefono));
    const sinTel = act.filter(s => !telWa(s.telefono));
    const chip = enviadoChipHTML(o);
    const opts = conTel.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}${s.empresa ? ' · ' + esc(s.empresa) : ''}${s.especialidad ? ' (' + esc(s.especialidad) + ')' : ''}</option>`).join('')
        + sinTel.map(s => `<option value="" disabled>${esc(s.nombre)} — sin teléfono (ponlo en ⚙️ Suplidores)</option>`).join('');
    return `<div style="margin-top:8px;background:#f0fbf4;border:1.5px solid #bfe7cd;border-radius:9px;padding:8px 11px;">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button onclick="supToggle('${id}')" style="background:#25D366;color:#fff;border:none;border-radius:7px;padding:8px 12px;font-weight:bold;font-family:'Arimo';font-size:13px;cursor:pointer;">📲 ${chip ? 'Reenviar' : 'Enviar'} a suplidor por WhatsApp</button>
            ${chip}
        </div>
        <div id="sup-form-${id}" style="display:none;margin-top:8px;">
            ${conTel.length || sinTel.length ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="sup-sel-${id}" style="flex:1;min-width:200px;padding:8px;border:1.5px solid #ddd;border-radius:7px;font-family:'Arimo';font-size:13px;">${opts}</select>
                <button onclick="supPrevia('${id}')" style="background:#fff;color:#1e7e4a;border:1.5px solid #1e7e4a;border-radius:7px;padding:7px 11px;font-weight:bold;font-family:'Arimo';font-size:12.5px;cursor:pointer;">👁 Ver mensaje</button>
                <button onclick="supEnviar('${id}')" ${conTel.length ? '' : 'disabled'} style="background:#25D366;color:#fff;border:none;border-radius:7px;padding:8px 12px;font-weight:bold;font-family:'Arimo';font-size:13px;cursor:pointer;">Abrir WhatsApp con el pedido</button>
            </div>` : `<div style="font-size:13px;color:#8a6d00;background:#fff8e1;border-radius:7px;padding:7px 10px;">No hay suplidores con teléfono todavía. Agrégalos en «⚙️ Suplidores y contratistas externos» (arriba, solo gerencia).</div>`}
            <pre id="sup-previa-${id}" style="display:none;white-space:pre-wrap;font-family:'Arimo';font-size:12.5px;background:#fff;border:1px solid #dfe8e2;border-radius:7px;padding:8px 10px;margin:8px 0 0;max-height:260px;overflow:auto;"></pre>
            <div style="font-size:12px;color:#556;margin-top:6px;">WhatsApp se abre en otra pestaña con el texto ya escrito: <b>revísalo y toca Enviar allí</b> (la plataforma no manda nada sola). El mensaje lleva cliente de referencia, obra, ítems con medidas, material/acabado, fecha de salida y el enlace a la ficha; <b>nunca</b> teléfono del cliente, precios ni anticipo. El enlace de la ficha solo abre con una cuenta de la plataforma: si el suplidor no tiene, mándale el PDF de la hoja aparte.</div>
        </div>
    </div>`;
}

// Handlers globales. `getOrder(id)` devuelve los datos del pedido desde el caché de la página; `usuario` para dejar
// constancia de quién envió. Se registran una sola vez por página.
export function montarSuplidorWA({ getOrder, usuario }) {
    window.supToggle = (id) => { const f = document.getElementById('sup-form-' + id); if (f) f.style.display = f.style.display === 'none' ? 'block' : 'none'; };
    const supDe = (id) => { const sel = document.getElementById('sup-sel-' + id); return sel && sel.value ? suplidores.find(s => s.id === sel.value) : null; };
    window.supPrevia = (id) => {
        const o = getOrder(id); if (!o) return;
        const pre = document.getElementById('sup-previa-' + id);
        pre.textContent = armarMensajeSuplidor(id, o, supDe(id));
        pre.style.display = pre.style.display === 'none' ? 'block' : 'none';
    };
    window.supEnviar = async (id) => {
        const o = getOrder(id); if (!o) return;
        const sup = supDe(id);
        if (!sup) { alert('Elige un suplidor con teléfono.'); return; }
        const tel = telWa(sup.telefono);
        if (!tel) { alert('Ese suplidor no tiene teléfono válido. Ponlo en «⚙️ Suplidores y contratistas externos».'); return; }
        const texto = armarMensajeSuplidor(id, o, sup);
        const url = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(texto);
        const w = window.open(url, '_blank', 'noopener');
        if (!w) { alert('El navegador bloqueó la pestaña de WhatsApp. Permite ventanas emergentes para esta página y vuelve a intentar.'); return; }
        try {
            await updateDoc(doc(db, 'orders', id), {
                enviadoASuplidor: arrayUnion({ proveedorId: sup.id, nombre: sup.nombre + (sup.empresa ? ' (' + sup.empresa + ')' : ''), fecha: new Date().toISOString(), por: (usuario && usuario.nombre) || '' })
            });
        } catch (e) { alert('WhatsApp se abrió, pero no se pudo anotar el envío en el pedido: ' + e.message); }
    };
}

// ─── Gestión de la lista (solo admin: la regla de rrhhConfig lo exige) ───────────────────────────────────────────────
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('sup-' + Date.now().toString(36));

export function suplidoresAdminHTML() {
    const filas = suplidores.map((s, i) => `<tr style="${s.activo === false ? 'opacity:.55' : ''}">
        <td><input data-i="${i}" data-k="nombre" value="${esc(s.nombre)}" style="width:120px"></td>
        <td><input data-i="${i}" data-k="empresa" value="${esc(s.empresa)}" style="width:130px"></td>
        <td><input data-i="${i}" data-k="telefono" value="${esc(s.telefono)}" placeholder="+1 (809) 000-0000" style="width:150px" ${telWa(s.telefono) || !s.telefono ? '' : 'title="Teléfono incompleto"'}></td>
        <td><input data-i="${i}" data-k="especialidad" value="${esc(s.especialidad)}" placeholder="vidrio, shutters…" style="width:150px"></td>
        <td style="text-align:center"><input type="checkbox" data-i="${i}" data-k="instala" ${s.instala !== false ? 'checked' : ''} title="También instala (aparece como instalador asignable)"></td>
        <td style="text-align:center"><input type="checkbox" data-i="${i}" data-k="activo" ${s.activo !== false ? 'checked' : ''}></td>
    </tr>`).join('');
    return `<details id="sup-admin" style="margin:0 0 14px;background:#fff;border:1.5px solid #dde3ea;border-radius:12px;padding:10px 14px;">
        <summary style="cursor:pointer;font-weight:bold;color:#0A3D62;font-size:14px;">⚙️ Suplidores y contratistas externos <span style="font-weight:normal;color:#667;font-size:12.5px;">(${suplidoresActivos().length} activos · a quién se le manda el pedido por WhatsApp; solo gerencia edita)</span></summary>
        <div style="overflow:auto;margin-top:8px;">
        <table style="border-collapse:collapse;font-size:13px;min-width:720px;" id="sup-tabla">
            <thead><tr style="color:#667;font-size:12px;text-align:left;"><th>Nombre</th><th>Empresa</th><th>Teléfono (WhatsApp)</th><th>Especialidad</th><th>¿Instala?</th><th>Activo</th></tr></thead>
            <tbody>${filas || '<tr><td colspan="6" style="color:#889;padding:6px;">Sin suplidores todavía.</td></tr>'}</tbody>
        </table></div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center;">
            <button onclick="supAdminAgregar()" style="background:#fff;color:#0A3D62;border:1.5px solid #0A3D62;border-radius:7px;padding:7px 11px;font-weight:bold;font-family:'Arimo';font-size:12.5px;cursor:pointer;">➕ Agregar suplidor</button>
            <button onclick="supAdminGuardar()" style="background:#0A3D62;color:#fff;border:none;border-radius:7px;padding:8px 12px;font-weight:bold;font-family:'Arimo';font-size:13px;cursor:pointer;">Guardar lista</button>
            <span style="font-size:12px;color:#667;">«¿Instala?» marcado = aparece también como instalador asignable (p. ej. Delvis). Un suplidor de vidrio o tubos va sin marcar. Desmarcar «Activo» lo esconde sin borrar el historial.</span>
        </div>
    </details>`;
}

export function montarSuplidoresAdmin({ contenedorId, usuario }) {
    const pintar = () => { const c = document.getElementById(contenedorId); if (!c) return; const abierto = c.querySelector('#sup-admin') && c.querySelector('#sup-admin').open; c.innerHTML = suplidoresAdminHTML(); if (abierto) c.querySelector('#sup-admin').open = true; };
    const leerTabla = () => {
        const out = suplidores.map(s => ({ ...s }));
        document.querySelectorAll('#sup-tabla [data-i]').forEach(el => {
            const i = Number(el.dataset.i), k = el.dataset.k;
            if (!out[i]) return;
            out[i][k] = el.type === 'checkbox' ? el.checked : el.value.trim();
        });
        return out;
    };
    window.supAdminAgregar = () => {
        suplidores = leerTabla();
        suplidores.push({ id: '', nombre: '', empresa: '', telefono: '', especialidad: '', activo: true, instala: false, desde: new Date().toISOString().slice(0, 10) });
        pintar(); const d = document.getElementById('sup-admin'); if (d) d.open = true;
        const ult = document.querySelector('#sup-tabla tbody tr:last-child input'); if (ult) ult.focus();
    };
    window.supAdminGuardar = async () => {
        const lista = leerTabla().filter(s => s.nombre).map(s => {
            if (!s.id) s.id = slug(s.nombre);
            if (s.telefono && !telWa(s.telefono)) throw0(`Teléfono de ${s.nombre} incompleto: escribe los 10 dígitos (p. ej. +1 (809) 204-4903).`);
            return s;
        });
        const ids = lista.map(s => s.id); if (new Set(ids).size !== ids.length) { alert('Hay dos suplidores con el mismo nombre; cámbiale el nombre a uno.'); return; }
        try {
            await setDoc(doc(db, 'rrhhConfig', 'contratistasExternos'), { lista, actualizado: new Date().toISOString(), actualizadoPor: (usuario && usuario.nombre) || '' }, { merge: true });
            alert('Lista de suplidores guardada.');
        } catch (e) { alert('No se pudo guardar (solo gerencia puede editar esta lista): ' + e.message); }
    };
    function throw0(m) { alert(m); throw new Error(m); }
    return pintar;
}
