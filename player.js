// VishvaXPlayer: one active player, source detection, adapters, state machine, controlled retry.
import { detectSourceType } from "./source-detector.js";
import { NativeVideoAdapter } from "./native-video-adapter.js";
import { HLSAdapter } from "./hls-adapter.js";
import { DashAdapter } from "./dash-adapter.js";
import { YouTubeAdapter } from "./youtube-adapter.js";
import { IframeAdapter } from "./iframe-adapter.js";

export const STATES = Object.freeze({
    IDLE: "IDLE", LOADING: "LOADING", PLAYING: "PLAYING", PAUSED: "PAUSED", BUFFERING: "BUFFERING",
    LIVE: "LIVE", OFFLINE: "OFFLINE", ERROR: "ERROR", UNSUPPORTED: "UNSUPPORTED", EMBED_BLOCKED: "EMBED_BLOCKED"
});

const MESSAGES = {
    IDLE: "Select a stream to start watching.",
    LOADING: "CONNECTING TO STREAM...",
    BUFFERING: "BUFFERING...",
    OFFLINE: "STREAM OFFLINE",
    ERROR: "Unable to play this stream.",
    UNSUPPORTED: "THIS SOURCE IS NOT SUPPORTED FOR PLAYBACK",
    EMBED_BLOCKED: "THIS SOURCE CANNOT BE EMBEDDED"
};
const OVERLAY_STATES = new Set(["IDLE", "LOADING", "BUFFERING", "OFFLINE", "ERROR", "UNSUPPORTED", "EMBED_BLOCKED"]);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1500;

/** Shown for unknown webpages: we never guess that they are embeddable. */
class UnsupportedAdapter {
    constructor(mount, ctx) { this.ctx = ctx; this.video = null; this.qualities = []; }
    async load() { this.ctx.setState("UNSUPPORTED"); }
    destroy() { /* nothing to release */ }
}

const ADAPTERS = {
    youtube: YouTubeAdapter, hls: HLSAdapter, dash: DashAdapter,
    mp4: NativeVideoAdapter, webm: NativeVideoAdapter, ogg: NativeVideoAdapter,
    iframe: IframeAdapter, unknown: UnsupportedAdapter
};

const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
};

export class VishvaXPlayer {
    /** @param {HTMLElement} root @param {{onState?:Function}} opts */
    constructor(root, opts = {}) {
        this.onStateChange = opts.onState || (() => {});
        this.adapter = null;
        this.generation = 0;
        this.attempts = 0;
        this.retryTimer = null;
        this.url = "";
        this.hint = "auto";
        this.state = STATES.IDLE;
        this.sourceUrl = "";

        this.stage = el("div", "vx-stage");
        this.media = el("div", "vx-media");
        this.overlay = el("div", "vx-overlay");
        this.overlay.setAttribute("role", "status");
        this.overlay.setAttribute("aria-live", "polite");
        this.spinner = el("span", "vx-spinner");
        this.spinner.setAttribute("aria-hidden", "true");
        this.message = el("p", "vx-message");
        this.actions = el("div", "vx-actions");
        this.overlay.append(this.spinner, this.message, this.actions);
        this.controls = el("div", "vx-controls");
        this.controls.hidden = true;
        this.stage.append(this.media, this.overlay, this.controls);
        root.replaceChildren(this.stage);

        this.onOnline = () => this.#handleOnline();
        this.onOffline = () => { if (this.url) this.setState(STATES.ERROR, "You are offline."); };
        this.onFullscreenChange = () => this.#syncFullscreen();
        window.addEventListener("online", this.onOnline);
        window.addEventListener("offline", this.onOffline);
        document.addEventListener("fullscreenchange", this.onFullscreenChange);
        document.addEventListener("webkitfullscreenchange", this.onFullscreenChange);

        this.controlsTimer = null;
        this.wakeControls = () => {
            this.stage.classList.remove("hide-controls");
            clearTimeout(this.controlsTimer);
            if (this.state === STATES.PLAYING || this.state === STATES.LIVE) {
                this.controlsTimer = setTimeout(() => {
                    this.stage.classList.add("hide-controls");
                }, 3500);
            }
        };
        this.stage.addEventListener("mousemove", this.wakeControls);
        this.stage.addEventListener("touchstart", this.wakeControls, { passive: true });
        this.stage.addEventListener("click", this.wakeControls);

        this.setState(STATES.IDLE);
    }

