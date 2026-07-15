// Config y arranque de Firebase, compartido por index.html y las pantallas de ops/.
// Un solo lugar: si cambia el proyecto Firebase, se edita solo aquí.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
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

// experimentalForceLongPolling: Firestore usa long-polling (peticiones normales) en vez del
// canal de streaming (WebChannel). Safari con "Impedir rastreo entre sitios" bloquea ese
// streaming ("Fetch API cannot load … due to access control checks"), lo que impedía leer la
// base y daba un falso "Sin autorización". Forzando long-polling nunca se intenta el canal
// bloqueado, así que la app conecta igual en Safari/iPhone. (Un pelín menos eficiente, pero
// funciona en todos lados.)
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const storage = getStorage(app);
