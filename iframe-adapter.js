// Iframe adapter for legitimately embeddable player pages.
// Cross-origin frames cannot be inspected, so a blocked embed (X-Frame-Options / CSP)
// is inferred when the frame never fires `load`. Nothing is bypassed.

const LOAD_TIMEOUT_MS = 15000;

export class IframeAdapter {
    constructor(mount, ctx) {
        this.mount = mount;
        this.ctx = ctx;
        this.video = null;
        this.qualities = [];
        this.frame = null;
        this.timer = null;
        this.onLoad = null;
    }

    async load(url) {
        const f = document.createElement("iframe");
        f.className = "vx-frame";
        f.title = "Embedded stream player";
        f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        f.allowFullscreen = true;
        f.referrerPolicy = "no-referrer";
        f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-presentation allow-popups");
        this.onLoad = () => { clearTimeout(this.timer); this.ctx.setState("PLAYING"); };
        f.addEventListener("load", this.onLoad);
        this.timer = setTimeout(() => this.ctx.setState("EMBED_BLOCKED"), LOAD_TIMEOUT_MS);
        this.frame = f;
        f.src = url;
        this.mount.appendChild(f);
    }

    destroy() {
        clearTimeout(this.timer);
        if (this.frame) {
            this.frame.removeEventListener("load", this.onLoad);
            this.frame.src = "about:blank";
            this.frame.remove();
        }
        this.frame = null;
        this.onLoad = null;
    }
}
