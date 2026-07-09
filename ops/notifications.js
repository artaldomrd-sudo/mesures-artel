// Activar notificaciones push (citas del calendario) — compartido por todas las pantallas de
// rol. Pide permiso, registra el mismo service worker que ya usa index.html (mismo archivo,
// mismo scope — el navegador lo reutiliza en vez de crear uno nuevo), obtiene el token de
// Cloud Messaging y lo guarda en usuarios/{email}.fcmToken para que la Cloud Function
// (enviarNotificacionCita) sepa a quién mandarle el push.
import { auth, db, VAPID_KEY } from './firebase-config.js';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export async function enableNotifications(button) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        alert('Este navegador no soporta notificaciones push.');
        return;
    }
    if (!auth.currentUser || !auth.currentUser.email) {
        alert('Inicia sesión antes de activar notificaciones.');
        return;
    }

    const originalText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Activando…'; }

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            alert('No se activaron las notificaciones — el permiso quedó denegado. Puedes cambiarlo en los ajustes de notificaciones de tu navegador.');
            return;
        }

        const registration = await navigator.serviceWorker.register('../sw.js');
        await navigator.serviceWorker.ready;

        const { getMessaging, isSupported, getToken, onMessage } =
            await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js');

        if (!(await isSupported())) {
            alert('Este navegador no soporta Firebase Cloud Messaging (algunos navegadores en modo privado lo bloquean).');
            return;
        }

        const messaging = getMessaging();
        const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
        if (!token) {
            alert('No se pudo obtener el token de notificaciones. Intenta de nuevo.');
            return;
        }

        await updateDoc(doc(db, 'usuarios', auth.currentUser.email), { fcmToken: token });

        // Mensajes en primer plano (pestaña abierta): FCM no los muestra solo, hay que hacerlo a mano.
        onMessage(messaging, (payload) => {
            const data = payload.data || {};
            new Notification(data.title || 'ARTAL Operaciones', { body: data.body || '', icon: 'logo.png' });
        });

        if (button) button.textContent = '✓ Notificaciones activadas';
        alert('Notificaciones activadas en este dispositivo.');
    } catch (e) {
        alert('No se pudieron activar las notificaciones: ' + e.message);
        if (button) { button.disabled = false; button.textContent = originalText; }
    }
}
