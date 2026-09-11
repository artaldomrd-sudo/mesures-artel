// Segundo factor (2FA) DENTRO de la plataforma con app autenticadora (Google Authenticator, Authy,
// 1Password…), usando la autenticación multifactor TOTP de Firebase.
//
// · Obligatorio SOLO para admin (ROLES_2FA) — decisión del usuario 2026-09-12: contable y
//   comunicaciones siguen con PIN / Face-Touch ID en el día a día; el 2FA se reserva para las cuentas
//   admin y para la pantalla Usuarios y roles, donde se pide el código EN CADA ENTRADA
//   (`verificar2FA`, verificación reforzada: re-autentica con Google y exige el código TOTP).
//   Pendiente "eventualmente": endurecer las sesiones admin (caducidad, cierre remoto).
// · En cada inicio de sesión de una cuenta inscrita, Google pide la contraseña y luego la
//   plataforma pide el código de 6 dígitos (auth/multi-factor-auth-required → resolverMFASignIn).
// · Requisito de proyecto (un clic, lo hace el admin en Firebase Console): Authentication →
//   Sign-in method → Avanzado: Autenticación multifactor → activar TOTP (puede pedir «Actualizar a
//   Identity Platform», sin costo a esta escala). Si NO está activado, este módulo lo detecta, avisa
//   y deja pasar para no bloquear la plataforma.
// · Quien pierda el teléfono: un admin le quita el 2FA desde Usuarios y roles (Cloud Function
//   mfaReset) y al volver a entrar lo inscribe de nuevo.
import { auth, googleProvider, db } from './firebase-config.js';
import { rootPath } from './paths.js';
import { multiFactor, getMultiFactorResolver, TotpMultiFactorGenerator, reauthenticateWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { doc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

export const ROLES_2FA = ['admin'];
export const requiere2FA = (roles) => (roles || []).some(r => ROLES_2FA.includes(r));
export const tieneMFA = (user) => { try { return multiFactor(user).enrolledFactors.length > 0; } catch (_) { return false; } };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CSS = 'position:fixed;inset:0;background:#0A3D62;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:Arimo,sans-serif;text-align:center;padding:24px;z-index:10000;';
function overlay(html) {
    let el = document.getElementById('mfa-overlay');
    if (!el) { el = document.createElement('div'); el.id = 'mfa-overlay'; el.style.cssText = CSS; document.body.appendChild(el); }
    el.innerHTML = `<img src="${rootPath('logo.png')}" alt="ARTAL" style="height:56px;width:auto;object-fit:contain;">` + html;
    el.style.display = 'flex';
    return el;
}
const cerrar = () => { const el = document.getElementById('mfa-overlay'); if (el) el.remove(); };
const inputCss = 'font-size:26px;letter-spacing:8px;text-align:center;width:200px;padding:10px;border-radius:10px;border:none;font-family:Arimo;';
const btnCss = 'font-size:15px;padding:12px 22px;border-radius:10px;border:none;background:#fff;color:#0A3D62;cursor:pointer;font-weight:700;min-height:46px;';
const linkCss = 'background:transparent;border:1px solid #fff;color:#fff;border-radius:8px;padding:8px 14px;cursor:pointer;font-size:13px;';

// El proyecto todavía no tiene TOTP activado en Firebase Console → estos códigos de error.
const NO_ACTIVADO = new Set(['auth/operation-not-allowed', 'auth/admin-restricted-operation', 'auth/unsupported-first-factor', 'auth/mfa-not-enabled']);

// Librería de QR (cdnjs) cargada solo cuando hace falta; si no carga, se muestra la clave en texto.
function cargarQR() {
    return new Promise((res) => {
        if (window.QRCode) return res(true);
        const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s);
    });
}

// ---- Inicio de sesión de una cuenta que YA tiene 2FA: pedir el código ----
export function resolverMFASignIn(error) {
    return new Promise((resolve, reject) => {
        let resolver;
        try { resolver = getMultiFactorResolver(auth, error); } catch (e) { reject(e); return; }
        const hint = resolver.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) || resolver.hints[0];
        const el = overlay(`
            <h2 style="margin:0;font-size:20px;">Verificación en 2 pasos</h2>
            <p style="max-width:340px;margin:0;opacity:.9;">Abre tu app autenticadora y escribe el código de 6 dígitos de <b>ARTAL Operaciones</b>.</p>
            <input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" style="${inputCss}">
            <button id="mfa-ok" style="${btnCss}">Entrar</button>
            <div id="mfa-msg" style="min-height:20px;color:#ffd166;font-size:13px;"></div>
            <button id="mfa-cancel" style="${linkCss}">Cancelar</button>`);
        const inp = el.querySelector('#mfa-code'); inp.focus();
        const intentar = async () => {
            const code = (inp.value || '').replace(/\D/g, '');
            if (code.length !== 6) { el.querySelector('#mfa-msg').textContent = 'Son 6 dígitos.'; return; }
            el.querySelector('#mfa-ok').disabled = true;
            try {
                const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
                const cred = await resolver.resolveSignIn(assertion);
                cerrar(); resolve(cred);
            } catch (e) {
                el.querySelector('#mfa-ok').disabled = false; inp.value = ''; inp.focus();
                el.querySelector('#mfa-msg').textContent = e.code === 'auth/invalid-verification-code' ? 'Código incorrecto. Revisa la hora del teléfono e inténtalo de nuevo.' : ('Error: ' + (e.message || e.code));
            }
        };
        el.querySelector('#mfa-ok').onclick = intentar;
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') intentar(); };
        el.querySelector('#mfa-cancel').onclick = () => { cerrar(); reject(new Error('cancelado')); };
    });
}

