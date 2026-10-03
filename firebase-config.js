// VishvaX Stream — environment configuration.
// These values are public identifiers, not secrets; access is enforced by database.rules.json.
export const firebaseConfig = {
    apiKey: "AIzaSyDueESE-tmtcCjsBx_RIqZBP3BjOthaJ9M",
    authDomain: "stream-vishvax.firebaseapp.com",
    projectId: "stream-vishvax",
    storageBucket: "stream-vishvax.firebasestorage.app",
    messagingSenderId: "995459219623",
    appId: "1:995459219623:web:5c49316dd7958755251b82",
    // Copy the exact URL from Firebase console → Realtime Database (it depends on the region you chose),
    // e.g. "https://stream-vishvax-default-rtdb.firebaseio.com" or "https://<name>-default-rtdb.<region>.firebasedatabase.app".
    // If left empty the SDK assumes the default US instance for this project.
    databaseURL: "https://stream-vishvax-default-rtdb.firebaseio.com"
};

export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

