// Caja «Anticipo / Pago completo» de un pedido (solo gerencia/admin). Una sola implementación para cotizaciones.html,
// historial.html y fabrica-interna.html (antes cada una tenía su copia; Fábrica interna escribía el anticipo directo
// con updateDoc, saltándose la regla B1–B4). ÚNICA vía de escritura: la Cloud Function `anticipoPedido`.
//
// `anticipo` del pedido (lo escribe el servidor desde `anticipos[]`): { recibido, tipo:'anticipo'|'completo' (sin campo =
// anticipo), monto, moneda, fecha, nota, formaPago, facturaCitrus, validadoPor… }. Dylan 2026-10-27: hay clientes que pagan
// todo desde el inicio y Anny lo registra en Citrus como FACTURA AL CONTADO (no como anticipo), así que la sincronización
// de anticipos nunca lo trae: se marca a mano como «Pago completo», con forma de pago y nº de factura, y una misma factura
// puede cubrir varios pedidos del mismo cliente (caso Niza: ventanas + shutters, factura contado 290).
import { auth } from './firebase-config.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fRD = (n, m) => (m || 'RD$') + ' ' + Number(n || 0).toLocaleString('es-DO');
const hoyISO = () => new Date().toISOString().slice(0, 10);
export const FORMAS_PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', tarjeta: 'Tarjeta' };
export const ABIERTOS_ANTICIPO = ['solicitada', 'costeada', 'enviada_cliente', 'pendiente_fabrica', 'en_fabrica', 'parcialmente_listo', 'listo_para_cargar', 'parcialmente_instalado'];
const normNombre = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

export async function anticipoPedidoFn(body) {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch('https://us-central1-artal-operaciones.cloudfunctions.net/anticipoPedido', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status)); return j;
}

// Texto corto del estado de pago (chips de Fábrica interna / Historial, Panel): '' si no hay nada marcado.
export function anticipoResumen(a) {
    if (!a || !a.recibido) return '';
    if (a.tipo === 'completo') return '💵 Pagado completo' + (a.facturaCitrus ? ' · fact. ' + a.facturaCitrus : '') + (a.monto ? ' · ' + fRD(a.monto, a.moneda) : '');
    return '💰 Anticipo recibido' + (a.monto ? ' · ' + fRD(a.monto, a.moneda) : '');
}
// Chip redondo (Fábrica interna lo usa en pedidos ya completados; `sinValidar` muestra el amarillo cuando no hay nada).
export function anticipoChipHTML(o, { sinValidar = true } = {}) {
    const a = o.anticipo || null;
    if (a && a.recibido) {
        const completo = a.tipo === 'completo';
        return `<span style="background:${completo ? '#e3f2fd' : '#e9f7ef'};color:${completo ? '#0d47a1' : '#1e8449'};border-radius:999px;padding:3px 10px;font-size:12px;font-weight:bold;" title="${esc(a.nota || '')}">${esc(anticipoResumen(a))}${a.fecha ? ' · ' + esc(a.fecha.slice(5).split('-').reverse().join('/')) : ''}</span>`;
    }
    if (!sinValidar) return '';
    return `<span style="background:#fff8e1;color:#8a6d00;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:bold;" title="La oficina no ha marcado el pago (Cotizaciones o Historial)">💰 Anticipo sin validar</span>`;
}

// ¿Dos pedidos son del mismo cliente? Misma ficha (clienteId) o mismo nombre de cliente normalizado.
export function mismoCliente(a, b) {
    if (a.clienteId && b.clienteId && a.clienteId === b.clienteId) return true;
    const na = normNombre(a.cliente), nb = normNombre(b.cliente);
    return !!na && na === nb;
}

