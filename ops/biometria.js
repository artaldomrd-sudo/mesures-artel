// Confirmación biométrica del personal (WebAuthn / Touch ID / Face ID / Windows Hello / huella del
// propio dispositivo). Cada empleado registra su biometría en CADA dispositivo que use (celular, Mac,
// etc.); todas se guardan como una LISTA en usuarios/{email}.biometrias, así una no pisa a la otra.
// El dispositivo verifica la huella/cara LOCALMENTE (nunca sale del equipo) y resuelve si pasó.
//
// Nota: la verificación es del lado del cliente (no hay verificación de firma en servidor). Para el uso
// real —evitar que un empleado marque en nombre de otro— es efectivo. Requiere HTTPS (producción) y un
// dispositivo con biometría de PLATAFORMA (built-in): en un equipo sin biometría no se ofrece la opción.
import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function bufToB64url(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(b64) {
  b64 = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}
function challenge() { const a = new Uint8Array(32); crypto.getRandomValues(a); return a; }

function apiDisponible() {
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
}

// ¿Este equipo tiene biometría de PLATAFORMA (Touch ID / Face ID / Windows Hello / huella)? — async.
// Un desktop sin biometría devuelve false → la app no muestra el botón, se usa el PIN.
export async function biometriaDisponible() {
  if (!apiDisponible()) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch (_) { return false; }
}

// Todos los credentialId registrados del usuario (lista nueva + el campo viejo `biometria`, por compat).
function credsDe(d) {
  const out = [];
  if (d) {
    if (Array.isArray(d.biometrias)) d.biometrias.forEach((b) => { if (b && b.credentialId) out.push(b.credentialId); });
    if (d.biometria && d.biometria.credentialId) out.push(d.biometria.credentialId);
  }
  return [...new Set(out)];
}

// ¿El usuario ya registró biometría en ALGÚN dispositivo?
export async function biometriaRegistrada(usuario) {
  try { const s = await getDoc(doc(db, 'usuarios', usuario.email)); return credsDe(s.exists() ? s.data() : null).length > 0; }
  catch (_) { return false; }
}

// Registra la biometría de ESTE dispositivo y la AGREGA a la lista del usuario (sin pisar las otras).
export async function registrarBiometria(usuario) {
  if (!apiDisponible()) throw new Error('Este dispositivo/navegador no soporta biometría.');
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: 'ARTAL Operaciones', id: location.hostname },
      user: { id: new TextEncoder().encode(usuario.email), name: usuario.email, displayName: usuario.nombre || usuario.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none'
    }
  });
  if (!cred || !cred.rawId) throw new Error('No se pudo registrar la biometría.');
  const entrada = { credentialId: bufToB64url(cred.rawId), registradoEn: new Date().toISOString(), dispositivo: (navigator.userAgent || '').slice(0, 140) };
  const ref = doc(db, 'usuarios', usuario.email);
  let prev = [];
  try {
    const s = await getDoc(ref); const d = s.exists() ? s.data() : null;
    if (d && Array.isArray(d.biometrias)) prev = d.biometrias.slice();
    if (d && d.biometria && d.biometria.credentialId) prev = prev.concat([d.biometria]);   // migra el viejo a la lista
  } catch (_) { }
  const lista = prev.filter((b) => b && b.credentialId && b.credentialId !== entrada.credentialId).concat([entrada]).slice(-8);
  await updateDoc(ref, { biometrias: lista });
  return true;
}

// Pide la biometría del usuario en ESTE dispositivo; resuelve (true) si pasó. Lanza Error('SIN_REGISTRO')
// si no ha registrado ninguna. allowCredentials lleva TODAS sus credenciales; el equipo usa la que tenga.
export async function confirmarBiometria(usuario) {
  if (!apiDisponible()) throw new Error('Este dispositivo/navegador no soporta biometría.');
  const s = await getDoc(doc(db, 'usuarios', usuario.email));
  const ids = credsDe(s.exists() ? s.data() : null);
  if (!ids.length) throw new Error('SIN_REGISTRO');
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challenge(),
      allowCredentials: ids.map((id) => ({ id: b64urlToBuf(id), type: 'public-key', transports: ['internal'] })),
      userVerification: 'required',
      timeout: 60000
    }
  });
  if (!assertion) throw new Error('No se confirmó la biometría.');
  return true;
}
