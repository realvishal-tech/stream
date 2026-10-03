// VishvaX Stream service worker: caches the static app shell only.
// Cross-origin requests (Firebase, media, HLS segments, YouTube) are never intercepted or cached.
const CACHE = "vishvax-stream-v1";
const SHELL = [
    "/", "index.html", "css/style.css", "css/player.css", "js/streams.js", "js/player.js", "js/database.js",
    "js/firebase-init.js", "js/firebase-config.js", "js/utils.js", "js/source-detector.js", "js/native-video-adapter.js",
    "js/hls-adapter.js", "js/dash-adapter.js", "js/youtube-adapter.js", "js/iframe-adapter.js",
    "assets/logo.svg", "assets/favicon.svg", "manifest.json"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== self.location.origin) return;
    if (/\.(m3u8|mpd|ts|m4s|mp4|webm|ogg)$/i.test(url.pathname)) return; // never cache media
    if (/admin/.test(url.pathname)) return; // admin always online

    // Network-first so deployments are picked up; cache is the offline fallback.
    event.respondWith(
        fetch(req).then((res) => {
            if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
            return res;
        }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
});