// ---- Verificación reforzada (cada entrada a una pantalla crítica) ----
// Re-autentica con Google (con la cuenta ya iniciada, sin selector) y exige el código TOTP. Si la
// cuenta aún no tiene 2FA inscrito, la inscribe primero. Devuelve true si pasó; lanza si canceló/falló.
export async function verificar2FA(user) {
    if (!user) throw new Error('sin sesión');
    if (!tieneMFA(user)) {
        const ok = await inscribirMFA(user, user.email);
        if (!ok) return false;   // TOTP no activado en el proyecto: se avisó y se deja pasar
        return true;             // recién inscrito: el código acaba de validarse
    }
    const prov = new GoogleAuthProvider();
    prov.setCustomParameters({ login_hint: user.email });   // la misma cuenta, sin volver a elegir
    overlay('<h2 style="margin:0;font-size:20px;">Verificación reforzada</h2><p style="opacity:.9;margin:0;max-width:340px;">Esta pantalla pide el código de tu app autenticadora cada vez. Google confirmará tu cuenta primero…</p>');
    try {
        await reauthenticateWithPopup(user, prov);
        cerrar(); return true;   // (sin factor inscrito no debería llegar aquí)
    } catch (e) {
        if (e && e.code === 'auth/multi-factor-auth-required') { await resolverMFASignIn(e); return true; }
        cerrar(); throw e;
    }
}

