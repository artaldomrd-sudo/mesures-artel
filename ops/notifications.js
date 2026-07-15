// Activar notificaciones push (citas del calendario) — compartido por todas las pantallas de
// rol. Pide permiso, registra el mismo service worker que ya usa index.html (mismo archivo,
// mismo scope — el navegador lo reutiliza en vez de crear uno nuevo), obtiene el token de
// Cloud Messaging y lo guarda en usuarios/{email}.fcmToken para que las Cloud Functions sepan
// a quién mandarle el push.
//
// En iPhone el push solo funciona si la app se abrió desde el ícono de la pantalla de inicio
// (PWA instalada, iOS 16.4+), nunca desde una pestaña de Safari. Además iOS puede rotar el
// token, por eso lo REFRESCAMOS solos en cada apertura de la app (ver refrescoAutomatico), no
// solo al tocar el botón.
import { auth, db, VAPID_KEY } from './firebase-config.js';
import { rootPath } from './paths.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

let onMessageListo = false; // el listener de primer plano se registra una sola vez

// Registra el SW, obtiene el token de FCM y lo guarda en el usuario. Devuelve el token o lanza.
async function obtenerYGuardarToken() {
    const registration = await navigator.serviceWorker.register(rootPath('sw.js'));
    await navigator.serviceWorker.ready;

    const { getMessaging, isSupported, getToken, onMessage } =
        await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js');
    if (!(await isSupported())) throw new Error('Este navegador no soporta Firebase Cloud Messaging.');

    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) throw new Error('No se pudo obtener el token de notificaciones.');

    await setDoc(doc(db, 'usuarios', auth.currentUser.email), { fcmToken: token }, { merge: true });

    if (!onMessageListo) {
        onMessageListo = true;
        // Mensajes en primer plano (app abierta): FCM no los muestra solo, hay que hacerlo a mano.
        onMessage(messaging, (payload) => {
            const data = payload.data || {};
            try { new Notification(data.title || 'ARTAL Operaciones', { body: data.body || '', icon: rootPath('logo.png') }); } catch (e) {}
        });
    }
    return token;
}

function marcarBotonActivo() {
    const btn = document.getElementById('notif-btn');
    if (btn) { btn.textContent = '✓ Notificaciones activas'; btn.disabled = false; }
}

export async function enableNotifications(button) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        alert('Este navegador no soporta notificaciones push. En iPhone hay que abrir la app desde el ícono de la pantalla de inicio (no desde Safari).');
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
            alert('No se activaron las notificaciones — el permiso quedó denegado. En iPhone: abre la app desde el ícono de la pantalla de inicio y acepta el permiso; si ya lo negaste, actívalo en Ajustes → Notificaciones.');
            if (button) { button.disabled = false; button.textContent = originalText; }
            return;
        }
        await obtenerYGuardarToken();
        marcarBotonActivo();
        alert('Notificaciones activadas en este dispositivo.');
    } catch (e) {
        alert('No se pudieron activar las notificaciones: ' + e.message);
        if (button) { button.disabled = false; button.textContent = originalText; }
    }
}

// Refresco automático: en cada apertura, si ya hay sesión y el permiso está concedido, se vuelve
// a obtener y guardar el token (por si iOS lo rotó) y se marca el botón como activo — sin pedir
// permiso ni molestar al usuario. Así la activación "se queda" entre sesiones.
function refrescoAutomatico() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    onAuthStateChanged(auth, async (user) => {
        if (!user || Notification.permission !== 'granted') return;
        try {
            await obtenerYGuardarToken();
            marcarBotonActivo();
        } catch (e) { /* silencioso: si falla, el usuario puede tocar el botón manualmente */ }
    });
}
refrescoAutomatico();
