// Single Firebase initialisation shared by every module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

export { isFirebaseConfigured };

let app = null;
let db = null;

if (isFirebaseConfigured) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app, firebaseConfig.databaseURL);
}

export { app, db };
