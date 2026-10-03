// YouTube adapter: official embedded player (privacy-enhanced domain). No downloading or proxying.
import { parseYouTubeId } from "./source-detector.js";

export class YouTubeAdapter {
    constructor(mount, ctx) {
        this.mount = mount;
        this.ctx = ctx;
        this.video = null;
        this.qualities = [];
        this.frame = null;
        this.onLoad = null;
    }

    async load(url) {
        const id = parseYouTubeId(url);
        if (!id) { this.ctx.fail("Invalid YouTube link.", false); return; }
        const f = document.createElement("iframe");
        f.className = "vx-frame";
        f.title = "YouTube player";
        f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
        f.allowFullscreen = true;
        f.referrerPolicy = "strict-origin-when-cross-origin";
        f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&playsinline=1&rel=0`;
        this.onLoad = () => this.ctx.setState("PLAYING");
        f.addEventListener("load", this.onLoad);
        this.frame = f;
        this.mount.appendChild(f);
    }

    destroy() {
        if (this.frame) {
            this.frame.removeEventListener("load", this.onLoad);
            this.frame.src = "about:blank";
            this.frame.remove();
        }
        this.frame = null;
        this.onLoad = null;
    }
}
