// Static Admin Authentication Module for VishvaX Stream
// Validates credentials using SHA-256 cryptographic hash comparison.
// Neither the plain password nor credentials are exposed in source or HTML.

const AUTH_HASH = "a62fba49d9f32fc4f4bed46492d90e77b88bfb1957f47bc67f40113894585355";
const SESSION_KEY = "vx_admin_session";
const SESSION_VAL = "vx_admin_active";

async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isAuthenticated() {
    try {
        return sessionStorage.getItem(SESSION_KEY) === SESSION_VAL;
    } catch {
        return false;
    }
}

export async function login(userId, password) {
    const cleanId = (userId || "").trim().toLowerCase();
    const cleanPass = password || "";
    
    // Hash check against combined credential hash
    const inputHash = await sha256(`${cleanId}:${cleanPass}`);
    const inputHashTrimmed = await sha256(`${cleanId}:${cleanPass.trim()}`);
    
    if (inputHash === AUTH_HASH || inputHashTrimmed === AUTH_HASH) {
        try {
            sessionStorage.setItem(SESSION_KEY, SESSION_VAL);
        } catch {
            // sessionStorage blocked/unavailable
        }
        return true;
    }
    throw new Error("Invalid credentials");
}

export function logout() {
    try {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.clear();
    } catch {
        // ignore
    }
}
