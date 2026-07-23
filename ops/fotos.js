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

// Reduce la foto del celular a JPEG (máx. 1600px de lado, calidad 0.82) antes de subirla, para
// no mandar archivos de varios MB. Si algo falla, sube el archivo original tal cual.
function comprimir(file) {
    return new Promise((resolve) => {
        if (!file || !/^image\//.test(file.type)) { resolve(file); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const max = 1600;
            let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            c.toBlob(b => resolve(b || file), 'image/jpeg', 0.82);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

// Sube una lista de archivos y devuelve [{ url, nombre }]. Ignora los que no sean imágenes.
export async function subirFotos(fileList, pathPrefix) {
    const out = [];
    for (const file of Array.from(fileList || [])) {
        if (!/^image\//.test(file.type)) continue;
        const blob = await comprimir(file).catch(() => file);
        const nombre = (Date.now() + '_' + Math.random().toString(36).slice(2, 8)) + '.jpg';
        const r = ref(storage, `${pathPrefix}/${nombre}`);
        await uploadBytes(r, blob, { contentType: 'image/jpeg' });
        const url = await getDownloadURL(r);
        out.push({ url, nombre: file.name || 'foto.jpg' });
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
            ? `<button class="foto-del" title="Quitar foto" onclick="event.preventDefault();event.stopPropagation();__borrarFoto('${esc(coleccion)}','${esc(id)}','${esc(f.url)}','${esc(campo)}')">×</button>`
            : '';
        return `<span class="foto-thumb"><a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" loading="lazy" alt="foto"></a>${del}</span>`;
    }).join('');
    return `<div class="fotos-thumbs">${items}</div>`;
}

// Botón "Agregar fotos": un <label> con un <input file> oculto (accept image/* + capture para
// que en el celular ofrezca cámara o galería).
export function fotoAddBtnHTML({ coleccion, id, campo = 'fotos', label = '📷 Agregar fotos' } = {}) {
    return `<label class="foto-add-btn">${esc(label)}<input type="file" accept="image/*" multiple style="display:none" onchange="__subirFotos('${esc(coleccion)}','${esc(id)}','${esc(campo)}',this)"></label>`;
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
    `;
    document.head.appendChild(st);
}
