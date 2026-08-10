// Subida y visualización de fotos, compartida por Calendario, Fábrica Interna e Instalaciones.
//
// Modelo de datos: cada documento guarda un array `fotos` (o el campo que se indique) con
// objetos { url, nombre }. Las imágenes se suben a Firebase Storage bajo `${coleccion}/${id}/`.
// No hace falta ninguna colección nueva ni cambiar las reglas de Firestore (solo es un
// updateDoc de un array). Sí requiere que las reglas de Storage permitan escritura autenticada
// (las mismas que ya usan compras-pdfs/, contratista-pdfs/, etc.).
//
// Uso en una tarjeta:
//   import { fotosThumbsHTML, fotoAddBtnHTML } from './fotos.js';
//   ...
//   ${fotosThumbsHTML(o.fotos, { coleccion: 'orders', id, puedeBorrar: esAdmin })}
//   ${fotoAddBtnHTML({ coleccion: 'orders', id })}
// Los handlers de subir/borrar son globales (window.__subirFotos / window.__borrarFoto), así
// que la tarjeta puede re-renderizarse cuantas veces haga falta sin re-enganchar eventos.

import { db, storage } from './firebase-config.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Redibuja una imagen decodificable a JPEG (máx. 1600px de lado). RECHAZA si el navegador no
// puede decodificar el archivo (p. ej. HEIC en Chrome) — así el llamador sabe que hay que
// convertir por otra vía en vez de subir un archivo que no se verá.
function canvasAJpeg(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const max = 1600;
            let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) { URL.revokeObjectURL(url); reject(new Error('imagen vacía')); return; }
            if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob falló')), 'image/jpeg', 0.82);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('el navegador no pudo decodificar la imagen')); };
        img.src = url;
    });
}

// Los iPhone/iPad guardan las fotos en HEIC, que Chrome/Firefox NO saben mostrar (Safari sí). Se
// convierte a JPEG en el navegador. Se prueban DOS librerías en cadena, porque ninguna decodifica
// todos los HEIC: heic-to (libheif moderno, maneja HEIC de 10-bit/HDR del iPhone nuevo) y, si
// falla, heic2any (libheif viejo). Solo se cargan cuando aparece un HEIC (la mayoría son JPEG).
const esHeic = (file) => /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
let heic2anyLibPromise = null;
async function conHeic2any(file) {
    if (!window.heic2any) {
        if (!heic2anyLibPromise) {
            heic2anyLibPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
                s.onload = resolve;
                s.onerror = () => { heic2anyLibPromise = null; reject(new Error('No se pudo cargar el conversor HEIC (¿sin internet?)')); };
                document.head.appendChild(s);
            });
        }
        await heic2anyLibPromise;
    }
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(out) ? out[0] : out;
}
async function conHeicTo(file) {
    const mod = await import('https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/heic-to.js');
    return await mod.heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
}

// Devuelve un blob JPEG listo para subir, o LANZA un error claro si no se pudo. Para HEIC prueba
// heic-to → heic2any → canvas nativo (Safari) en cadena, hasta que uno funcione.
async function prepararImagenJpeg(file) {
    if (esHeic(file)) {
        let jpg = null;
        for (const conversor of [conHeicTo, conHeic2any]) {
            try { jpg = await conversor(file); break; } catch (e) { /* prueba el siguiente */ }
        }
        if (!jpg) {
            try { jpg = await canvasAJpeg(file); }  // Safari decodifica HEIC en canvas directo
            catch (e) { throw new Error('No se pudo convertir la foto HEIC en este navegador. Súbela como JPG o activa "Más compatible" en Ajustes › Cámara › Formatos del iPhone.'); }
        }
        // Reescalar/recomprimir el JPEG resultante (las fotos vienen a 12MP). Si no se puede, se sube igual.
        try { return await canvasAJpeg(jpg); } catch (e) { return jpg; }
    }
    // Imagen normal (JPG/PNG…). Si el canvas no la puede decodificar, se sube tal cual.
    try { return await canvasAJpeg(file); } catch (e) { return file; }
}

// Sube una lista de archivos y devuelve [{ url, nombre, tipo }]. Acepta imágenes (se comprimen a
// JPEG; HEIC del iPhone se convierte primero) y PDFs (se suben tal cual). Ignora cualquier otro tipo.
export async function subirFotos(fileList, pathPrefix) {
    const out = [];
    for (const original of Array.from(fileList || [])) {
        const esPdf = original.type === 'application/pdf' || /\.pdf$/i.test(original.name || '');
        const esImg = /^image\//.test(original.type) || esHeic(original);
        if (!esImg && !esPdf) continue;
        if (esPdf) {
            const nombre = (Date.now() + '_' + Math.random().toString(36).slice(2, 8)) + '.pdf';
            const r = ref(storage, `${pathPrefix}/${nombre}`);
            await uploadBytes(r, original, { contentType: 'application/pdf' });
            const url = await getDownloadURL(r);
            out.push({ url, nombre: original.name || 'documento.pdf', tipo: 'pdf' });
        } else {
            const blob = await prepararImagenJpeg(original);   // lanza si un HEIC no se pudo convertir
            const nombre = (Date.now() + '_' + Math.random().toString(36).slice(2, 8)) + '.jpg';
            const r = ref(storage, `${pathPrefix}/${nombre}`);
            await uploadBytes(r, blob, { contentType: 'image/jpeg' });
            const url = await getDownloadURL(r);
            out.push({ url, nombre: original.name || 'foto.jpg', tipo: 'img' });
        }
    }
    return out;
}

