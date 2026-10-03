// DASH adapter using dash.js (loaded on demand). DRM-protected sources are not supported.
import { NativeVideoAdapter, loadScript } from "./native-video-adapter.js";

const DASH_JS = "https://cdn.dashjs.org/v4.7.4/dash.all.min.js";

export class DashAdapter extends NativeVideoAdapter {
    constructor(mount, ctx) {
        super(mount, ctx);
        this.player = null;
    }

    async load(url) {
        const v = this.createVideo();
        await loadScript(DASH_JS);
        if (!this.video) return;
        const dashjs = window.dashjs;
        if (!dashjs) { this.ctx.fail("DASH playback is not available.", false); return; }
        const player = dashjs.MediaPlayer().create();
        this.player = player;
        player.on("streamInitialized", () => {
            const list = player.getBitrateInfoListFor("video") || [];
            this.qualities = list.map((b, i) => ({ index: i, label: b.height ? `${b.height}p` : `${Math.round(b.bitrate / 1000)}k` }));
            this.isLive = player.isDynamic();
            this.ctx.refresh();
        });
        player.on("error", (e) => {
            const protectedSource = e.error && /drm|key|license|protection/i.test(`${e.error.message} ${e.error.code}`);
            this.ctx.fail(protectedSource
                ? "This source is protected and cannot be played here."
                : "Unable to load the DASH stream.", !protectedSource);
        });
        player.initialize(v, url, true);
    }

    setQuality(index) {
        if (!this.player) return;
        if (index < 0) {
            this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
        } else {
            this.player.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
            this.player.setQualityFor("video", index);
        }
    }

    destroy() {
        if (this.player) { this.player.destroy(); this.player = null; }
        super.destroy();
    }
}