// ---- Inscripción obligatoria (primera vez): QR + código de confirmación ----
export async function inscribirMFA(user, email) {
    let session, secret;
    try {
        try { session = await multiFactor(user).getSession(); }
        catch (e) {
            if (e.code !== 'auth/requires-recent-login') throw e;
            overlay('<h2 style="margin:0;font-size:20px;">Confirma tu identidad</h2><p style="opacity:.9;margin:0;">Para activar la verificación en 2 pasos, Google te pedirá volver a iniciar sesión.</p>');
            await reauthenticateWithPopup(user, googleProvider);
            session = await multiFactor(user).getSession();
        }
        secret = await TotpMultiFactorGenerator.generateSecret(session);
    } catch (e) {
        if (NO_ACTIVADO.has(e.code) || /multi.?factor|totp|not.?allowed|restricted/i.test(String(e.message))) {
            // No bloquear la plataforma: avisar al admin y seguir.
            console.warn('2FA no activado en el proyecto:', e.code, e.message);
            overlay(`<h2 style="margin:0;font-size:20px;">Verificación en 2 pasos pendiente</h2>
                <p style="max-width:380px;margin:0;opacity:.95;line-height:1.5;">Tu rol requiere 2FA, pero el proyecto aún no lo tiene activado.<br><b>Admin:</b> Firebase Console → Authentication → Sign-in method → <i>Autenticación multifactor</i> → activar <b>TOTP</b> (si pide «Actualizar a Identity Platform», aceptar).</p>
                <button id="mfa-seguir" style="${btnCss}">Continuar por ahora</button>
                <div style="font-size:11px;opacity:.6;">Detalle técnico: ${esc(e.code || '')} ${esc(e.message || '')}</div>`);
            await new Promise(r => { document.getElementById('mfa-seguir').onclick = r; });
            cerrar(); return false;
        }
        throw e;
    }
    const uri = secret.generateQrCodeUrl(email, 'ARTAL Operaciones');
    const el = overlay(`
        <h2 style="margin:0;font-size:20px;">Activa la verificación en 2 pasos</h2>
        <p style="max-width:380px;margin:0;opacity:.9;line-height:1.45;">Tu rol tiene acceso a información sensible. <b>1)</b> Abre <b>Google Authenticator</b> (o Authy) y escanea este código. <b>2)</b> Escribe abajo el código de 6 dígitos que te muestre.</p>
        <div id="mfa-qr" style="background:#fff;padding:10px;border-radius:12px;min-width:196px;min-height:196px;display:flex;align-items:center;justify-content:center;"></div>
        <details style="font-size:12px;opacity:.9;max-width:380px;"><summary style="cursor:pointer;">¿No puedes escanear? Clave manual</summary><code style="display:block;margin-top:6px;word-break:break-all;background:rgba(255,255,255,.12);padding:8px;border-radius:8px;">${esc(secret.secretKey)}</code></details>
        <input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" style="${inputCss}">
        <button id="mfa-ok" style="${btnCss}">Activar</button>
        <div id="mfa-msg" style="min-height:20px;color:#ffd166;font-size:13px;"></div>`);
    if (await cargarQR()) { try { new window.QRCode(el.querySelector('#mfa-qr'), { text: uri, width: 180, height: 180 }); } catch (_) { el.querySelector('#mfa-qr').textContent = 'Usa la clave manual'; } }
    else el.querySelector('#mfa-qr').textContent = 'Usa la clave manual de abajo';
    return new Promise((resolve) => {
        const inp = el.querySelector('#mfa-code');
        const intentar = async () => {
            const code = (inp.value || '').replace(/\D/g, '');
            if (code.length !== 6) { el.querySelector('#mfa-msg').textContent = 'Son 6 dígitos.'; return; }
            el.querySelector('#mfa-ok').disabled = true;
            try {
                const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
                await multiFactor(user).enroll(assertion, 'App autenticadora');
                try { await updateDoc(doc(db, 'usuarios', email), { mfa: true, mfaFecha: serverTimestamp() }); } catch (_) { }
                cerrar(); alert('✓ Verificación en 2 pasos activada. A partir de ahora, al iniciar sesión te pedirá el código de tu app autenticadora.'); resolve(true);
            } catch (e) {
                el.querySelector('#mfa-ok').disabled = false; inp.value = ''; inp.focus();
                el.querySelector('#mfa-msg').textContent = e.code === 'auth/invalid-verification-code' ? 'Código incorrecto. Escanea de nuevo o revisa la hora del teléfono.' : ('Error: ' + (e.message || e.code));
            }
        };
        el.querySelector('#mfa-ok').onclick = intentar;
        inp.onkeydown = (ev) => { if (ev.key === 'Enter') intentar(); };
    });
}
