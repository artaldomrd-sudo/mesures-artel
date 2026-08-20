// Botón flotante de "Mensajería ARTAL" — se inyecta en cualquier pantalla de ops/ que lo importe,
// para que TODO usuario (desde su propia pantalla) pueda llegar a los mensajes que le corresponden.
//
// Uso (una línea al final del <script type="module"> de la página, o un módulo suelto):
//   import './mensajeria-widget.js';
//
// Es autónomo: escucha la sesión por su cuenta (no depende del requireAuth de la página) y muestra
// un círculo rojo con la cantidad de mensajes sin leer del usuario actual. Al tocar, abre
// mensajes.html (resolviendo la ruta según la profundidad de la página bajo ops/).
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { collection, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

// Ruta a un archivo dentro de ops/ desde la página actual (ops/*.html → 'x.html';
// ops/alucufel/*.html → '../x.html'). Distinta de rootPath() de paths.js, que apunta a la RAÍZ
// del sitio (un nivel arriba de ops/).
function opsPath(file) {
    const carpeta = location.pathname.replace(/[^/]*$/, '');
    const i = carpeta.indexOf('/ops/');
    if (i === -1) return file;
    const prof = carpeta.slice(i + 5).split('/').filter(Boolean).length;
    return '../'.repeat(prof) + file;
}

const sanitKey = (email) => String(email || '').toLowerCase().replace(/[.@]/g, '_');

// No mostrar el botón en la propia pantalla de mensajes (sería redundante).
const enMensajes = /\/mensajes\.html$/.test(location.pathname);

let btn, badge;
function inyectar() {
    if (btn || enMensajes) return;
    if (!document.getElementById('msg-widget-styles')) {
        const st = document.createElement('style');
        st.id = 'msg-widget-styles';
        st.textContent = `
        #msg-fab { position: fixed; right: 16px; bottom: 16px; z-index: 900; display: flex; align-items: center; gap: 8px;
            background: var(--artal-blue, #1C4E7A); color: #fff; border: none; border-radius: 26px; padding: 11px 16px 11px 14px;
            font-family: 'Arimo', sans-serif; font-weight: bold; font-size: 13.5px; cursor: pointer; text-decoration: none;
            box-shadow: 0 6px 18px rgba(0,0,0,.22); transition: transform .08s, box-shadow .12s; }
        #msg-fab:hover { transform: translateY(-2px); box-shadow: 0 9px 24px rgba(0,0,0,.28); }
        #msg-fab .ic { font-size: 17px; line-height: 1; }
        #msg-fab .badge { position: absolute; top: -5px; right: -3px; min-width: 20px; height: 20px; padding: 0 5px;
            background: #e2211c; color: #fff; border-radius: 11px; font-size: 11.5px; font-weight: bold; line-height: 20px;
            text-align: center; box-shadow: 0 0 0 2px #fff; display: none; }
        #msg-fab .badge.show { display: block; }
        @media (max-width: 560px) { #msg-fab .lbl { display: none; } #msg-fab { padding: 12px; border-radius: 50%; } }
        `;
        document.head.appendChild(st);
    }
    btn = document.createElement('a');
    btn.id = 'msg-fab';
    btn.href = opsPath('mensajes.html');
    btn.title = 'Mensajería ARTAL';
    btn.innerHTML = `<span class="ic">✉️</span><span class="lbl">Mensajes</span><span class="badge" id="msg-fab-badge"></span>`;
    document.body.appendChild(btn);
    badge = document.getElementById('msg-fab-badge');
}

function setBadge(n) {
    if (!badge) return;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('show', n > 0);
}

onAuthStateChanged(auth, (user) => {
    if (!user || !user.email) return;
    inyectar();
    const miEmail = user.email;
    const miKey = sanitKey(miEmail);
    // Volumen bajo (comunicados internos): traemos los enviados y filtramos en el cliente los que
    // me corresponden y aún no marqué leídos — sin índices compuestos ni consultas combinadas.
    onSnapshot(query(collection(db, 'mensajes'), where('estado', '==', 'enviado')), (snap) => {
        let n = 0;
        snap.forEach(d => {
            const m = d.data();
            const paraMi = m.paraTodos === true || (Array.isArray(m.destinatarios) && m.destinatarios.includes(miEmail));
            if (!paraMi) return;
            if (m.remitenteEmail === miEmail) return;            // lo que yo mismo envié no cuenta como "sin leer"
            const ac = (m.acuses || {})[miKey];
            if (!ac || ac.leido !== true) n++;
        });
        setBadge(n);
    }, () => { /* colección vacía o reglas sin publicar: sin badge, no romper la página */ });
});
