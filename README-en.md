# My IPTV

A lightweight and fast desktop IPTV player built with Electron and HLS.js. My IPTV includes a streaming proxy, SQLite-backed channel management, logo caching, favorites, playback history, and practical tuning options for real-world IPTV playlists.

## Download

- Latest release: https://github.com/kzeng/my-iptv/releases
- v1.0.0: https://github.com/kzeng/my-iptv/releases/tag/v1.0.0

Download the package for your platform, extract it, and run `My IPTV.exe`.

## Highlights

- **China-friendly playlist first**  
  Ships with `https://live.zbds.top/tv/iptv4.m3u` as the primary built-in source, with `iptv-org` kept as an additional source.

- **SQLite channel database**  
  Channels, playlist sources, favorites, playback history, health status, and cache indexes are managed in SQLite. The app starts from the local database first, so previous channels remain available even when the network is slow or unavailable.

- **Manual channel database refresh**  
  The refresh button downloads playlists, parses M3U files, and updates SQLite. If a network refresh fails, existing cached channels are preserved.

- **Disk-based logo cache**  
  Channel logos are served through a local cache endpoint. Image files stay on disk, while SQLite stores only metadata and indexes, reducing repeated remote image requests and list rendering overhead.

- **Reliable HLS playback**  
  The built-in local HTTP proxy rewrites relative M3U8 paths, handles CORS, redirects, User-Agent, and Referer headers, improving compatibility across many live streams.

- **Practical player tools**  
  Search, group filter, favorites, last-channel restore, screenshots, WebM recording, retryable errors, and HLS tuning settings are built in.

- **Leaner release package**  
  The package includes only runtime files, excluding tests, docs, unused npm packages, and duplicate Electron launchers such as `electron.exe`.

## Who It Is For

## Screenshots

![Screenshot 1](./docs/Screenshot%20from%202026-06-11%2017-56-37.png)

![Screenshot 2](./docs/Screenshot%20from%202026-06-11%2017-55-47.png)

![Screenshot 3](./docs/Screenshot%20from%202026-06-11%2017-55-18.png)

![Screenshot 4](./docs/Screenshot%20from%202026-06-11%2017-59-44.png)

- Users who want a simple desktop IPTV player.
- Users who manage large M3U playlists, favorites, and playback history.
- Users who test IPTV/HLS streams, User-Agent, Referer, and playback compatibility.
- Users who want local caching to reduce logo traffic and startup waiting.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The build script rebuilds native dependencies for Electron, generates channel JSON, and packages the app for the current platform. On Windows, the default output directory is `release/`; `MY_IPTV_RELEASE_DIR` can be used to choose another output directory.

## Tech Stack

- Electron
- HLS.js
- SQLite / better-sqlite3
- Node.js local HTTP proxy

## Development Notes

Implementation details, issue history, and the roadmap are documented in [dev-log.md](./dev-log.md).