    /** Loads a source. `hint` overrides detection ("auto" = detect). */
    load(url, hint = "auto") {
        this.url = url;
        this.hint = hint;
        this.attempts = 0;
        this.#start();
    }

    /** Stops playback and shows a state without loading an adapter (e.g. OFFLINE). */
    stop(state = STATES.IDLE, message) {
        this.url = "";
        this.sourceUrl = "";
        this.generation += 1;
        clearTimeout(this.retryTimer);
        clearTimeout(this.controlsTimer);
        this.#teardown();
        this.setState(state, message);
    }

    destroy() {
        this.stop();
        clearTimeout(this.controlsTimer);
        window.removeEventListener("online", this.onOnline);
        window.removeEventListener("offline", this.onOffline);
        document.removeEventListener("fullscreenchange", this.onFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", this.onFullscreenChange);
    }

    setState(state, message) {
        this.state = state;
        const show = OVERLAY_STATES.has(state);
        this.overlay.hidden = !show;
        this.overlay.dataset.state = state.toLowerCase();
        this.stage.dataset.state = state.toLowerCase();
        this.spinner.hidden = !(state === "LOADING" || state === "BUFFERING");
        this.message.textContent = message || MESSAGES[state] || "";
        this.actions.replaceChildren();
        if (state === "ERROR") this.actions.append(this.#button("RETRY", () => this.load(this.url, this.hint)));
        if (state === "UNSUPPORTED" || state === "EMBED_BLOCKED") {
            if (this.sourceUrl) this.actions.append(this.#openLink());
        }
        this.#updateLive();

        if (state === STATES.PLAYING || state === STATES.LIVE) {
            this.wakeControls();
        } else {
            this.stage.classList.remove("hide-controls");
            clearTimeout(this.controlsTimer);
        }

        this.onStateChange(state, { type: this.sourceType, url: this.sourceUrl });
    }

    // ---- lifecycle -------------------------------------------------------

    async #start() {
        clearTimeout(this.retryTimer);
        this.#teardown();
        const gen = ++this.generation;
        const type = this.hint !== "auto" && ADAPTERS[this.hint] ? this.hint : detectSourceType(this.url);
        this.sourceType = type;
        this.sourceUrl = this.url;
        this.setState(STATES.LOADING);
        if (!navigator.onLine) { this.setState(STATES.ERROR, "You are offline."); return; }

        // Callbacks from stale adapters are ignored via the generation token.
        const ctx = {
            setState: (s, m) => { if (gen === this.generation) this.setState(s, m); },
            fail: (m, recoverable) => { if (gen === this.generation) this.#fail(m, recoverable); },
            refresh: () => { if (gen === this.generation) this.#buildControls(); }
        };
        const adapter = new ADAPTERS[type](this.media, ctx);
        this.adapter = adapter;
        try {
            await adapter.load(this.url);
        } catch (err) {
            ctx.fail(err && err.message ? err.message : "Unable to load stream.", true);
            return;
        }
        if (gen === this.generation) this.#buildControls();
    }

    #teardown() {
        if (this.adapter) { this.adapter.destroy(); this.adapter = null; }
        this.media.replaceChildren();
        this.controls.replaceChildren();
        this.controls.hidden = true;
        this.exitFullscreenIfActive();
    }

    #fail(message, recoverable) {
        if (recoverable && navigator.onLine && this.attempts < MAX_ATTEMPTS) {
            this.attempts += 1;
            this.setState(STATES.LOADING, `Reconnecting (attempt ${this.attempts} of ${MAX_ATTEMPTS})...`);
            this.retryTimer = setTimeout(() => this.#start(), RETRY_BASE_MS * this.attempts);
            return;
        }
        this.#teardown();
        this.setState(STATES.ERROR, message || MESSAGES.ERROR);
    }

    #handleOnline() {
        if (this.url && this.state === STATES.ERROR) this.load(this.url, this.hint);
    }

    // ---- controls --------------------------------------------------------

    #button(label, onClick, cls = "vx-btn") {
        const b = el("button", cls, label);
        b.type = "button";
        b.addEventListener("click", onClick);
        return b;
    }

    #openLink() {
        const a = el("a", "vx-btn", "OPEN SOURCE");
        a.href = this.sourceUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        return a;
    }

