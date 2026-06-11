# My IPTV

Electron IPTV player with HLS streaming proxy, favorites, group filtering, and tunable performance settings panel.

---

## Features

### Channel Management
- **M3U Loading** — tries `channels.json` (pre-compiled JSON, instant), `channels.m3u` (raw), then remote iptv-org source
- **M3U Pre-compilation** — `scripts/parse-m3u.js` parses ~10018 channels from M3U to JSON, cutting cold start from seconds to milliseconds
- **Search** — real-time channel name filtering
- **Group Filter** — extracts groups from M3U `group-title` (supports `;`-delimited multi-group), dropdown selection
- **Favorites** — "☆ Favorites" toggle shows only favorited channels, persisted to disk via IPC

### Playback Engine
- **HLS.js Player** — HLS stream (`.m3u8`) support with adaptive bitrate switching
- **Built-in HTTP Proxy** — Node.js proxy server (port 12999):
  - Rewrites relative URLs in M3U8 playlists to absolute
  - Proxies TS/m4s/aac segments, bypassing CORS restrictions
  - Follows 3xx redirects (up to 5 hops)
  - Supports per-channel custom User-Agent / Referer
- **Auto-play** — plays first channel on launch, or restores the last played channel
- **Channel Info** — now-playing bar shows group, stream URL, and User-Agent

### Tools
- **Screenshot** — 📷 button captures the current video frame as PNG
- **Recording** — ⏺ button records WebM video (with audio), click again to stop and save
- **Settings Panel** — ⚙ button opens a tuning panel for HLS.js parameters (buffer, Worker, ABR level, etc.)
- **Error Popup** — red error bar with × close button and Retry

### Build
- **Cross-platform packaging** — `npm run build` auto-detects the platform:
  - macOS → `.app` bundle + ZIP
  - Windows → `.exe` + DLLs + ZIP
  - Linux → ELF binary + tar.gz
- `.gitignore` excludes `release/`, `channels.json`, `node_modules/`

---

## Development Log

### Issues & Resolutions

| Issue | Cause | Fix |
|-------|-------|-----|
| HLS playback black screen | Relative TS paths in M3U8 | Proxy rewrites relative URLs to absolute |
| CORS errors on video CDN | CDN missing CORS headers | `onHeadersReceived` injects CORS headers; `onBeforeRequest` redirects media through local proxy |
| Build script fails `cp: no such file or directory` | `rm -rf release` deletes target dir | Added `mkdir -p release` |
| electron-builder / electron-packager download failure | DNS blocks `release-assets.githubusercontent.com` | Switched to manual packaging: copy `Electron.app` + resources directly |
| "play() interrupted" error on channel switch | `video.play()` Promise rejects after new channel loads | Added `ch.url !== currentChannel?.url` guard in `.catch()` to ignore stale errors |
| Error popup cannot be dismissed | No close mechanism | Added × close button + click-to-dismiss |
| Playback stuttering (buffer starvation) | `maxBufferLength: 30` too small, Worker disabled | Increased buffer to 90s, enabled Web Worker, added HTTP keep-alive, tuned ABR |
| `levelParsingError` | `startLevel: 3` on streams with <4 bitrate variants | Changed to `startLevel: -1` (HLS.js auto-select) |
| Git repo bloat (112MB) | `release/` directory committed | Re-initialized repo with `.gitignore`, reduced to 924KB |
| Empty channel list on launch | `channels.json` not generated | `build:m3u` script auto-creates it during build |
| Last channel not remembered | No persistence logic | Save/restore `last-channel.json` via IPC |
| Packaged app crashes on launch (icudtl.dat) | `fs.cpSync` resolves Framework relative symlinks to absolute paths | Custom `cp()` with `fs.lstatSync` preserves relative symlinks |

### Completed Optimizations

- **HLS.js Buffer** — `maxBufferLength: 30→90`, `maxMaxBufferLength: 300`, `maxBufferSize: 200MB`, `backBufferLength: 30`
- **Web Worker** — enabled, offloads TS parsing to background thread
- **HTTP keep-alive** — proxy uses `Agent({ keepAlive: true, maxSockets: 32 })` to reuse TCP connections
- **ABR Tuning** — `startLevel: -1` auto-select, `capLevelToPlayerSize`, `startFragPrefetch` preloads next segment
- **Fragment Loading** — `fragLoadingMaxRetry: 6`, `fragLoadingTimeOut: 20s`
- **M3U Pre-compilation** — ~10018 channels from M3U to JSON, launch time from seconds to milliseconds
- **Error Handling** — dismissable popup with Retry, automatic stale error filtering
- **Configurable Settings** — all HLS.js optimization parameters adjustable via UI panel at runtime
- **Proxy Bypass** — TS/m4s/aac segments go direct to CDN; only M3U8 goes through proxy for URL rewriting
- **Cross-platform Build Script** — auto-detects platform, packages as native format (macOS .app, Windows .exe, Linux ELF), preserves Framework symlinks

### Future Optimizations


- [ ] Multi-select group filter
- [ ] EPG integration
- [ ] Keyboard shortcuts (arrow keys for channels, space for pause, etc.)
- [ ] Dark/light theme toggle
- [ ] Per-group custom User-Agent
- [ ] Periodic auto-refresh of channel list
- [ ] Playback history
- [ ] Custom playlist URL import
