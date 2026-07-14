// Login con Google + verificación de rol contra la colección `usuarios`.
// Uso en cada pantalla de rol:
//   import { requireAuth } from './auth-common.js';
//   const usuario = await requireAuth(['fabrica']); // admin siempre pasa
//   // usuario = { email, nombre, rol }
import { auth, googleProvider, db } from './firebase-config.js';
import { rootPath } from './paths.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function showOverlay(innerHTML) {
  let el = document.getElementById('auth-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auth-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:#0A3D62;color:#fff;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
      'font-family:Arimo,sans-serif;text-align:center;padding:24px;z-index:9999;';
    document.body.appendChild(el);
  }
  el.innerHTML = innerHTML;
  el.style.display = 'flex';
  return el;
}

function hideOverlay() {
  const el = document.getElementById('auth-overlay');
  if (el) el.style.display = 'none';
}

function showLoginScreen() {
  const el = showOverlay(
    '<img src="' + rootPath('logo.png') + '" alt="ARTAL" style="height:64px;width:auto;object-fit:contain;">' +
    '<h2 style="margin:0;font-size:20px;">ARTAL Operaciones</h2>' +
    '<button id="auth-google-btn" style="font-size:16px;padding:14px 28px;border-radius:10px;' +
    'border:none;background:#fff;color:#0A3D62;cursor:pointer;font-weight:700;min-height:48px;">' +
    'Iniciar sesión con Google</button>'
  );
  document.getElementById('auth-google-btn').onclick = () => {
    signInWithPopup(auth, googleProvider).catch((err) => {
      alert('No se pudo iniciar sesión: ' + err.message);
    });
  };
}

function showUnauthorizedScreen(email) {
  const safeEmail = String(email).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = showOverlay(
    '<h2 style="margin:0;font-size:20px;">Sin autorización</h2>' +
    '<p style="max-width:320px;">La cuenta <b>' + safeEmail + '</b> no tiene acceso a esta pantalla. ' +
    'Pide al administrador que la agregue con el rol correcto.</p>' +
    '<button id="auth-signout-btn" style="font-size:14px;padding:8px 16px;border-radius:8px;' +
    'border:1px solid #fff;background:transparent;color:#fff;cursor:pointer;">' +
    'Cerrar sesión</button>'
  );
  document.getElementById('auth-signout-btn').onclick = () => signOut(auth);
}

/**
 * Exige login con Google y rol autorizado. Resuelve con { email, nombre, rol, roles } cuando
 * el usuario está autenticado y alguno de sus roles en `usuarios/{email}` está en
 * `rolesPermitidos` (o tiene 'admin', que siempre pasa). No resuelve nunca si el usuario no
 * está autorizado (se queda mostrando la pantalla de login/error).
 *
 * `rol` en Firestore puede ser un string ('chofer') o un array (['chofer','instalador']) para
 * personas con más de un rol — aquí se normaliza siempre a array.
 */
export function requireAuth(rolesPermitidos) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        showLoginScreen();
        return;
      }
      const snap = await getDoc(doc(db, 'usuarios', user.email));
      const data = snap.exists() ? snap.data() : null;
      const roles = data ? (Array.isArray(data.rol) ? data.rol : [data.rol]) : [];
      const autorizado = roles.includes('admin') || roles.some((r) => rolesPermitidos.includes(r));
      if (!data || data.activo === false || !autorizado) {
        showUnauthorizedScreen(user.email);
        return;
      }
      hideOverlay();
      resolve({ email: user.email, nombre: data.nombre || user.email, rol: roles[0], roles });
    });
  });
}

export { auth, signOut };
