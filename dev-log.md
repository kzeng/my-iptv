# Development Log

## SQLite Channel Store and Logo Cache Proposal

### Goal

Improve channel list management, startup speed, search/filter behavior, and logo loading performance by replacing the current in-memory-only channel list flow with a persistent metadata store and a file-based logo cache.

### Decision

- Use SQLite to manage channel metadata, favorites, playback history, health status, and cache indexes.
- Store logo images as files on disk instead of SQLite BLOBs.
- Keep SQLite as the metadata and lookup layer; keep the filesystem as the binary asset cache.

### Rationale

The current renderer loads channels from `channels.json`, `channels.m3u`, or a remote playlist into an in-memory array. This is simple, but it does not scale well for large playlists and repeated startup work.

Logo images are especially expensive when loaded directly from remote URLs:

- Many channels can trigger many concurrent image requests.
- Broken or slow logo URLs can repeatedly hurt scrolling and startup behavior.
- Remote image loading provides little control over retry, expiration, size limits, or cleanup.
- Storing logos as SQLite BLOBs would make the database large and harder to maintain.

SQLite is a better fit for structured channel data and queryable state, while the filesystem is a better fit for cached binary image files.

### Suggested Data Model

SQLite tables can include:

- `channels`: channel name, stream URL, logo URL, group title, `tvg-id`, User-Agent, Referer, source ID, enabled state.
- `favorites`: favorite channel references and timestamps.
- `playback_history`: recently played channels, play count, last played time.
- `channel_health`: last success, last error, failure count, time to first frame, health score.
- `playlist_sources`: local or remote playlist sources, last sync time, ETag, Last-Modified.
- `logo_cache`: logo URL, local file path, content type, size, fetch status, failure count, fetched time, last used time.

Logo files should be stored under an app data cache directory, for example:

```text
userData/cache/logos/<sha256-logo-url>.<ext>
```

### Logo Cache Behavior

Recommended behavior:

- Render a lightweight placeholder first.
- Lazy-load logos only for visible channel rows.
- Route logo requests through a local endpoint or IPC API.
- Check `logo_cache` before downloading.
- On cache hit, return the local file.
- On cache miss, download the logo, validate type/size, save it to disk, and update SQLite.
- On failure, record a negative cache entry to avoid repeated retries.
- Track `last_used_at` for cleanup.
- Periodically prune old or oversized cache entries.

### Implementation Steps

1. Add a main-process SQLite layer for channel metadata and settings-adjacent state.
2. Extend M3U parsing to preserve `tvg-id`, logo URL, group title, User-Agent, Referer, and source identity.
3. Import or upsert parsed channels into SQLite during playlist sync.
4. Replace renderer-side full-list loading with IPC queries for channels, groups, favorites, and search results.
5. Add a file-based logo cache with local lookup, download, failure caching, and cleanup.
6. Update the UI to lazy-load logos and avoid direct bulk remote image loading.

### Notes

- Do not store logo images directly in SQLite BLOB columns.
- Keep all SQLite access in the Electron main process; expose only focused IPC methods to the renderer.
- If using a native SQLite package such as `better-sqlite3`, validate Electron packaging early because native modules can affect build and release workflows.
