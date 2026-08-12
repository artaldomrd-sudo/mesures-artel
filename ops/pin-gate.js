// PIN por usuario para las áreas sensibles del ERP.
//
// Cada persona tiene su propio PIN (4-6 dígitos), guardado HASHEADO en usuarios/{email}.pinHash
// (nunca en texto plano). Una página protegida llama, justo después de requireAuth:
//     import { requirePin } from './pin-gate.js';
//     await requirePin(usuario);
// Muestra un overlay bloqueante hasta que el usuario ponga su PIN (o cree uno la primera vez). El
// desbloqueo se recuerda por SESIÓN durante UNLOCK_MIN minutos (se guarda en sessionStorage): así
// no hay que reescribirlo al navegar entre páginas del ERP, pero si la sesión queda abierta e
// inactiva, al rato vuelve a pedirlo — que es justo la protección buscada (no basta con dejar la
// sesión de Google abierta).
//
// Para RESETEAR el PIN de alguien que lo olvidó: un admin borra el campo `pinHash` de su
// usuarios/{email} (más adelante habrá un botón; por ahora se hace desde Firebase Console).

import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const UNLOCK_MIN = 10;   // minutos que dura el desbloqueo antes de volver a pedir el PIN

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sha256(txt) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Sal por usuario (el email) para que el mismo PIN de dos personas dé hashes distintos.
const hashPin = (email, pin) => sha256('ARTAL-ERP:' + email + ':' + pin);

const desbloqueado = () => Date.now() < Number(sessionStorage.getItem('erpPinOkUntil') || 0);
const marcarDesbloqueado = () => sessionStorage.setItem('erpPinOkUntil', String(Date.now() + UNLOCK_MIN * 60000));

function inyectarEstilos() {
    if (document.getElementById('pin-gate-css')) return;
    const s = document.createElement('style');
    s.id = 'pin-gate-css';
    s.textContent = `
    .pin-ov { position: fixed; inset: 0; z-index: 100000; background: linear-gradient(160deg,#173a5c,#0f2740); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .pin-box { background: #fff; border-radius: 18px; width: 100%; max-width: 340px; padding: 26px 24px; box-shadow: 0 20px 60px -20px rgba(0,0,0,.6); font-family: 'Arimo', Arial, sans-serif; text-align: center; }
    .pin-logo { width: 52px; height: 52px; border-radius: 13px; background: #1c4e7a; color: #fff; font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; }
    .pin-box h2 { color: #1c4e7a; font-size: 19px; margin: 0 0 4px; }
    .pin-sub { color: #6a7684; font-size: 13px; margin: 0 0 16px; }
    .pin-box input { width: 100%; box-sizing: border-box; text-align: center; letter-spacing: 8px; font-size: 22px; padding: 12px; border: 1.5px solid #d7dee6; border-radius: 10px; font-family: 'Arimo'; margin-bottom: 10px; }
    .pin-box input:focus { outline: none; border-color: #1c4e7a; }
    .pin-err { color: #c0392b; font-size: 13px; font-weight: bold; min-height: 18px; margin-bottom: 6px; }
    .pin-btn { width: 100%; background: #1c4e7a; color: #fff; border: none; border-radius: 10px; padding: 13px; font-weight: bold; font-size: 15px; cursor: pointer; font-family: 'Arimo'; min-height: 48px; }
    .pin-salir { background: transparent; border: none; color: #8a93a0; font-size: 13px; cursor: pointer; font-family: 'Arimo'; margin-top: 12px; }`;
    document.head.appendChild(s);
}

export async function requirePin(usuario) {
    if (!usuario || !usuario.email) return;      // sin usuario no hay a quién pedirle PIN
    if (desbloqueado()) return;

    const ref = doc(db, 'usuarios', usuario.email);
    let pinHash = null;
    try { const snap = await getDoc(ref); pinHash = snap.exists() ? (snap.data().pinHash || null) : null; } catch (e) { /* si falla la lectura, se pide crear */ }

    inyectarEstilos();
    const crear = !pinHash;
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.className = 'pin-ov';
        ov.innerHTML = `<div class="pin-box">
            <div class="pin-logo">ARTAL</div>
            <h2>${crear ? 'Crea tu PIN de acceso' : 'Ingresa tu PIN'}</h2>
            <p class="pin-sub">${crear ? 'Tu clave personal para el ERP (4 a 6 dígitos). No la compartas.' : 'Área protegida · ' + esc(usuario.nombre || '')}</p>
            <input id="pin1" type="password" inputmode="numeric" maxlength="6" placeholder="••••" autocomplete="off">
            ${crear ? '<input id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="Repite el PIN" autocomplete="off">' : ''}
            <div class="pin-err" id="pin-err"></div>
            <button class="pin-btn" id="pin-ok">${crear ? 'Guardar PIN' : 'Entrar'}</button>
            <button class="pin-salir" id="pin-salir">← Volver</button>
        </div>`;
        document.body.appendChild(ov);
        const err = (t) => { ov.querySelector('#pin-err').textContent = t; };
        const p1 = ov.querySelector('#pin1');
        setTimeout(() => p1.focus(), 50);
        ov.querySelector('#pin-salir').onclick = () => { history.length > 1 ? history.back() : (location.href = 'erp.html'); };

        async function submit() {
            const v1 = (p1.value || '').trim();
            if (!/^\d{4,6}$/.test(v1)) { err('El PIN debe tener de 4 a 6 dígitos.'); return; }
            if (crear) {
                const v2 = (ov.querySelector('#pin2').value || '').trim();
                if (v1 !== v2) { err('Los PIN no coinciden.'); return; }
                try { await updateDoc(ref, { pinHash: await hashPin(usuario.email, v1), pinFecha: serverTimestamp() }); }
                catch (e) { err('No se pudo guardar: ' + (e && e.message ? e.message : e)); return; }
                marcarDesbloqueado(); ov.remove(); resolve();
            } else {
                if (await hashPin(usuario.email, v1) === pinHash) { marcarDesbloqueado(); ov.remove(); resolve(); }
                else err('PIN incorrecto.');
            }
        }
        ov.querySelector('#pin-ok').onclick = submit;
        ov.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    });
}
