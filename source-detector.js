// Universal source detection. Conservative: only classifies what it can
// justify from the URL. Unknown webpages are NOT assumed to be embeddable.

/** Returns a URL object for http(s) URLs, otherwise null. */
export function parseHttpUrl(value) {
    try {
        const u = new URL(String(value).trim());
        return u.protocol === "http:" || u.protocol === "https:" ? u : null;
    } catch {
        return null;
    }
}

export const isValidStreamUrl = (value) => parseHttpUrl(value) !== null;

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"]);
const YT_ID = /^[\w-]{11}$/;

export function parseYouTubeId(value) {
    const u = parseHttpUrl(value);
    if (!u || !YT_HOSTS.has(u.hostname)) return null;
    let id = null;
    if (u.hostname === "youtu.be") {
        id = u.pathname.slice(1).split("/")[0];
    } else if (u.pathname === "/watch") {
        id = u.searchParams.get("v");
    } else {
        const m = u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]+)/);
        id = m ? m[1] : null;
    }
    return id && YT_ID.test(id) ? id : null;
}

const EXTENSIONS = { m3u8: "hls", mpd: "dash", mp4: "mp4", m4v: "mp4", webm: "webm", ogg: "ogg", ogv: "ogg" };
// Path hints for pages that are, by convention, embeddable player pages.
const EMBED_PATH = /\/(embed|player)(\/|$)/i;

/** @returns {"youtube"|"hls"|"dash"|"mp4"|"webm"|"ogg"|"iframe"|"unknown"} */
export function detectSourceType(value) {
    const u = parseHttpUrl(value);
    if (!u) return "unknown";
    if (parseYouTubeId(value)) return "youtube";
    const ext = u.pathname.split(".").pop().toLowerCase();
    if (EXTENSIONS[ext]) return EXTENSIONS[ext];
    if (EMBED_PATH.test(u.pathname)) return "iframe";
    return "unknown";
}
