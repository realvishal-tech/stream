// Native <video> adapter (MP4 / WebM / OGG). Base class for HLS and DASH.
// Adapter contract: constructor(mount, ctx); load(url); destroy(); `video`; `qualities`.

const scriptPromises = new Map();

/** Loads a third-party script once. Rejects on failure so callers can show an error. */
export function loadScript(src) {
    if (!scriptPromises.has(src)) {
        scriptPromises.set(src, new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = true;
            s.onload = resolve;
            s.onerror = () => { scriptPromises.delete(src); reject(new Error("Player library failed to load.")); };
            document.head.appendChild(s);
        }));
    }
    return scriptPromises.get(src);
}

export class NativeVideoAdapter {
    constructor(mount, ctx) {
        this.mount = mount;
        this.ctx = ctx;
        this.video = null;
        this.qualities = [];
        this.isLive = false;
        this.handlers = [];
    }

    createVideo() {
        const v = document.createElement("video");
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        v.preload = "auto";
        v.autoplay = true;
        v.className = "vx-video";
        v.setAttribute("aria-label", "Video player");
        this.video = v;
        const on = (ev, fn) => { v.addEventListener(ev, fn); this.handlers.push([ev, fn]); };
        on("loadstart", () => this.ctx.setState("LOADING"));
        on("waiting", () => this.ctx.setState("BUFFERING"));
        on("playing", () => this.ctx.setState(this.live() ? "LIVE" : "PLAYING"));
        on("pause", () => { if (!v.ended) this.ctx.setState("PAUSED"); });
        on("durationchange", () => this.ctx.refresh());
        on("error", () => this.onMediaError());
        this.mount.appendChild(v);
        return v;
    }

    live() { return this.isLive || (this.video && this.video.duration === Infinity); }

    onMediaError() {
        const code = this.video && this.video.error ? this.video.error.code : 0;
        // 4 = source not supported: retrying will not help.
        this.ctx.fail(code === 4 ? "This source cannot be played in your browser." : "Stream interrupted.", code !== 4);
    }

    async load(url) {
        const v = this.createVideo();
        v.src = url;
        v.play().catch(() => { /* autoplay blocked: user presses play */ });
    }

    setQuality() { /* not supported by native sources */ }

    destroy() {
        if (this.video) {
            this.handlers.forEach(([ev, fn]) => this.video.removeEventListener(ev, fn));
            this.video.pause();
            this.video.removeAttribute("src");
            this.video.load();
            this.video.remove();
        }
        this.handlers = [];
        this.video = null;
    }
}
