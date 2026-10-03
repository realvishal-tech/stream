// VishvaX Stream admin panel. Every success message appears only after Firebase confirms the write.
import { isAuthenticated, login, logout } from "./admin-login.js";
import {
    subscribeToStreams, subscribeToSettings, addStream, updateStream, deleteStream,
    updateStreamStatus, setFeaturedStream, updateSettings
} from "./database.js";
import { detectSourceType, isValidStreamUrl } from "./source-detector.js";
import { isFirebaseConfigured } from "./firebase-init.js";
import { $, fmtDate, setNotice } from "./utils.js";

const WRITE_FAILED = "Unable to publish stream. Please check Firebase connection and database permissions.";
const form = $("stream-form");
const f = {
    title: $("f-title"), url: $("f-url"), category: $("f-category"), type: $("f-type"), thumb: $("f-thumb"),
    desc: $("f-desc"), status: $("f-status"), order: $("f-order"), featured: $("f-featured")
};

let streams = [];
let editingId = null;
let pendingDelete = null;
let noticeTimer = null;
let unsubStreams = null;
let unsubSettings = null;

const notice = (msg, kind = "success") => {
    setNotice($("notice"), msg, kind);
    clearTimeout(noticeTimer);
    if (msg && kind === "success") noticeTimer = setTimeout(() => setNotice($("notice"), ""), 4000);
};

// ---- session / auth gate ----------------------------------------------------

function updateAuthUI() {
    const authed = isAuthenticated();
    $("login-container").hidden = authed;
    $("dashboard").hidden = !authed;
    $("logout").hidden = !authed;

    if (authed) {
        if (!unsubStreams && isFirebaseConfigured) {
            unsubStreams = subscribeToStreams(onStreams, () => notice("Unable to load streams. Check databaseURL and database rules.", "error"));
            unsubSettings = subscribeToSettings(fillSettings);
        }
    } else {
        if (unsubStreams) { unsubStreams(); unsubStreams = null; }
        if (unsubSettings) { unsubSettings(); unsubSettings = null; }
    }
}

$("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    setNotice($("login-error"), "");
    const btn = $("login-btn");
    btn.disabled = true;
    try {
        await login($("login-id").value, $("login-pass").value);
        $("login-pass").value = "";
        updateAuthUI();
    } catch (err) {
        setNotice($("login-error"), err && err.message ? err.message : "Invalid credentials");
    } finally {
        btn.disabled = false;
    }
});

$("logout").addEventListener("click", () => {
    logout();
    updateAuthUI();
});

if (!isFirebaseConfigured) {
    notice("Firebase is not configured. Edit js/firebase-config.js.", "error");
}

updateAuthUI();

// ---- list ---------------------------------------------------------------------

function onStreams(list) {
    streams = list;
    $("stat-total").textContent = list.length;
    $("stat-live").textContent = list.filter((s) => s.status === "live").length;
    $("stat-off").textContent = list.filter((s) => s.status !== "live").length;
    $("admin-empty").hidden = list.length > 0;
    $("admin-list").replaceChildren(...list.map(renderRow));
    if (!editingId) f.order.value = String(list.length + 1);

    const sel = $("s-default");
    const current = sel.value;
    sel.replaceChildren(new Option("Automatic", ""), ...list.map((s) => new Option(s.title, s.id)));
    sel.value = list.some((s) => s.id === current) ? current : "";
}

function actionBtn(label, onClick, cls = "btn btn-ghost small") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
}

function badge(text, cls) {
    const b = document.createElement("span");
    b.className = `badge ${cls}`;
    b.textContent = text;
    return b;
}

function renderRow(s) {
    const li = document.createElement("li");
    li.className = "admin-row";
    const head = document.createElement("div");
    head.className = "row-head";
    const title = document.createElement("strong");
    title.textContent = s.title;
    const badges = document.createElement("span");
    badges.className = "row-badges";
    badges.append(badge((s.status || "offline").toUpperCase(), s.status === "live" ? "badge-live" : "badge-off"));
    if (s.featured) badges.append(badge("FEATURED", "badge-feat"));
    head.append(title, badges);

    const meta = document.createElement("p");
    meta.className = "muted row-meta";
    const type = s.type && s.type !== "auto" ? s.type : `${detectSourceType(s.url)} (auto)`;
    meta.textContent = `Type: ${type} • ${s.category || "Other"} • Order ${s.sortOrder ?? 0}`;
    const dates = document.createElement("p");
    dates.className = "muted row-meta";
    dates.textContent = `Created ${fmtDate(s.createdAt)} • Updated ${fmtDate(s.updatedAt)}`;

    const live = s.status === "live";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
        actionBtn("EDIT", () => startEdit(s)),
        actionBtn(live ? "DISABLE" : "ENABLE", () => write(() => updateStreamStatus(s.id, live ? "offline" : "live"), live ? "Stream set to offline." : "Stream is live.")),
        actionBtn(s.featured ? "UNFEATURE" : "FEATURE", () => write(() => setFeaturedStream(s.featured ? null : s.id), s.featured ? "Feature removed." : "Stream featured.")),
        actionBtn("DELETE", () => askDelete(s), "btn btn-danger small")
    );
    li.append(head, meta, dates, actions);
    return li;
}

