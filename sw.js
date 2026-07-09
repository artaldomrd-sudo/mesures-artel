// Service worker de la app de toma de medidas: garantiza que index.html abra sin internet,
// incluso "en frío" (después de días sin usarla). Estrategia: red primero, y si falla, caché.
// Cada vez que hay red, se refresca el caché con la respuesta más reciente (no hay que subir
// un número de versión a mano para que se actualice sola).
//
// Solo intercepta el "cascarón" de la app de medidas (index.html, logo.png, fuentes, jsPDF/
// html2canvas) — todo lo demás (ops/*, Firestore, Firebase Auth/Storage) pasa de largo sin
// tocarlo, para no interferir con la plataforma de operaciones.
const CACHE_NAME = 'artal-shell-v1';
const SHELL_PATHS = ['./', './index.html', './logo.png', './manifest.json'];
const SHELL_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_PATHS)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
    );
    self.clients.claim();
});

function isShellRequest(request) {
    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        return SHELL_PATHS.some((p) => url.pathname.endsWith(p.replace('./', '')) || url.pathname === '/' );
    }
    return SHELL_ORIGINS.includes(url.hostname);
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET' || !isShellRequest(event.request)) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
