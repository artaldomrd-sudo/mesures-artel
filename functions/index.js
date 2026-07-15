const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

async function tokenDe(email) {
    if (!email) return null;
    const s = await db.collection('usuarios').doc(email).get();
    return s.exists ? (s.data().fcmToken || null) : null;
}

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

// Recordatorios programados: cada 5 minutos revisa citas e instalaciones que tengan un
// recordatorio pendiente (recordarAntesMin > 0 y recordatorioEnviado == false) y, cuando falta
// ese tiempo o menos para el evento, manda el push y marca recordatorioEnviado = true (para no
// repetirlo). Si el evento ya pasó sin enviarse, igual se marca enviado para no reintentar.
async function procesarRecordatorios(coll, campoEmail, urlDestino, tituloPrefix) {
    const ahora = Date.now();
    const snap = await db.collection(coll).where('recordatorioEnviado', '==', false).get();
    for (const docu of snap.docs) {
        const d = docu.data();
        const fecha = d.fecha && d.fecha.toDate ? d.fecha.toDate().getTime() : null;
        const offset = Number(d.recordarAntesMin || 0);
        if (!fecha || !offset) { await docu.ref.update({ recordatorioEnviado: true }); continue; }
        if (ahora < fecha - offset * 60000) continue; // todavía no toca
        if (ahora <= fecha) {
            const token = await tokenDe(d[campoEmail]);
            if (token) {
                const fechaTexto = new Date(fecha).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
                const lugar = [d.cliente, d.obra].filter(Boolean).join(' — ');
                try {
                    await getMessaging().send({
                        token,
                        data: {
                            title: tituloPrefix + (d.titulo || lugar || 'Recordatorio'),
                            body: [fechaTexto, lugar].filter(Boolean).join(' · '),
                            url: urlDestino
                        }
                    });
                } catch (e) {
                    console.error('No se pudo enviar el recordatorio', coll, docu.id, e);
                }
            }
        }
        await docu.ref.update({ recordatorioEnviado: true });
    }
}

exports.enviarRecordatorios = onSchedule('every 5 minutes', async () => {
    await procesarRecordatorios('citas', 'asignadoEmail', 'ops/calendario.html', 'Recordatorio: ');
    await procesarRecordatorios('instalaciones', 'instaladorEmail', 'ops/instalaciones.html', 'Instalación próxima: ');
});
