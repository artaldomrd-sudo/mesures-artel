// Config y arranque de Firebase, compartido por index.html y las pantallas de ops/.
// Un solo lugar: si cambia el proyecto Firebase, se edita solo aquí.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, initializeAuth, browserSessionPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAuEq8dewRrmpY-N9N0w6gz5bkj98qDBlE",
  authDomain: "artal-operaciones.firebaseapp.com",
  projectId: "artal-operaciones",
  storageBucket: "artal-operaciones.firebasestorage.app",
  messagingSenderId: "289748131568",
  appId: "1:289748131568:web:bcf0b5122d529ac399ac35"
};

// Web Push certificate (VAPID) de Cloud Messaging — pública, normal tenerla en el cliente.
export const VAPID_KEY = "BImYp9huvMwbjvp-o_1IgwEm0B4q-xFhnPtNS4CZDf8xzMAS0tKxsd3ZU0MvHNCbtai1TuulSMn9n2iL56krmbM";

const app = initializeApp(firebaseConfig);

// «👁 Ver como…» (2026-11-03, Dylan: «debo poder ver la pantalla de Wilson o quien sea en cualquier momento, rápido y fácil»).
// Una pestaña abierta desde el botón del Panel trae `?vercomo=<n>`: ESA pestaña (y solo esa, vía sessionStorage) usa una segunda app
// de Firebase con sesión por pestaña y caché en memoria, y entra sola con la cuenta espejo (las credenciales las deja el Panel en
// localStorage `artal_vercomo_<n>` y se borran al leerlas). La sesión de Dylan en las demás pestañas no se toca.
let VER_COMO = null;
try {
  const q = new URLSearchParams(location.search).get('vercomo');
  if (q) { sessionStorage.setItem('artal_vercomo', q); const u = new URL(location.href); u.searchParams.delete('vercomo'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
  VER_COMO = sessionStorage.getItem('artal_vercomo');
} catch (_) { VER_COMO = null; }
export const verComoActivo = !!VER_COMO;
const appDatos = VER_COMO ? initializeApp(firebaseConfig, 'vercomo') : app;

// Persistencia offline multi-pestaña: para que el cuaderno de medidas siga funcionando sin
// señal en la obra (y sincronice solo al recuperarla), y para que las pantallas de ops/ (varias
// se usan abiertas a la vez) no choquen entre sí — el manager de una sola pestaña rompería con
// "failed-precondition" en la segunda pestaña abierta. (La pestaña «Ver como» usa caché en memoria: no mezcla datos.)
export const db = VER_COMO ? initializeFirestore(appDatos, { localCache: memoryLocalCache() }) : initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const auth = VER_COMO ? initializeAuth(appDatos, { persistence: browserSessionPersistence }) : getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Mostrar SIEMPRE el selector de cuenta de Google. Sin esto, en un teléfono con una sola cuenta de
// Google iniciada (ej. la general de ARTAL) Google entra directo con esa y no deja elegir otra —
// justo lo que impedía entrar con el correo personal (2026-09-11).
googleProvider.setCustomParameters({ prompt: 'select_account' });
export const storage = getStorage(appDatos);

if (VER_COMO) {
  try {
    const k = 'artal_vercomo_' + VER_COMO; const raw = localStorage.getItem(k);
    if (raw) { localStorage.removeItem(k); const c = JSON.parse(raw); if (c && c.email && c.password && Date.now() - (c.t || 0) < 10 * 60 * 1000) await signInWithEmailAndPassword(auth, c.email, c.password); }
  } catch (e) { console.warn('ver como', e && (e.code || e.message)); }
}
// Cierra la vista «Ver como» de esta pestaña (solo la segunda app; la sesión real sigue intacta).
export async function salirVerComo() {
  try { sessionStorage.removeItem('artal_vercomo'); } catch (_) { }
  try { await signOut(auth); } catch (_) { }
  window.close();
  setTimeout(() => { location.href = location.pathname.replace(/[^/]*$/, '') + 'index.html'; }, 300);
}
