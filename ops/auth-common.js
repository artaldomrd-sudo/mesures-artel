// Login con Google + verificación de rol contra la colección `usuarios`.
// Uso en cada pantalla de rol:
//   import { requireAuth } from './auth-common.js';
//   const usuario = await requireAuth(['fabrica']); // admin siempre pasa
//   // usuario = { email, nombre, rol }
import { auth, googleProvider, db } from './firebase-config.js';
import { rootPath } from './paths.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { paginaActual, aplicarPermisosEnlaces } from './paginas.js';

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
  clearTimeout(vigilante);
}

// --- Blindaje contra el cuelgue en "Verificando acceso…" (visto en iPad Safari, 2026-09-21) ---
// En iOS, Firestore con caché persistente multi-pestaña puede quedarse esperando a otra pestaña
// suspendida (la app del Dock, otra pestaña de Safari) y `getDoc` no responde nunca; también puede
// colgarse la sesión de 2FA o la red. Antes eso dejaba la pantalla azul para siempre. Ahora:
//  - la lectura del usuario tiene tiempo límite (`conTiempo`);
//  - la primera vez que vence, la página se recarga sola UNA vez (arregla el bloqueo de pestañas);
//  - si vuelve a fallar, o pasan 30 s sin salir de "Verificando", aparece una pantalla con
//    "Reintentar" y "Cerrar sesión" en vez del cuelgue.
const CLAVE_REINTENTO = 'artal_auth_reintento';
let vigilante = null;
function conTiempo(promesa, ms, etiqueta) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sin respuesta en ' + Math.round(ms / 1000) + ' s (' + etiqueta + ')')), ms);
    promesa.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
