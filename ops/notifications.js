// Notificaciones push (citas, recordatorios, pedidos, solicitudes web) — compartido por todas las
// pantallas de rol.
//
// BLINDAJE (2026-09-11, pedido del usuario: "que una sola vez se acepte y nunca se desactive"):
//  · Antes se guardaba UN solo token por usuario (usuarios/{email}.fcmToken): cada dispositivo que
//    activaba notificaciones PISABA el token del anterior, y ese otro dispositivo dejaba de recibir
//    en silencio — un mismo usuario con iPhone + Mac veía cómo se "desactivaban" a cada rato. Ahora cada dispositivo guarda SU token en usuarios/{email}.fcmTokens
//    (mapa clave = hash del token → {token, dispositivo, fecha}); la Cloud Function manda a TODOS y
//    borra sola los tokens muertos. `fcmToken` (el último) se sigue escribiendo por compatibilidad.
//  · Los tokens de Google rotan y caducan: `refrescarNotificaciones()` corre SOLA en cada carga de
//    página (la llama requireAuth) — si el permiso ya está concedido, renueva el token sin volver a
//    preguntar nada. El usuario acepta UNA vez por dispositivo; el resto es automático.
//  · Lo único que no se puede impedir desde la web es que la PERSONA (o el sistema) bloquee el
//    permiso en el navegador/teléfono: en ese caso el botón lo muestra en rojo con cómo reactivarlo.
import { auth, db, VAPID_KEY } from './firebase-config.js';
import { rootPath } from './paths.js';
import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

