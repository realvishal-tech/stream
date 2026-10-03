// Small shared DOM/format helpers.
export const $ = (id) => document.getElementById(id);

export function fmtDate(ts) {
    return typeof ts === "number" ? new Date(ts).toLocaleString() : "—";
}

/** Shows (or clears) a message in an element. kind: "error" | "success". */
export function setNotice(el, message, kind = "error") {
    el.textContent = message || "";
    el.hidden = !message;
    el.classList.toggle("form-error", kind === "error");
    el.classList.toggle("form-ok", kind === "success");
}
