# VishvaX Stream

Lightweight live streaming portal for **https://stream.vishvax.in**.
Admin publishes title + URL → **Firebase Realtime Database** stores it → the public homepage updates in realtime → the right player is chosen automatically.

Static HTML/CSS/vanilla JS. No backend server, no media proxy, no Firestore. Viewers never log in.

## Admin access (Static login)

`/admin.html` is protected by a static login screen.
- Access requires administrator credentials configured via SHA-256 cryptographic hash comparison.
- Plaintext credentials and passwords are never exposed on any page, source comments, metadata, or database.
- Sessions are stored in browser `sessionStorage` (cleared on tab close or when clicking **LOGOUT**).
- The public homepage (`index.html`) has zero knowledge of or dependency on admin credentials.

## Firebase setup

1. Create a Firebase project.
2. **Build → Realtime Database → Create database** (pick a region).
3. Copy the database URL from the Realtime Database page into `databaseURL` in `js/firebase-config.js` (required if you did not pick the default US region).
4. Publish rules: paste `database.rules.json` into the Rules tab, or run `firebase deploy --only database`.

Test locally with a static server (ES modules do not run from `file://`): `npx serve .`

## Database structure

```
streams/{id}: title, url, type, category, thumbnail, description, status (live|offline), featured, sortOrder, createdAt, updatedAt
settings:     siteName, siteDescription, maintenanceMode, maintenanceMessage, defaultStreamId, updatedAt
```
`type` is one of auto, youtube, hls, dash, mp4, webm, ogg, iframe. Timestamps are server timestamps.

## Using the admin panel

Open `/admin.html`: add, edit, enable/disable, feature and delete streams, and edit site settings (including maintenance mode). Success messages appear only after Firebase confirms the write.

| URL | Detected as |
|---|---|
| youtube.com / youtu.be / `/live/` / `/embed/` | YouTube (official embed) |
| `.m3u8` | HLS (native or HLS.js) |
| `.mp4` `.webm` `.ogg` | Native `<video>` |
| `.mpd` | DASH (dash.js; DRM unsupported) |
| path containing `/player` or `/embed` | Embeddable iframe |
| anything else | Unknown, shown as not supported with OPEN SOURCE |

For a page that is a legitimate embeddable player but isn't auto-detected, set the source type to **Embeddable page**. If the remote site forbids framing, the player says so; nothing is bypassed.

## Deployment

- **Firebase Hosting:** `firebase login`, `firebase init hosting` (public dir `.`, keep existing files), `firebase deploy`.
- **Netlify / GitHub Pages / any static host:** publish the folder as-is (no build step).

## Custom domain

```
DNS → Hosting → SSL → stream.vishvax.in
```
Add `stream.vishvax.in` in your host, create the DNS records the host displays at your DNS provider, wait for the automatic HTTPS certificate, then enforce HTTPS.

## Troubleshooting

- Blank page or nothing loads: open through `http://localhost` or your domain, not by double-clicking the HTML file.
- "Unable to connect to VishvaX Stream" / "Check databaseURL and database rules": wrong `databaseURL`, or rules not published.

## Security notes

User data is rendered with `textContent`; URLs must be http(s); the service worker caches only the static shell and never media or cross-origin requests.
