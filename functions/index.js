const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

// Se dispara al crear una cita en ops/calendario.html. Manda un push (solo "data", el service
// worker en sw.js decide cómo mostrarlo) a quien esté asignado — o al gerente que la creó, si
// la cita es para él mismo. No hace nada si esa persona nunca activó notificaciones (no tiene
// fcmToken guardado en usuarios/{email}).
exports.enviarNotificacionCita = onDocumentCreated('citas/{citaId}', async (event) => {
    const cita = event.data.data();
    const email = cita.asignadoEmail;
    if (!email) return;

    const userSnap = await db.collection('usuarios').doc(email).get();
    const token = userSnap.exists ? userSnap.data().fcmToken : null;
    if (!token) return;

    const fecha = cita.fecha && cita.fecha.toDate ? cita.fecha.toDate() : null;
    const fechaTexto = fecha
        ? fecha.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
    const lugar = [cita.cliente, cita.obra].filter(Boolean).join(' — ');

    try {
        await getMessaging().send({
            token,
            data: {
                title: 'Nueva cita: ' + (cita.titulo || 'Sin título'),
                body: [fechaTexto, lugar].filter(Boolean).join(' · '),
                url: 'ops/calendario.html'
            }
        });
    } catch (e) {
        console.error('No se pudo enviar la notificación de la cita', event.params.citaId, e);
    }
});