async function hashToken(token) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
function dispositivoTxt() {
    const ua = navigator.userAgent || '';
    const so = /iPhone|iPad/.test(ua) ? (/iPad/.test(ua) ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Otro';
    const nav = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /Edg/.test(ua) ? 'Edge' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Navegador';
    const app = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? ' · app en inicio' : '';
    return so + ' · ' + nav + app;
}
let messagingReady = null;   // promesa compartida: SW + messaging una sola vez por página
async function prepararMessaging() {
    if (messagingReady) return messagingReady;
    messagingReady = (async () => {
        const registration = await navigator.serviceWorker.register(rootPath('sw.js'));
        await navigator.serviceWorker.ready;
        const { getMessaging, isSupported, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js');
        if (!(await isSupported())) throw new Error('Este navegador no soporta Firebase Cloud Messaging (algunos navegadores en modo privado lo bloquean).');
        const messaging = getMessaging();
        // Mensajes en primer plano (pestaña abierta): FCM no los muestra solo, hay que hacerlo a mano.
        onMessage(messaging, (payload) => {
            const data = payload.data || {};
            try { new Notification(data.title || 'ARTAL Operaciones', { body: data.body || '', icon: rootPath('logo.png') }); } catch (_) { }
        });
        return { messaging, registration, getToken };
    })();
    return messagingReady;
}
async function obtenerYGuardarToken(forzar) {
    const { messaging, registration, getToken } = await prepararMessaging();
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) throw new Error('No se pudo obtener el token de notificaciones. Intenta de nuevo.');
    // Evita escribir en Firestore en cada carga: solo si el token cambió o pasó más de un día.
    const email = auth.currentUser.email;
    const marca = 'fcmGuardado:' + email;
    let prev = null; try { prev = JSON.parse(localStorage.getItem(marca) || 'null'); } catch (_) { }
    if (!forzar && prev && prev.token === token && (Date.now() - prev.ts) < 24 * 3600000) return token;
    const key = await hashToken(token);
    await updateDoc(doc(db, 'usuarios', email), {
        fcmToken: token,
        ['fcmTokens.' + key]: { token, dispositivo: dispositivoTxt(), fecha: serverTimestamp() }
    });
    try { localStorage.setItem(marca, JSON.stringify({ token, ts: Date.now() })); } catch (_) { }
    return token;
}
const soportado = () => ('Notification' in window) && ('serviceWorker' in navigator);

// Pinta el estado en el botón 🔔 de la página (si existe). Sirve para VER de un vistazo si este
// dispositivo recibe avisos, en vez de descubrirlo cuando no llega uno.
function pintarBoton(estado, btn) {
    btn = btn || document.getElementById('notif-btn'); if (!btn) return;
    if (estado === 'granted') { btn.textContent = '🔔 Notificaciones activas'; btn.title = 'Este dispositivo recibe los avisos. Toca para renovar.'; btn.style.color = '#1e8449'; }
    else if (estado === 'denied') { btn.textContent = '🔕 Notificaciones bloqueadas'; btn.title = 'El permiso está bloqueado en este navegador/teléfono. Toca para ver cómo reactivarlo.'; btn.style.color = '#c0392b'; }
    else { btn.textContent = '🔔 Activar notificaciones'; btn.title = 'Recibir avisos en este dispositivo'; btn.style.color = ''; }
}

// Silencioso: se llama en cada carga (desde requireAuth). Si el permiso ya fue concedido, renueva y
// guarda el token de ESTE dispositivo sin preguntar nada. Nunca muestra alertas.
export async function refrescarNotificaciones(opts) {
    try {
        if (!soportado()) return;
        pintarBoton(Notification.permission);
        if (Notification.permission !== 'granted') {
            // Un admin pidió (desde Usuarios y roles) que esta persona active las notificaciones:
            // aviso visible con el botón — el permiso solo puede concederlo ella, tocando aquí.
            if (opts && opts.pedir && auth.currentUser) mostrarAvisoPedido();
            return;
        }
        await obtenerYGuardarToken(false);
        pintarBoton('granted');
        if (opts && opts.pedir) { try { await updateDoc(doc(db, 'usuarios', auth.currentUser.email), { pedirNotificaciones: false }); } catch (_) { } }
    } catch (e) { console.warn('refrescarNotificaciones', e && e.message ? e.message : e); }
}
function mostrarAvisoPedido() {
    if (document.getElementById('aviso-notif-pedido')) return;
    const bloq = Notification.permission === 'denied';
    const bar = document.createElement('div');
    bar.id = 'aviso-notif-pedido';
    bar.style.cssText = 'position:sticky;top:0;z-index:9000;background:#fff4e5;border-bottom:2px solid #f5c26b;color:#7a4b00;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-family:Arimo,sans-serif;font-size:14px;';
    bar.innerHTML = '<span style="flex:1;min-width:220px;">🔔 <b>Gerencia te pide activar las notificaciones</b> en este dispositivo para recibir los avisos de trabajo.' + (bloq ? ' Están bloqueadas en tu navegador/teléfono: toca el botón para ver cómo permitirlas.' : '') + '</span>'
        + '<button id="aviso-notif-btn" style="background:#0A3D62;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;font-family:Arimo;cursor:pointer;min-height:42px;">' + (bloq ? 'Cómo permitirlas' : 'Activar ahora') + '</button>'
        + '<button id="aviso-notif-x" title="Cerrar" style="background:transparent;border:none;font-size:18px;cursor:pointer;color:#7a4b00;">✕</button>';
    document.body.prepend(bar);
    bar.querySelector('#aviso-notif-x').onclick = () => bar.remove();
    bar.querySelector('#aviso-notif-btn').onclick = async () => {
        await enableNotifications(bar.querySelector('#aviso-notif-btn'));
        if (Notification.permission === 'granted') { try { await updateDoc(doc(db, 'usuarios', auth.currentUser.email), { pedirNotificaciones: false }); } catch (_) { } bar.remove(); }
    };
}

export async function enableNotifications(button) {
    if (!soportado()) { alert('Este navegador no soporta notificaciones push.'); return; }
    if (!auth.currentUser || !auth.currentUser.email) { alert('Inicia sesión antes de activar notificaciones.'); return; }
    if (Notification.permission === 'denied') {
        alert('Las notificaciones están BLOQUEADAS en este navegador/teléfono, y una web no puede desbloquearlas sola.\n\nCómo reactivarlas:\n• iPhone/iPad (app en inicio): Ajustes → Notificaciones → ARTAL → Permitir.\n• Chrome (Mac/Windows/Android): candado 🔒 junto a la dirección → Notificaciones → Permitir.\n• Safari (Mac): Safari → Ajustes → Sitios web → Notificaciones → Permitir.\n\nLuego vuelve aquí y toca el botón de nuevo.');
        return;
    }
    const originalText = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Activando…'; }
    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { pintarBoton(permission, button); alert('No se activaron las notificaciones — el permiso quedó denegado. Puedes cambiarlo en los ajustes de notificaciones de tu navegador.'); return; }
        await obtenerYGuardarToken(true);
        pintarBoton('granted', button);
        alert('✓ Notificaciones activadas en este dispositivo (' + dispositivoTxt() + ').\n\nNo hace falta volver a activarlas: se renuevan solas cada vez que entras. Si las activas en otro teléfono o computadora, este sigue recibiendo.');
    } catch (e) {
        alert('No se pudieron activar las notificaciones: ' + (e && e.message ? e.message : e));
        if (button) { button.textContent = originalText; }
    } finally { if (button) button.disabled = false; }
}
