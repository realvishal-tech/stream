// Realtime Database access layer. All database operations live here.
import {
    ref, onValue, get, push, set, update, remove, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { db } from "./firebase-init.js";
import { isValidStreamUrl } from "./source-detector.js";

export const STREAM_TYPES = ["auto", "youtube", "hls", "dash", "mp4", "webm", "ogg", "iframe"];
export const STREAM_STATUSES = ["live", "offline"];
export const DEFAULT_SETTINGS = Object.freeze({
    siteName: "VishvaX Stream",
    siteDescription: "Watch live streams on VishvaX Stream.",
    maintenanceMode: false,
    maintenanceMessage: "VishvaX Stream is under maintenance. Please check back soon.",
    defaultStreamId: "",
    footerText: "© VishvaX Stream · stream.vishvax.in",
    emptyMessage: "No live streams available.",
    categories: "Sports, Live, News, Entertainment, Other"
});

const requireDb = () => { if (!db) throw new Error("Firebase is not configured."); return db; };

/** @returns {string|null} an error message, or null when valid. */
export function validateStream(d) {
    const title = typeof d.title === "string" ? d.title.trim() : "";
    if (!title || title.length > 120) return "Title is required (max 120 characters).";
    if (!isValidStreamUrl(d.url) || d.url.length > 2000) return "Streaming URL must start with http:// or https://";
    const cat = typeof d.category === "string" ? d.category.trim() : "";
    if (!cat || cat.length > 40) return "Category is required (max 40 characters).";
    if (d.thumbnail && !isValidStreamUrl(d.thumbnail)) return "Thumbnail must be an http(s) URL.";
    if (d.description && d.description.length > 300) return "Description is too long (max 300 characters).";
    if (!STREAM_STATUSES.includes(d.status)) return "Status must be live or offline.";
    if (!STREAM_TYPES.includes(d.type)) return "Invalid source type.";
    if (typeof d.featured !== "boolean") return "Featured must be on or off.";
    if (!Number.isInteger(d.sortOrder) || d.sortOrder < 0) return "Sort order must be a whole number (0 or more).";
    return null;
}

function clean(d) {
    return {
        title: d.title.trim(), url: d.url.trim(), type: d.type, category: d.category.trim(),
        thumbnail: (d.thumbnail || "").trim(), description: (d.description || "").trim(),
        status: d.status, featured: d.featured, sortOrder: d.sortOrder
    };
}

function assertValid(d) {
    const err = validateStream(d);
    if (err) throw new Error(err);
}

const toList = (val) => Object.entries(val || {})
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

/** One-off read. */
export async function getStreams() {
    return toList((await get(ref(requireDb(), "streams"))).val());
}

/** Realtime listener on /streams. Returns an unsubscribe function. */
export function subscribeToStreams(callback, onError) {
    if (!db) { onError(new Error("Firebase is not configured.")); return () => {}; }
    return onValue(ref(db, "streams"), (snap) => callback(toList(snap.val())), onError);
}

export async function addStream(data) {
    assertValid(data);
    const node = push(ref(requireDb(), "streams"));
    await set(node, { ...clean(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return node.key;
}

export async function updateStream(id, data) {
    assertValid(data);
    await update(ref(requireDb(), `streams/${id}`), { ...clean(data), updatedAt: serverTimestamp() });
}

export const deleteStream = (id) => remove(ref(requireDb(), `streams/${id}`));

export async function updateStreamStatus(id, status) {
    if (!STREAM_STATUSES.includes(status)) throw new Error("Status must be live or offline.");
    await update(ref(requireDb(), `streams/${id}`), { status, updatedAt: serverTimestamp() });
}

/** Makes `id` the only featured stream (pass null to clear). Single atomic multi-path update. */
export async function setFeaturedStream(id) {
    const all = await getStreams();
    const updates = {};
    all.forEach((s) => {
        if (Boolean(s.featured) !== (s.id === id)) {
            updates[`${s.id}/featured`] = s.id === id;
            updates[`${s.id}/updatedAt`] = serverTimestamp();
        }
    });
    if (Object.keys(updates).length) await update(ref(requireDb(), "streams"), updates);
}

const withDefaults = (val) => ({ ...DEFAULT_SETTINGS, ...(val || {}) });

export async function getSettings() {
    return withDefaults((await get(ref(requireDb(), "settings"))).val());
}

export function subscribeToSettings(callback, onError = () => {}) {
    if (!db) return () => {};
    return onValue(ref(db, "settings"), (snap) => callback(withDefaults(snap.val())), onError);
}

export async function updateSettings(data) {
    const s = {
        siteName: String(data.siteName || "").trim(),
        siteDescription: String(data.siteDescription || "").trim(),
        maintenanceMode: Boolean(data.maintenanceMode),
        maintenanceMessage: String(data.maintenanceMessage || "").trim(),
        defaultStreamId: String(data.defaultStreamId || ""),
        footerText: String(data.footerText || "").trim(),
        emptyMessage: String(data.emptyMessage || "").trim(),
        categories: String(data.categories || "").trim()
    };
    if (!s.siteName || s.siteName.length > 60) throw new Error("Site name is required (max 60 characters).");
    if (s.siteDescription.length > 200 || s.maintenanceMessage.length > 300
        || s.footerText.length > 120 || s.emptyMessage.length > 120 || s.categories.length > 200) {
        throw new Error("Text is too long.");
    }
    await update(ref(requireDb(), "settings"), { ...s, updatedAt: serverTimestamp() });
}
