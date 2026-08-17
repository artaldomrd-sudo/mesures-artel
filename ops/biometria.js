// Confirmación biométrica del personal (WebAuthn / Touch ID / Face ID / huella del propio dispositivo).
// Cada empleado registra su biometría UNA vez en SU teléfono; queda atada a su cuenta (usuarios/{email}).
// Al confirmar una acción, el dispositivo verifica su huella/cara LOCALMENTE (nunca sale del equipo) y
// resuelve si pasó. Prueba de que esa persona, con su dispositivo registrado, estuvo presente.
//
// Nota: la verificación es del lado del cliente (no hay verificación de firma en servidor). Para el uso
// real —evitar que un empleado marque en nombre de otro— es efectivo: exige la biometría registrada en
// SU teléfono. Requiere HTTPS (el sitio en producción) y un dispositivo con biometría de plataforma.
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

// ¿El dispositivo/navegador soporta biometría de plataforma? (síncrono, best-effort)
export function biometriaDisponible() {
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
}

// ¿Este usuario ya registró su biometría? (lee su doc en usuarios)
export async function biometriaRegistrada(usuario) {
  try {
    const s = await getDoc(doc(db, 'usuarios', usuario.email));
    return !!(s.exists() && s.data().biometria && s.data().biometria.credentialId);
  } catch (_) { return false; }
}

// Registra la biometría de ESTE dispositivo y guarda el credentialId en la cuenta del usuario.
export async function registrarBiometria(usuario) {
  if (!biometriaDisponible()) throw new Error('Este dispositivo/navegador no soporta biometría.');
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
  await updateDoc(doc(db, 'usuarios', usuario.email), {
    biometria: { credentialId: bufToB64url(cred.rawId), registradoEn: new Date().toISOString(), dispositivo: (navigator.userAgent || '').slice(0, 140) }
  });
  return true;
}

// Pide la biometría del usuario; resuelve (true) si pasó. Lanza Error('SIN_REGISTRO') si no ha registrado.
export async function confirmarBiometria(usuario) {
  if (!biometriaDisponible()) throw new Error('Este dispositivo/navegador no soporta biometría.');
  const s = await getDoc(doc(db, 'usuarios', usuario.email));
  const bio = s.exists() ? s.data().biometria : null;
  if (!bio || !bio.credentialId) throw new Error('SIN_REGISTRO');
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challenge(),
      allowCredentials: [{ id: b64urlToBuf(bio.credentialId), type: 'public-key', transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000
    }
  });
  if (!assertion) throw new Error('No se confirmó la biometría.');
  return true;
}