// pedidosDelCliente(id, o) → [{ id, cliente, obra, docType, status, anticipo }] abiertos del mismo cliente, sin el propio ni compras.
export function montarAnticipoUI({ pedidosDelCliente }) {
    const otrosDe = (id, o) => (pedidosDelCliente ? pedidosDelCliente(id, o) : []).filter((p) => p && p.id !== id && p.docType !== 'COMPRA_DIRECTA' && ABIERTOS_ANTICIPO.includes(p.status) && mismoCliente(o, p));
    const inp = 'padding:7px;border:1.5px solid #ddd;border-radius:7px;font-family:\'Arimo\';font-size:13px;';

    function anticipoHTML(id, o) {
        const a = o.anticipo || null;
        if (a && a.recibido) {
            const completo = a.tipo === 'completo';
            return `<div style="margin-top:8px;background:${completo ? '#e3f2fd' : '#e9f7ef'};border:1.5px solid ${completo ? '#90caf9' : '#a9dfbf'};border-radius:9px;padding:8px 11px;font-size:13px;color:${completo ? '#0d47a1' : '#1e8449'};">
                <b>${esc(anticipoResumen(a))}</b>${completo && a.formaPago ? ' · ' + esc(FORMAS_PAGO[a.formaPago] || a.formaPago) : ''}${a.fecha ? ' · ' + esc(a.fecha) : ''}${a.validadoPor ? ' · validó ' + esc(a.validadoPor) : ''}${a.nota ? '<br><span style="color:#556">' + esc(a.nota) + '</span>' : ''}
                <a href="#" onclick="anticipoQuitar('${id}');return false;" style="margin-left:8px;color:#c0392b;font-size:12px;">quitar</a></div>`;
        }
        const otros = otrosDe(id, o);
        return `<div style="margin-top:8px;background:#fff8e1;border:1.5px solid #f6d365;border-radius:9px;padding:8px 11px;font-size:13px;">
            <span style="font-weight:bold;color:#8a6d00;">💰 Pago del cliente: <span style="color:#c0392b">sin validar</span></span>
            <button onclick="const f=document.getElementById('antic-form-${id}');f.style.display=f.style.display==='block'?'none':'block';" style="margin-left:8px;background:#fff;color:#8a6d00;border:1.5px solid #f6d365;border-radius:7px;padding:5px 9px;font-weight:bold;font-family:'Arimo';font-size:12px;cursor:pointer;">✓ Marcar pago recibido</button>
            <div id="antic-form-${id}" style="display:none;margin-top:8px;">
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                    <select id="antic-tipo-${id}" onchange="anticipoTipoCambio('${id}')" style="${inp}font-weight:bold;"><option value="anticipo">Anticipo</option><option value="completo">Pago completo</option></select>
                    <input type="number" id="antic-monto-${id}" placeholder="Monto" min="0" step="0.01" style="${inp}width:120px;">
                    <select id="antic-moneda-${id}" style="${inp}"><option>RD$</option><option>US$</option><option>€</option></select>
                    <input type="date" id="antic-fecha-${id}" value="${hoyISO()}" style="${inp}">
                </div>
                <div id="antic-completo-${id}" style="display:none;margin-top:6px;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        <select id="antic-forma-${id}" style="${inp}"><option value="">Forma de pago…</option>${Object.entries(FORMAS_PAGO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
                        <input type="text" id="antic-factura-${id}" placeholder="Nº factura Citrus (ej. contado 290)" style="${inp}min-width:220px;">
                    </div>
                    ${otros.length ? `<div style="margin-top:6px;font-size:12.5px;color:#556;">La misma factura también cubre:</div>
                    <div id="antic-otros-${id}" style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">${otros.map((p) => `<label style="display:flex;gap:6px;align-items:center;font-size:12.5px;"><input type="checkbox" value="${esc(p.id)}"> <span>${esc(p.obra || p.id)} <span style="color:#889">(${String(p.docType || '').indexOf('FAB') === 0 ? 'Fabricación' : 'Cotización'})</span></span> <input type="number" data-oid="${esc(p.id)}" placeholder="monto (opcional)" min="0" step="0.01" style="${inp}width:130px;padding:4px 6px;"></label>`).join('')}</div>
                    <div style="font-size:11.5px;color:#889;margin-top:3px;">Sin monto por pedido = «incluido en la factura».</div>` : ''}
                </div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;">
                    <input type="text" id="antic-nota-${id}" placeholder="Nota (nº recibo, observación…)" style="${inp}flex:1;min-width:160px;">
                    <button onclick="anticipoGuardar('${id}')" style="background:#1e8449;color:#fff;border:none;border-radius:7px;padding:8px 12px;font-weight:bold;font-family:'Arimo';font-size:13px;cursor:pointer;">Guardar</button>
                </div>
            </div></div>`;
    }

    window.anticipoTipoCambio = function (id) {
        const t = (document.getElementById('antic-tipo-' + id) || {}).value || 'anticipo';
        const box = document.getElementById('antic-completo-' + id); if (box) box.style.display = t === 'completo' ? 'block' : 'none';
        const m = document.getElementById('antic-monto-' + id); if (m) m.placeholder = t === 'completo' ? 'Monto de este pedido' : 'Monto';
    };
    window.anticipoGuardar = async function (id) {
        const v = (k) => ((document.getElementById('antic-' + k + '-' + id) || {}).value || '').trim();
        const tipo = v('tipo') === 'completo' ? 'completo' : 'anticipo';
        const monto = parseFloat(v('monto')) || 0;
        const fecha = v('fecha') || hoyISO(), moneda = v('moneda') || 'RD$', nota = v('nota');
        try {
            if (tipo === 'anticipo') {
                if (!monto && !confirm('No pusiste el monto. ¿Marcar el anticipo como recibido igual?')) return;
                await anticipoPedidoFn({ accion: 'marcar', orderId: id, tipo, monto, moneda, fecha, nota });
                return;
            }
            const formaPago = v('forma'), facturaCitrus = v('factura');
            if (!formaPago) { alert('Elige la forma de pago (efectivo, transferencia, cheque o tarjeta).'); return; }
            if (!facturaCitrus && !confirm('No pusiste el número de factura de Citrus. ¿Marcar el pago completo igual?')) return;
            const pedidos = [{ orderId: id, monto: monto || null }];
            document.querySelectorAll('#antic-otros-' + id + ' input[type="checkbox"]:checked').forEach((c) => {
                const mi = document.querySelector('#antic-otros-' + id + ' input[data-oid="' + c.value + '"]');
                pedidos.push({ orderId: c.value, monto: mi && mi.value !== '' ? parseFloat(mi.value) || 0 : null });
            });
            const txt = pedidos.length > 1 ? `\n\nCubre ${pedidos.length} pedidos con la misma factura${facturaCitrus ? ' (' + facturaCitrus + ')' : ''}.` : '';
            if (!confirm(`¿Marcar PAGO COMPLETO (${FORMAS_PAGO[formaPago] || formaPago}${monto ? ', ' + fRD(monto, moneda) : ''})?${txt}`)) return;
            await anticipoPedidoFn({ accion: 'marcar', orderId: id, tipo: 'completo', monto, moneda, fecha, nota, formaPago, facturaCitrus, pedidos });
        } catch (e) { alert('No se pudo guardar: ' + e.message); }
    };
    window.anticipoQuitar = async function (id) {
        if (!confirm('¿Quitar la marca de pago recibido? Si venía de Citrus, volverá a aparecer en el Panel para reasignarlo.')) return;
        try { await anticipoPedidoFn({ accion: 'quitar', orderId: id }); } catch (e) { alert('No se pudo: ' + e.message); }
    };
    return anticipoHTML;
}