    #iconButton(label, glyph, onClick) {
        const b = this.#button(glyph, onClick, "vx-ctl");
        b.setAttribute("aria-label", label);
        b.title = label;
        return b;
    }

    #buildControls() {
        const adapter = this.adapter;
        const v = adapter && adapter.video;
        this.controls.replaceChildren();
        this.controls.classList.toggle("is-frame", !v);
        if (!v) {
            const framed = Boolean(adapter && adapter.frame) && this.#canFullscreen();
            this.controls.hidden = !framed;
            if (framed) this.#frameControls();
            return;
        }
        this.controls.hidden = false;
        const live = adapter.live ? adapter.live() : false;

        const play = this.#iconButton("Play", "▶", () => (v.paused ? v.play().catch(() => {}) : v.pause()));
        const sync = () => {
            play.textContent = v.paused ? "▶" : "❚❚";
            play.setAttribute("aria-label", v.paused ? "Play" : "Pause");
        };
        v.addEventListener("play", sync);
        v.addEventListener("pause", sync);
        sync();

        const mute = this.#iconButton("Mute", "🔊", () => { v.muted = !v.muted; });
        const volume = el("input", "vx-volume");
        volume.type = "range"; volume.min = "0"; volume.max = "1"; volume.step = "0.05"; volume.value = String(v.volume);
        volume.setAttribute("aria-label", "Volume");
        volume.addEventListener("input", () => { v.volume = Number(volume.value); v.muted = v.volume === 0; });
        v.addEventListener("volumechange", () => {
            mute.textContent = v.muted || v.volume === 0 ? "🔇" : "🔊";
            volume.value = v.muted ? "0" : String(v.volume);
        });

        const badge = el("span", "vx-live-badge", "● LIVE");
        badge.hidden = !live;
        const spacer = el("span", "vx-spacer");
        this.controls.append(play, mute, volume, badge, spacer);

        if (!live) {
            const speed = el("select", "vx-select");
            speed.setAttribute("aria-label", "Playback speed");
            [0.5, 1, 1.25, 1.5, 2].forEach((r) => {
                const o = el("option", "", `${r}x`);
                o.value = String(r);
                o.selected = r === 1;
                speed.append(o);
            });
            speed.addEventListener("change", () => { v.playbackRate = Number(speed.value); });
            this.controls.append(speed);
        }
        if (adapter.qualities.length > 1) {
            const q = el("select", "vx-select");
            q.setAttribute("aria-label", "Quality");
            const auto = el("option", "", "Auto");
            auto.value = "-1";
            q.append(auto);
            adapter.qualities.forEach((l) => { const o = el("option", "", l.label); o.value = String(l.index); q.append(o); });
            q.addEventListener("change", () => adapter.setQuality(Number(q.value)));
            this.controls.append(q);
        }
        if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
            this.controls.append(this.#iconButton("Picture in picture", "⧉", () => {
                (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => {});
            }));
        }
        this.#addFullscreen();
        this.#updateLive();
    }

    // Embedded frames provide their own controls; we only add fullscreen for the stage.
    #frameControls() { this.controls.append(el("span", "vx-spacer")); this.#addFullscreen(); }

    #addFullscreen() {
        const v = this.adapter && this.adapter.video;
        if (!this.#canFullscreen() && !(v && v.webkitEnterFullscreen)) return;
        this.fsButton = this.#iconButton("Fullscreen", "⛶", () => this.toggleFullscreen());
        this.controls.append(this.fsButton);
    }

    #canFullscreen() { return Boolean(this.stage.requestFullscreen || this.stage.webkitRequestFullscreen); }

    #fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }

    toggleFullscreen() {
        const v = this.adapter && this.adapter.video;
        if (this.#fsElement()) { this.exitFullscreenIfActive(); return; }
        const req = this.stage.requestFullscreen || this.stage.webkitRequestFullscreen;
        if (req) {
            Promise.resolve(req.call(this.stage)).catch(() => {
                if (v && v.webkitEnterFullscreen) v.webkitEnterFullscreen();
            });
        } else if (v && v.webkitEnterFullscreen) {
            v.webkitEnterFullscreen(); // iOS Safari: native video fullscreen only
        }
    }

    exitFullscreenIfActive() {
        if (this.#fsElement() !== this.stage) return;
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    }

    #syncFullscreen() {
        const active = this.#fsElement() === this.stage;
        this.stage.classList.toggle("is-fullscreen", active);
        if (this.fsButton) this.fsButton.setAttribute("aria-label", active ? "Exit fullscreen" : "Fullscreen");
    }

    #updateLive() {
        const badge = this.controls.querySelector(".vx-live-badge");
        if (badge) badge.hidden = !(this.adapter && this.adapter.live && this.adapter.live());
    }
}