function showRetryScreen(detalle) {
  clearTimeout(vigilante);
  const el = showOverlay(
    '<img src="' + rootPath('logo.png') + '" alt="ARTAL" style="height:56px;width:auto;object-fit:contain;">' +
    '<h2 style="margin:0;font-size:20px;">La verificación está tardando demasiado</h2>' +
    '<p style="max-width:380px;margin:0;opacity:.9;line-height:1.45;">Suele pasar cuando hay otra pestaña o la app del Dock abierta con la plataforma, o con mala señal. Cierra las otras pestañas de ARTAL y vuelve a intentar.</p>' +
    '<button id="auth-reintentar" style="background:#fff;color:#0A3D62;border:none;border-radius:10px;padding:12px 22px;font-size:16px;font-weight:700;cursor:pointer;">Reintentar</button>' +
    '<button id="auth-salir" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:10px;padding:10px 18px;font-size:14px;cursor:pointer;">Cerrar sesión y volver a entrar</button>' +
    '<div style="font-size:11px;opacity:.6;max-width:380px;">' + String(detalle || '').replace(/[<>&]/g, '') + '</div>'
  );
  el.querySelector('#auth-reintentar').onclick = () => { try { sessionStorage.removeItem(CLAVE_REINTENTO); } catch (_) {} location.reload(); };
  el.querySelector('#auth-salir').onclick = async () => {
    try { sessionStorage.removeItem(CLAVE_REINTENTO); } catch (_) {}
    try { await conTiempo(signOut(auth), 5000, 'cerrar sesión'); } catch (_) {}
    location.reload();
  };
}
// Primera vez: recarga sola. Segunda: pantalla de reintento.
function fallaVerificacion(detalle) {
  let ya = false;
  try { ya = sessionStorage.getItem(CLAVE_REINTENTO) === '1'; if (!ya) sessionStorage.setItem(CLAVE_REINTENTO, '1'); } catch (_) { ya = true; }
  console.warn('requireAuth:', detalle);
  if (!ya) { location.reload(); return; }
  showRetryScreen(detalle);
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
    signInWithPopup(auth, googleProvider).catch(async (err) => {
      // Cuenta con verificación en 2 pasos: Google ya validó la contraseña; ahora el código.
      if (err && err.code === 'auth/multi-factor-auth-required') {
        try { const m = await import('./mfa.js'); await m.resolverMFASignIn(err); }
        catch (e) { if (e && e.message !== 'cancelado') alert('No se pudo completar la verificación: ' + (e.message || e)); }
        return;
      }
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
  clearTimeout(vigilante);
  vigilante = setTimeout(() => {
    const el = document.getElementById('auth-overlay');
    const sigueVerificando = el && el.style.display !== 'none' && /Verificando acceso/.test(el.textContent || '');
    if (sigueVerificando && !document.getElementById('mfa-overlay')) fallaVerificacion('30 s en "Verificando acceso…"');
  }, 30000);
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user || !user.email) {
        clearTimeout(vigilante);
        showLoginScreen();
        return;
      }
      let snap;
      try { snap = await conTiempo(getDoc(doc(db, 'usuarios', user.email)), 15000, 'leer usuario'); }
      catch (e) { fallaVerificacion(e && e.message ? e.message : String(e)); return; }
      const data = snap.exists() ? snap.data() : null;
      const roles = data ? (Array.isArray(data.rol) ? data.rol : [data.rol]) : [];
      // Permisos por página (Usuarios y roles): `paginasBloqueadas` quita lo que el rol da;
      // `paginasExtra` da lo que el rol no da. Admin nunca se bloquea. Ver ops/paginas.js.
      const paginasExtra = data && Array.isArray(data.paginasExtra) ? data.paginasExtra : [];
      const paginasBloqueadas = data && Array.isArray(data.paginasBloqueadas) ? data.paginasBloqueadas : [];
      const pagId = paginaActual();
      const porRol = roles.includes('lector') || roles.some((r) => rolesPermitidos.includes(r));
      const autorizado = roles.includes('admin') || (!paginasBloqueadas.includes(pagId) && (porRol || paginasExtra.includes(pagId)));
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
      // Roles sensibles (admin/contable/comunicaciones): verificación en 2 pasos obligatoria. Si la
      // cuenta aún no la tiene, se inscribe aquí mismo (QR + código) antes de mostrar la pantalla.
      try {
        const m = await import('./mfa.js');
        if (m.requiere2FA(roles) && !m.tieneMFA(user)) await m.inscribirMFA(user, user.email);
      } catch (e) { console.warn('2FA', e && e.message ? e.message : e); }
      // Parte diario pendiente (encargados de instalación): hasta ponerse al día solo pueden usar
      // ops/parte-diario.html — desde cualquier otra pantalla se les manda ahí (regla del usuario:
      // "si no rellenan no pueden hacer más nada en la plataforma"). Admin nunca se bloquea.
      // Pantallas que NO se bloquean por un parte pendiente: el propio parte y Transportes (Wilson es
      // chofer además de encargado; entregar material no puede esperar al parte — pedido del usuario 2026-09-22).
      const SIN_BLOQUEO_PARTE = ['parte-diario.html', 'chofer.html', 'academia.html'];   // Academia: las guías se consultan siempre
      if (!roles.includes('admin') && !SIN_BLOQUEO_PARTE.includes(pagId)) {
        try {
          const g = await import('./parte-gate.js');
          const pend = await g.partesPendientes(user.email);
          if (pend.length) {
            const carpeta = location.pathname.replace(/[^/]*$/, ''), opsIdx = carpeta.indexOf('/ops/');
            const prof = opsIdx === -1 ? 0 : carpeta.slice(opsIdx + '/ops/'.length).split('/').filter(Boolean).length;
            location.replace('../'.repeat(prof) + 'parte-diario.html?bloqueo=1&fecha=' + pend[pend.length - 1]);
            return;
          }
        } catch (e) { console.warn('parte-gate', e && e.message ? e.message : e); }
      }
      hideOverlay();
      try { sessionStorage.removeItem(CLAVE_REINTENTO); } catch (_) {}
      // Renueva en silencio el token de notificaciones de ESTE dispositivo (si el permiso ya fue
      // concedido) — así nunca "se desactivan" por rotación del token ni porque otro dispositivo
      // activó las suyas. Best-effort: no bloquea la página ni muestra nada si falla.
      import('./notifications.js').then((m) => m.refrescarNotificaciones && m.refrescarNotificaciones({ pedir: data.pedirNotificaciones === true })).catch(() => {});
      const usuarioObj = { email: user.email, nombre: data.nombre || user.email, rol: roles[0], roles, paginasExtra, paginasBloqueadas };
      // Esconde mosaicos/enlaces a páginas que no puede ver (hubs). Se repite un momento después por
      // si la página dibuja sus mosaicos con JS tras cargar.
      const ocultar = () => { try { aplicarPermisosEnlaces(usuarioObj); } catch (_) {} };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ocultar); else ocultar();
      setTimeout(ocultar, 800);
      resolve(usuarioObj);
    });
  });
}

// Inicio (home) de cada rol: a dónde debe llevar el botón "Volver". El Panel de Control
// (index.html) es solo de admin, así que un rol que no sea admin no debe caer ahí.
export function homePorRol(roles) {
  if (roles.includes('admin')) return 'index.html';
  if (roles.includes('contable')) return 'erp.html';
  // Instalador y ayudante comparten el mismo hub (instalacion.html) — antes había dos hubs
  // casi idénticos (ayudante.html), ahora unificados para no duplicar.
  if (roles.includes('instalador') || roles.includes('ayudante')) return 'instalacion.html';
  if (roles.includes('chofer')) return 'chofer.html';
  if (roles.includes('contratista') || roles.includes('fabrica')) return 'alucufel/index.html';
  if (roles.includes('cotizaciones')) return 'cotizaciones.html';
  // Roles del inbox omnicanal (WhatsApp): su inicio es la bandeja compartida.
  if (roles.some((r) => ['inbox_admin', 'inbox_supervisor', 'inbox_agente', 'inbox_lector'].includes(r))) return 'inbox.html';
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
