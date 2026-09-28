// Papelera con registro de los hechos (usuario 2026-09-28: «habilítale los botones borrar con record de los hechos
// para que podamos verificar qué pasó»). Antes de borrar un documento (trabajo de instalación, recordatorio/cita,
// pedido/obra) se guarda una COPIA COMPLETA en `papelera` con quién lo borró, cuándo y desde qué pantalla. La
// colección es de solo CREAR (nadie edita ni borra un registro, ni admin) → historial a prueba de manipulación.
// Restaurar = volver a escribir la copia en su colección original con el mismo id + dejar otro registro
// (tipo 'restaurado'). Se ve en Historial → Auditoría → «🗑 Eliminados (papelera)».
import { db } from './firebase-config.js';
import { collection, doc, addDoc, setDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Borra `coleccion/id` dejando registro. `datos` = el documento tal cual estaba (se guarda la copia entera).
export async function borrarConRegistro({ coleccion, id, datos, resumen, usuario, pantalla, motivo }) {
    const copia = JSON.parse(JSON.stringify(datos || {}, (k, v) => (v && typeof v === 'object' && typeof v.toDate === 'function') ? v.toDate().toISOString() : v));
    await addDoc(collection(db, 'papelera'), {
        tipo: 'eliminado', coleccion, docId: id, resumen: String(resumen || '').slice(0, 200), datos: copia,
        cliente: String((datos && datos.cliente) || '').slice(0, 120), obra: String((datos && datos.obra) || '').slice(0, 120),
        por: (usuario && usuario.nombre) || '', porEmail: (usuario && usuario.email) || '', pantalla: pantalla || location.pathname.split('/').pop(),
        motivo: String(motivo || '').slice(0, 300), fecha: serverTimestamp()
    });
    await deleteDoc(doc(db, coleccion, id));
}

// Vuelve a poner el documento borrado en su sitio (mismo id) y deja registro de la restauración.
export async function restaurarDePapelera(registro, usuario) {
    if (!registro || !registro.coleccion || !registro.docId) throw new Error('registro incompleto');
    await setDoc(doc(db, registro.coleccion, registro.docId), registro.datos || {});
    await addDoc(collection(db, 'papelera'), {
        tipo: 'restaurado', coleccion: registro.coleccion, docId: registro.docId, resumen: registro.resumen || '',
        cliente: registro.cliente || '', obra: registro.obra || '', deRegistro: registro.id || '',
        por: (usuario && usuario.nombre) || '', porEmail: (usuario && usuario.email) || '', pantalla: location.pathname.split('/').pop(), fecha: serverTimestamp()
    });
}
