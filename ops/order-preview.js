// Modal de vista previa de una hoja (index.html?orderId=X dentro de un iframe), con botones
// Imprimir (reusa exportPDF() de index.html a través del iframe) y Reenviar (duplica el pedido
// tal cual, como un envío nuevo). Compartido por todas las pantallas de ops/.
import { db } from './firebase-config.js';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function closePreview() {
    const el = document.getElementById('order-preview-overlay');
    if (el) el.remove();
    window.removeEventListener('message', onMessage);
}

let currentIframe = null;
function onMessage(ev) {
    if (!ev.data || ev.data.type !== 'artal-order-loaded' || ev.source !== currentIframe.contentWindow) return;
    const printBtn = document.getElementById('preview-print-btn');
    if (printBtn) { printBtn.disabled = false; printBtn.textContent = 'Imprimir / PDF'; }
}

function ensureStyles() {
    if (document.getElementById('order-preview-styles')) return;
    const style = document.createElement('style');
    style.id = 'order-preview-styles';
    style.textContent = `
        #order-preview-overlay button { min-height: 40px; }
        @media (max-width: 600px) {
            #order-preview-overlay { padding: 0 !important; }
            #order-preview-overlay > div { max-width: 100% !important; height: 100vh !important; border-radius: 0 !important; }
            #order-preview-overlay .preview-toolbar { flex-wrap: wrap; gap: 8px !important; padding: 10px !important; }
            #order-preview-overlay .preview-toolbar b { width: 100%; }
        }`;
    document.head.appendChild(style);
}

export function openOrderPreview(orderId, role) {
    ensureStyles();
    const overlay = document.createElement('div');
    overlay.id = 'order-preview-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    const src = '../index.html?orderId=' + orderId + (role ? '&checklist=' + role : '');
    overlay.innerHTML = `
        <div style="background:#f3f4f6;border-radius:10px;width:100%;max-width:1000px;height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.4);">
            <div class="preview-toolbar" style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#0A3D62;color:#fff;font-family:Arimo,sans-serif;flex-wrap:wrap;gap:10px;">
                <b>Ficha técnica</b>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="preview-print-btn" disabled style="padding:9px 14px;border:none;border-radius:8px;background:#2ecc71;color:#fff;font-weight:bold;cursor:pointer;font-family:Arimo;">Cargando…</button>
                    <button id="preview-resend-btn" style="padding:9px 14px;border:none;border-radius:8px;background:#F6B93B;color:#0A3D62;font-weight:bold;cursor:pointer;font-family:Arimo;">Reenviar</button>
                    <button id="preview-close-btn" style="padding:9px 14px;border:1.5px solid #fff;border-radius:8px;background:transparent;color:#fff;cursor:pointer;font-family:Arimo;">✕ Cerrar</button>
                </div>
            </div>
            <iframe id="preview-iframe" src="${src}" style="flex:1;border:none;width:100%;"></iframe>
        </div>`;
    document.body.appendChild(overlay);

    currentIframe = document.getElementById('preview-iframe');
    window.addEventListener('message', onMessage);

    document.getElementById('preview-close-btn').onclick = closePreview;
    document.getElementById('preview-print-btn').onclick = () => {
        if (currentIframe.contentWindow.exportPDF) currentIframe.contentWindow.exportPDF();
    };
    document.getElementById('preview-resend-btn').onclick = () => reenviarOrden(orderId);
}

async function reenviarOrden(orderId) {
    const snap = await getDoc(doc(db, 'orders', orderId));
    if (!snap.exists()) { alert('No se encontró el pedido.'); return; }
    const o = snap.data();
    const isFab = (o.docType || '').indexOf('FAB') === 0;
    const destino = isFab ? 'fábrica' : 'el contratista';
    if (!confirm(`¿Reenviar "${o.cliente} — ${o.obra}" tal cual, como un pedido nuevo a ${destino}?`)) return;

    const btn = document.getElementById('preview-resend-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    try {
        await addDoc(collection(db, 'orders'), {
            cliente: o.cliente,
            obra: o.obra,
            docType: o.docType,
            material: o.material,
            color: o.color,
            status: isFab ? 'pendiente_fabrica' : 'solicitada',
            items: o.items,
            totalItems: o.totalItems,
            appJSON: o.appJSON,
            ...(isFab ? { fechaCotizado: serverTimestamp() } : { fechaSolicitada: serverTimestamp() })
        });
        alert('Reenviado correctamente.');
    } catch (e) {
        alert('No se pudo reenviar: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Reenviar'; }
    }
}
