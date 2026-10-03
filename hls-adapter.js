// HLS adapter: native HLS where available (Safari), otherwise HLS.js.
import { NativeVideoAdapter, loadScript } from "./native-video-adapter.js";

const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js";
const MAX_NET_RECOVERY = 3;
const MAX_MEDIA_RECOVERY = 2;

export class HLSAdapter extends NativeVideoAdapter {
    constructor(mount, ctx) {
        super(mount, ctx);
        this.hls = null;
        this.netRetries = 0;
        this.mediaRetries = 0;
    }

    async load(url) {
        const v = this.createVideo();
        if (v.canPlayType("application/vnd.apple.mpegurl")) {
            v.src = url;
            v.play().catch(() => {});
            return;
        }
        await loadScript(HLS_JS);
        if (!this.video) return; // destroyed while the library was loading
        const Hls = window.Hls;
        if (!Hls || !Hls.isSupported()) {
            this.ctx.fail("HLS playback is not supported in this browser.", false);
            return;
        }
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 60,
            maxBufferLength: 20,
            maxMaxBufferLength: 30,
            maxBufferSize: 30 * 1000 * 1000,
            maxBufferHole: 0.3,
            highBufferWatchdogPeriod: 2,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 5,
            progressive: true,
            testBandwidth: false
        });
        this.hls = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            this.qualities = hls.levels.map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)}k` }));
            this.ctx.refresh();
            v.play().catch(() => {});
        });
        hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
            if (this.isLive !== data.details.live) { this.isLive = data.details.live; this.ctx.refresh(); }
        });
        hls.on(Hls.Events.FRAG_LOADED, () => { this.netRetries = 0; });
        hls.on(Hls.Events.ERROR, (_e, data) => this.onHlsError(Hls, data));
        hls.loadSource(url);
        hls.attachMedia(v);
    }

    onHlsError(Hls, data) {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // Manifest failures usually mean offline / blocked (CORS): hand over to player-level retry.
            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || this.netRetries >= MAX_NET_RECOVERY) {
                this.ctx.fail("Unable to reach the stream.", true);
            } else {
                this.netRetries += 1;
                this.hls.startLoad();
            }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.mediaRetries < MAX_MEDIA_RECOVERY) {
            this.mediaRetries += 1;
            this.hls.recoverMediaError();
        } else {
            this.ctx.fail("This stream cannot be played.", false);
        }
    }

    setQuality(index) { if (this.hls) this.hls.currentLevel = index; } // -1 = auto

    destroy() {
        if (this.hls) { this.hls.destroy(); this.hls = null; }
        super.destroy();
    }
}
