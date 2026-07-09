// Config y arranque de Firebase, compartido por index.html y las pantallas de ops/.
// Un solo lugar: si cambia el proyecto Firebase, se edita solo aquí.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const storage = getStorage(app);