/** Runs a write; reports success only after Firebase resolves. */
async function write(fn, successMessage) {
    notice("");
    try {
        await fn();
        notice(successMessage);
        return true;
    } catch (err) {
        console.error("Firebase write error:", err);
        const msg = err && err.message ? err.message : String(err);
        if (/^(Title|Streaming|Category|Thumbnail|Description|Status|Invalid|Featured|Sort|Site|Text)/.test(msg)) {
            notice(msg, "error");
        } else if (msg.includes("PERMISSION_DENIED") || msg.includes("permission_denied")) {
            notice("Firebase permission denied. Realtime Database rules in your Firebase console need to be published.", "error");
        } else {
            notice(`${WRITE_FAILED} (${msg})`, "error");
        }
        return false;
    }
}

// ---- stream form --------------------------------------------------------------

function resetForm() {
    editingId = null;
    form.reset();
    f.order.value = String(streams.length + 1);
    $("form-title").textContent = "Add Stream";
    $("save-btn").textContent = "PUBLISH STREAM";
    $("cancel-edit").hidden = true;
    $("detected").textContent = "";
    setNotice($("form-error"), "");
}

function startEdit(s) {
    editingId = s.id;
    f.title.value = s.title || "";
    f.url.value = s.url || "";
    f.category.value = s.category || "Other";
    f.type.value = s.type || "auto";
    f.thumb.value = s.thumbnail || "";
    f.desc.value = s.description || "";
    f.status.value = s.status === "live" ? "live" : "offline";
    f.order.value = String(s.sortOrder ?? 0);
    f.featured.checked = Boolean(s.featured);
    $("form-title").textContent = "Edit Stream";
    $("save-btn").textContent = "SAVE CHANGES";
    $("cancel-edit").hidden = false;
    updateDetected();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateDetected() {
    const v = f.url.value.trim();
    const type = detectSourceType(v);
    $("detected").textContent = !v ? "" : !isValidStreamUrl(v) ? "Enter a valid http(s) URL."
        : `Detected: ${type}${type === "unknown" ? " — choose a source type if this page is an embeddable player." : ""}`;
}
f.url.addEventListener("input", updateDetected);
$("cancel-edit").addEventListener("click", resetForm);

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setNotice($("form-error"), "");
    const data = {
        title: f.title.value, url: f.url.value, type: f.type.value, category: f.category.value,
        thumbnail: f.thumb.value, description: f.desc.value, status: f.status.value,
        featured: f.featured.checked, sortOrder: Number.parseInt(f.order.value, 10)
    };
    const btn = $("save-btn");
    btn.disabled = true;
    let id = editingId;
    const ok = await write(async () => {
        if (editingId) await updateStream(editingId, data);
        else id = await addStream(data);
        if (data.featured) await setFeaturedStream(id);
    }, editingId ? "Stream updated." : "Stream published.");
    btn.disabled = false;
    if (ok) resetForm();
});

// ---- delete -------------------------------------------------------------------

const dialog = $("confirm");
function askDelete(s) {
    pendingDelete = s;
    $("confirm-text").textContent = `Are you sure you want to delete this stream? (${s.title})`;
    dialog.showModal();
}
$("confirm-cancel").addEventListener("click", () => { pendingDelete = null; dialog.close(); });
$("confirm-ok").addEventListener("click", async () => {
    const s = pendingDelete;
    pendingDelete = null;
    dialog.close();
    if (s && await write(() => deleteStream(s.id), "Stream deleted.") && s.id === editingId) resetForm();
});

// ---- settings -----------------------------------------------------------------

function fillSettings(s) {
    $("categories").replaceChildren(...s.categories.split(",").map((c) => c.trim()).filter(Boolean).map((c) => new Option(c)));
    if (document.activeElement && $("settings-form").contains(document.activeElement)) return; // don't overwrite typing
    $("s-name").value = s.siteName;
    $("s-desc").value = s.siteDescription;
    $("s-maint").checked = s.maintenanceMode;
    $("s-msg").value = s.maintenanceMessage;
    $("s-footer").value = s.footerText;
    $("s-empty").value = s.emptyMessage;
    $("s-cats").value = s.categories;
    $("s-default").value = s.defaultStreamId;
}

$("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await write(() => updateSettings({
        siteName: $("s-name").value, siteDescription: $("s-desc").value, maintenanceMode: $("s-maint").checked,
        maintenanceMessage: $("s-msg").value, defaultStreamId: $("s-default").value,
        footerText: $("s-footer").value, emptyMessage: $("s-empty").value, categories: $("s-cats").value
    }), "Settings saved.");
});

resetForm();
