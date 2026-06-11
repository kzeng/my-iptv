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

### Brainstorming Backlog

#### Innovative Features
- [ ] **Channel health radar** — periodically probe availability, time to first frame, failure rate, and last successful playback; mark channels as stable, slow, or unavailable in the list.
- [ ] **Smart channel deduplication and aliases** — merge duplicate entries by channel name, logo, group, and stream URL fingerprint; provide one canonical entry for common aliases.
- [ ] **EPG + catch-up entry points** — integrate XMLTV/EPG data to show current and next programs; if a source supports timeshift, allow program-guide click-to-replay.
- [ ] **Multi-source priority and failover** — attach several candidate streams to one channel, auto-switch on failure or stutter, and remember the user's best route.
- [ ] **Family / kids mode** — support living-room use with channel group allowlists, hidden adult or unstable channels, and a locked settings panel.
- [ ] **LAN casting / remote-control API** — expose a local HTTP/WebSocket control API so a phone browser can change channels, favorite, pause, and adjust volume.

#### Performance
- [ ] **Virtualized channel list** — render only visible rows for 10k+ channels, reducing DOM nodes and improving search, group switching, and scroll smoothness.
- [ ] **Precomputed channel indexes** — generate lowercase names, group arrays, dedupe keys, and sort keys during `channels.json` build to avoid repeated runtime string work.
- [ ] **Proxy caching and conditional requests** — add short TTL cache plus ETag/Last-Modified support for M3U8, EPG, and playlist sources to reduce repeat network traffic.
- [ ] **Playback quality telemetry** — record local metrics such as buffer events, average download time, error types, and current bitrate to support auto-tuning and channel health.
- [ ] **Tiered channel asset loading** — load names and URLs first, lazy-load logos, and cache failed logo URLs so broken assets do not slow the list.
- [ ] **Lean release packaging** — ship only runtime files, excluding tests, docs, and unused npm package content to reduce release size and startup I/O.

#### User Experience
- [ ] **Command palette / fast channel switcher** — Spotlight-style search that accepts channel name, group, or favorite state and plays on Enter.
- [ ] **Channel details drawer** — show URL, User-Agent, Referer, resolution, bitrate, recent errors, speed-test result, plus copy and diagnostics actions.
- [ ] **First-run setup wizard** — guide users through built-in source selection, local M3U import, remote URL entry, favorites, and playback troubleshooting.
- [ ] **Recoverable error actions** — on playback failure, offer Retry, switch to backup source, copy diagnostics, or mark unavailable instead of showing text only.
- [ ] **Keyboard and remote-friendly focus** — support arrow-key channel switching, Enter to play, Space to pause, F for fullscreen, number-key jumping, with clear focus states.
- [ ] **Enhanced playback state memory** — remember volume, mute, fullscreen, last group/search filter, and recent channels to reduce repeated setup.