// Agrega fotos al array `campo` de un documento (read-modify-write, para no depender de
// arrayUnion con objetos, que exige igualdad exacta).
export async function agregarFotos(coleccion, id, fileList, campo = 'fotos') {
    const nuevas = await subirFotos(fileList, `${coleccion}/${id}`);
    if (!nuevas.length) return [];
    const snap = await getDoc(doc(db, coleccion, id));
    const prev = (snap.exists() && Array.isArray(snap.data()[campo])) ? snap.data()[campo] : [];
    await updateDoc(doc(db, coleccion, id), { [campo]: prev.concat(nuevas) });
    return nuevas;
}

// Quita una foto del array por su URL (no borra el blob de Storage — queda huérfano, aceptable).
export async function quitarFotoPorUrl(coleccion, id, url, campo = 'fotos') {
    const snap = await getDoc(doc(db, coleccion, id));
    const prev = (snap.exists() && Array.isArray(snap.data()[campo])) ? snap.data()[campo] : [];
    await updateDoc(doc(db, coleccion, id), { [campo]: prev.filter(f => f && f.url !== url) });
}

// Miniaturas: cada una abre la foto a tamaño completo (URL https de Storage, se abre en pestaña
// nueva sin problema). Con `puedeBorrar` aparece una × para quitarla.
export function fotosThumbsHTML(fotos, { coleccion, id, campo = 'fotos', puedeBorrar = false } = {}) {
    if (!Array.isArray(fotos) || !fotos.length) return '';
    const items = fotos.map(f => {
        const del = puedeBorrar
            ? `<button class="foto-del" title="Quitar" onclick="event.preventDefault();event.stopPropagation();__borrarFoto('${esc(coleccion)}','${esc(id)}','${esc(f.url)}','${esc(campo)}')">×</button>`
            : '';
        const esPdf = f.tipo === 'pdf' || /\.pdf(\?|$)/i.test(f.url || '') || /\.pdf$/i.test(f.nombre || '');
        if (esPdf) {
            const nom = (f.nombre || 'PDF').replace(/\.pdf$/i, '');
            return `<span class="foto-thumb foto-pdf"><a href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.nombre || 'PDF')}"><span class="pdf-ico">📄</span><span class="pdf-nom">${esc(nom.slice(0, 16))}</span></a>${del}</span>`;
        }
        return `<span class="foto-thumb"><a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" loading="lazy" alt="foto"></a>${del}</span>`;
    }).join('');
    return `<div class="fotos-thumbs">${items}</div>`;
}

// Botón "Agregar fotos": un <label> con un <input file> oculto (accept image/* + capture para
// que en el celular ofrezca cámara o galería).
export function fotoAddBtnHTML({ coleccion, id, campo = 'fotos', label, pdf = false } = {}) {
    const accept = pdf ? 'image/*,application/pdf' : 'image/*';
    const lbl = label || (pdf ? '📎 Agregar foto/PDF' : '📷 Agregar fotos');
    return `<label class="foto-add-btn">${esc(lbl)}<input type="file" accept="${accept}" multiple style="display:none" onchange="__subirFotos('${esc(coleccion)}','${esc(id)}','${esc(campo)}',this)"></label>`;
}

// Handlers globales (una sola vez por página).
window.__subirFotos = async function (coleccion, id, campo, input) {
    const files = input.files;
    if (!files || !files.length) return;
    const label = input.parentElement;
    const txtPrev = label ? label.firstChild && label.firstChild.textContent : '';
    input.disabled = true;
    if (label && label.firstChild) label.firstChild.textContent = '⏳ Subiendo…';
    try {
        await agregarFotos(coleccion, id, files, campo || 'fotos');
    } catch (e) {
        alert('No se pudieron subir las fotos: ' + (e && e.message ? e.message : e));
    } finally {
        input.value = '';
        input.disabled = false;
        if (label && label.firstChild && txtPrev) label.firstChild.textContent = txtPrev;
    }
};

window.__borrarFoto = async function (coleccion, id, url, campo) {
    if (!confirm('¿Quitar esta foto?')) return;
    try {
        await quitarFotoPorUrl(coleccion, id, url, campo || 'fotos');
    } catch (e) {
        alert('No se pudo quitar la foto: ' + (e && e.message ? e.message : e));
    }
};

// Estilos compartidos (se inyectan una sola vez al importar el módulo).
if (!document.getElementById('foto-styles')) {
    const st = document.createElement('style');
    st.id = 'foto-styles';
    st.textContent = `
    .fotos-thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .foto-thumb { position: relative; display: inline-block; }
    .foto-thumb img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1.5px solid #ddd; display: block; }
    .foto-del { position: absolute; top: -7px; right: -7px; width: 20px; height: 20px; border-radius: 50%; border: none; background: #e74c3c; color: #fff; font-weight: bold; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; }
    .foto-add-btn { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px 14px; border: 1.5px dashed var(--artal-blue); border-radius: 8px; background: #fff; color: var(--artal-blue); font-weight: bold; font-size: 12.5px; font-family: 'Arimo'; cursor: pointer; min-height: 38px; }
    .foto-add-btn:hover { background: var(--artal-light); }
    .foto-pdf a { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 8px; border: 1.5px solid #d9c2c2; background: #fdf3f3; text-decoration: none; color: #b3413a; gap: 2px; padding: 4px; box-sizing: border-box; }
    .foto-pdf .pdf-ico { font-size: 22px; line-height: 1; }
    .foto-pdf .pdf-nom { font-size: 8.5px; font-weight: bold; color: #8a4b47; text-align: center; word-break: break-all; line-height: 1.1; max-height: 20px; overflow: hidden; }
    `;
    document.head.appendChild(st);
}
