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
 *
 * El rol `lector` (solo lectura) pasa cualquier pantalla, igual que `admin`, para que pueda ver
 * toda la plataforma — pero las reglas de Firestore le niegan cualquier escritura a nivel
 * servidor (ver firestore.rules), así que puede mirar todo sin poder modificar nada.
 */
export function requireAuth(rolesPermitidos) {
  // Tapa el contenido de la página de INMEDIATO (antes de leer nada en Firestore), para que
  // ninguna pantalla muestre su contenido mientras se verifica el acceso. Sin esto, el panel
  // dibuja sus tarjetas y quedan visibles durante el `await getDoc` — un rol de campo alcanzaba
  // a ver el panel de admin en ese lapso, aunque después quedara bloqueado.
  showOverlay(
    '<img src="' + rootPath('logo.png') + '" alt="ARTAL" style="height:56px;width:auto;object-fit:contain;">' +
    '<p style="opacity:.85;margin:0;">Verificando acceso…</p>'
  );
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        showLoginScreen();
        return;
      }
      const snap = await getDoc(doc(db, 'usuarios', user.email));
      const data = snap.exists() ? snap.data() : null;
      const roles = data ? (Array.isArray(data.rol) ? data.rol : [data.rol]) : [];
      const autorizado = roles.includes('admin') || roles.includes('lector') || roles.some((r) => rolesPermitidos.includes(r));
      if (!data || data.activo === false || !autorizado) {
        // Blindaje: si es una cuenta válida y activa con un rol de campo conocido, pero esta no
        // es su pantalla, lo mandamos a la pantalla de su rol en vez de dejarlo aquí — así un
        // instalador/ayudante/chofer NUNCA aterriza en el panel de admin ni en pantallas ajenas
        // (salvo que su doc tenga admin/lector, que por definición ven todo — ese control es de datos).
        if (data && data.activo !== false && roles.length) {
          const home = homePorRol(roles);
          const actual = location.pathname.split('/').pop() || 'index.html';
          if (home.split('/').pop() !== actual) {
            const carpeta = location.pathname.replace(/[^/]*$/, '');
            const opsIdx = carpeta.indexOf('/ops/');
            const prof = opsIdx === -1 ? 0 : carpeta.slice(opsIdx + '/ops/'.length).split('/').filter(Boolean).length;
            location.replace('../'.repeat(prof) + home);
            return;
          }
        }
        showUnauthorizedScreen(user.email);
        return;
      }
      hideOverlay();
      resolve({ email: user.email, nombre: data.nombre || user.email, rol: roles[0], roles });
    });
  });
}

// Inicio (home) de cada rol: a dónde debe llevar el botón "Volver". El Panel de Control
// (index.html) es solo de admin, así que un rol que no sea admin no debe caer ahí.
export function homePorRol(roles) {
  if (roles.includes('admin')) return 'index.html';
  if (roles.includes('contable')) return 'erp.html';
  if (roles.includes('ayudante')) return 'ayudante.html';
  if (roles.includes('instalador')) return 'instalacion.html';
  if (roles.includes('chofer')) return 'chofer.html';
  if (roles.includes('contratista') || roles.includes('fabrica')) return 'alucufel/index.html';
  if (roles.includes('cotizaciones')) return 'cotizaciones.html';
  return 'index.html';
}

// Ajusta el botón .btn-back de la página según el rol: lo apunta a su inicio, y si la página
// actual YA es su inicio, lo oculta. (No usar en las páginas dentro de ops/alucufel/, que tienen
// su propio "Volver" a su hub.)
export function wireBackButton(roles) {
  const back = document.querySelector('.btn-back');
  if (!back) return;
  const home = homePorRol(roles);
  const current = location.pathname.split('/').pop() || 'index.html';
  if (current === home) { back.style.display = 'none'; return; }
  back.setAttribute('href', home);
  back.setAttribute('title', 'Volver');
  back.textContent = '← Volver';
}

export { auth, signOut };
