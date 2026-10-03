// VishvaX Stream — public homepage controller (no authentication, one realtime listener on /streams).
import { subscribeToStreams, subscribeToSettings, DEFAULT_SETTINGS } from "./database.js";
import { VishvaXPlayer } from "./player.js";
import { isFirebaseConfigured } from "./firebase-init.js";
import { $ } from "./utils.js";

const LOAD_TIMEOUT_MS = 10000;

const ui = {
    list: $("stream-list"), status: $("list-status"), title: $("now-title"), meta: $("now-meta"),
    badge: $("now-badge"), empty: $("empty-state"), error: $("connect-error"),
    retry: $("retry-connect"), loading: $("loading"), main: $("watch"), live: $("live-count"),
    maint: $("maintenance"), maintMsg: $("maintenance-message"), brand: $("brand-name"), footer: $("footer-text")
};

const player = new VishvaXPlayer($("player"));

let streams = [];
let settings = { ...DEFAULT_SETTINGS };
let activeId = null;
let activeSig = "";
let unsubStreams = null;
let unsubSettings = null;
let timeoutId = null;
let gotData = false;

const isLive = (s) => s.status === "live";
const signature = (s) => `${s.url}|${s.type}|${s.status}`;

function pickDefault(list) {
    const live = list.filter(isLive);
    return live.find((s) => s.featured)
        || live.find((s) => s.id === settings.defaultStreamId)
        || live[0] || null;
}

function makeCard(s) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    btn.dataset.id = s.id;
    btn.setAttribute("aria-label", `Watch ${s.title}`);
    const active = s.id === activeId;
    if (active) { btn.classList.add("is-active"); btn.setAttribute("aria-current", "true"); }

    const thumb = document.createElement("div");
    thumb.className = "card-thumb";
    if (s.thumbnail && /^https?:\/\//i.test(s.thumbnail)) {
        const img = document.createElement("img");
        img.src = s.thumbnail;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => {
            img.remove();
            thumb.classList.add("no-thumb");
        });
        thumb.append(img);
    } else {
        thumb.classList.add("no-thumb");
    }
    const badge = document.createElement("span");
    badge.className = `badge ${isLive(s) ? "badge-live" : "badge-off"}`;
    badge.textContent = isLive(s) ? "LIVE" : "OFFLINE";
    thumb.append(badge);

    const body = document.createElement("div");
    body.className = "card-body";
    const t = document.createElement("h3");
    t.className = "card-title";
    t.textContent = s.title;
    
    const metaRow = document.createElement("div");
    metaRow.className = "card-meta-row";
    const c = document.createElement("span");
    c.className = "card-cat";
    c.textContent = s.category || "Other";
    metaRow.append(c);
    
    if (active) {
        const activeTag = document.createElement("span");
        activeTag.className = "card-now-playing";
        activeTag.textContent = "PLAYING";
        metaRow.append(activeTag);
    }
    body.append(t, metaRow);

    btn.append(thumb, body);
    btn.addEventListener("click", () => {
        select(s.id, true);
        ui.main.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return btn;
}

function renderList() {
    ui.list.replaceChildren(...streams.map(makeCard));
    ui.status.textContent = streams.length ? `${streams.length} stream${streams.length === 1 ? "" : "s"}` : "";
    const liveCount = streams.filter(isLive).length;
    ui.live.textContent = liveCount ? `${liveCount} LIVE` : "LIVE";
}

function renderNowPlaying(s) {
    ui.title.textContent = s ? s.title : "No stream selected";
    ui.meta.textContent = s ? [s.category, s.description].filter(Boolean).join(" • ") : "";
    ui.badge.hidden = !s;
    if (s) {
        ui.badge.textContent = isLive(s) ? "● LIVE" : "OFFLINE";
        ui.badge.className = `badge ${isLive(s) ? "badge-live" : "badge-off"}`;
    }
}

function select(id, force) {
    const s = streams.find((x) => x.id === id);
    if (!s) return;
    const sig = signature(s);
    activeId = id;
    renderNowPlaying(s);
    // Reload only when the source really changed, so unrelated edits don't restart playback.
    if (force || sig !== activeSig) {
        activeSig = sig;
        if (isLive(s)) player.load(s.url, s.type || "auto");
        else player.stop("OFFLINE");
    }
    ui.list.querySelectorAll(".card").forEach((c) => {
        const on = c.dataset.id === id;
        c.classList.toggle("is-active", on);
        if (on) c.setAttribute("aria-current", "true"); else c.removeAttribute("aria-current");
    });
}

function clearActive() {
    activeId = null;
    activeSig = "";
    player.stop("IDLE");
    renderNowPlaying(null);
}

/** Re-renders everything from the latest streams + settings. */
function refresh() {
    ui.brand.replaceChildren(...(settings.siteName === DEFAULT_SETTINGS.siteName
        ? [document.createTextNode("VishvaX "), Object.assign(document.createElement("b"), { textContent: "Stream" })]
        : [document.createTextNode(settings.siteName)]));
    // Everything below is driven by Firebase settings.
    document.title = `${settings.siteName} — Live Streaming`;
    document.querySelector('meta[name="description"]').content = settings.siteDescription;
    ui.footer.textContent = settings.footerText;
    ui.empty.textContent = settings.emptyMessage;
    if (!gotData) return;
    ui.loading.hidden = true;
    ui.error.hidden = true;

    if (settings.maintenanceMode) {
        ui.maintMsg.textContent = settings.maintenanceMessage;
        ui.maint.hidden = false;
        ui.main.hidden = true;
        clearActive();
        return;
    }
    ui.maint.hidden = true;
    ui.main.hidden = false;
    renderList();
    ui.empty.hidden = streams.some(isLive);

    if (activeId && streams.some((s) => s.id === activeId)) {
        select(activeId, false);
    } else {
        const next = pickDefault(streams);
        if (next) select(next.id, true); else clearActive();
    }
}

function onStreams(list) {
    gotData = true;
    clearTimeout(timeoutId);
    streams = list.filter((s) => s.title && s.url);
    refresh();
}

function onError() {
    clearTimeout(timeoutId);
    ui.loading.hidden = true;
    if (!gotData) { ui.main.hidden = true; ui.maint.hidden = true; ui.error.hidden = false; }
}

function connect() {
    if (unsubStreams) unsubStreams();
    if (unsubSettings) unsubSettings();
    gotData = false;
    ui.error.hidden = true;
    ui.loading.hidden = false;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => { if (!gotData) onError(); }, LOAD_TIMEOUT_MS);
    if (!isFirebaseConfigured) { onError(); return; }
    unsubSettings = subscribeToSettings((s) => { settings = s; refresh(); });
    unsubStreams = subscribeToStreams(onStreams, onError);
}

ui.retry.addEventListener("click", connect);
window.addEventListener("online", () => { if (!gotData) connect(); });
window.addEventListener("pagehide", () => {
    if (unsubStreams) unsubStreams();
    if (unsubSettings) unsubSettings();
    player.destroy();
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js").catch(() => {}));
}

connect();
