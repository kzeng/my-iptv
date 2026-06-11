const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const DEFAULT_PLAYLIST_SOURCES = [
  { name: 'ZBDS IPTV', url: 'https://live.zbds.top/tv/iptv4.m3u', priority: 10 },
  { name: 'IPTV Org', url: 'https://iptv-org.github.io/iptv/index.m3u', priority: 20 },
]

function nowIso() {
  return new Date().toISOString()
}

function parseM3U(text) {
  const lines = text.split('\n')
  const result = []
  let cur = null
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('#EXTINF:')) {
      cur = { name: 'Unknown', logo: '', group: '', url: '', userAgent: '', referrer: '' }
      const m = t.match(/,(.+)$/)
      if (m) cur.name = m[1].trim()
      const l = t.match(/tvg-logo="([^"]*)"/)
      if (l) cur.logo = l[1]
      const g = t.match(/group-title="([^"]*)"/)
      if (g) cur.group = g[1]
    } else if (t.startsWith('#EXTVLCOPT:http-user-agent=')) {
      if (cur) cur.userAgent = t.slice(t.indexOf('=') + 1)
    } else if (t.startsWith('#EXTVLCOPT:http-referrer=')) {
      if (cur) cur.referrer = t.slice(t.indexOf('=') + 1)
    } else if (cur && t && !t.startsWith('#')) {
      cur.url = t
      if (cur.url) result.push({ ...cur })
      cur = null
    }
  }
  return result
}

function logoCacheKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex')
}

function logoFilePath(cacheDir, key, ext) {
  return path.join(cacheDir, key.slice(0, 2), `${key}${ext}`)
}

class IptvStore {
  constructor(userDataDir) {
    this.dbPath = path.join(userDataDir, 'my-iptv.db')
    this.logoCacheDir = path.join(userDataDir, 'logo-cache')
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.mkdirSync(this.logoCacheDir, { recursive: true })
    this.db = new Database(this.dbPath)
    this.init()
  }

  init() {
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS playlist_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 100,
        last_fetch_at TEXT,
        last_success_at TEXT,
        etag TEXT,
        last_modified TEXT,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        logo_url TEXT,
        logo_cache_key TEXT,
        group_title TEXT,
        user_agent TEXT,
        referrer TEXT,
        normalized_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES playlist_sources(id) ON DELETE CASCADE,
        UNIQUE(source_id, url)
      );

      CREATE INDEX IF NOT EXISTS idx_channels_url ON channels(url);
      CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_title);
      CREATE INDEX IF NOT EXISTS idx_channels_seen ON channels(last_seen_at);

      CREATE TABLE IF NOT EXISTS favorites (
        channel_url TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS play_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_url TEXT NOT NULL,
        played_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_health (
        channel_url TEXT PRIMARY KEY,
        last_check_at TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        fail_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );

      CREATE TABLE IF NOT EXISTS logo_cache (
        logo_url TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL UNIQUE,
        file_path TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        etag TEXT,
        last_modified TEXT,
        last_access_at TEXT NOT NULL,
        expires_at TEXT
      );
    `)
    this.seedPlaylistSources()
  }

  seedPlaylistSources() {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO playlist_sources (name, url, enabled, priority, status)
      VALUES (@name, @url, 1, @priority, 'seeded')
    `)
    for (const source of DEFAULT_PLAYLIST_SOURCES) stmt.run(source)
  }

  getPlaylistSources() {
    return this.db.prepare(`
      SELECT id, name, url, enabled, priority, last_fetch_at, last_success_at, status
      FROM playlist_sources
      ORDER BY priority ASC, id ASC
    `).all()
  }

  getEnabledPlaylistSources() {
    return this.db.prepare(`
      SELECT id, name, url, enabled, priority, last_fetch_at, last_success_at, status
      FROM playlist_sources
      WHERE enabled = 1
      ORDER BY priority ASC, id ASC
    `).all()
  }

  listChannels() {
    const rows = this.db.prepare(`
      SELECT name, url, logo_url, group_title, user_agent, referrer
      FROM channels
      WHERE enabled = 1
      ORDER BY name COLLATE NOCASE ASC
    `).all()
    const seen = new Set()
    return rows.reduce((acc, row) => {
      if (seen.has(row.url)) return acc
      seen.add(row.url)
      acc.push({
        name: row.name,
        url: row.url,
        logo: row.logo_url ? `/logo?url=${encodeURIComponent(row.logo_url)}` : '',
        logoUrl: row.logo_url || '',
        group: row.group_title || '',
        userAgent: row.user_agent || '',
        referrer: row.referrer || '',
      })
      return acc
    }, [])
  }

  replaceSourceChannels(sourceId, channels) {
    const seenAt = nowIso()
    const findCreated = this.db.prepare('SELECT created_at FROM channels WHERE source_id = ? AND url = ?')
    const upsert = this.db.prepare(`
      INSERT INTO channels (
        source_id, name, url, logo_url, logo_cache_key, group_title, user_agent, referrer,
        normalized_key, enabled, last_seen_at, created_at, updated_at
      )
      VALUES (
        @sourceId, @name, @url, @logo, @logoCacheKey, @group, @userAgent, @referrer,
        @normalizedKey, 1, @seenAt, @createdAt, @seenAt
      )
      ON CONFLICT(source_id, url) DO UPDATE SET
        name = excluded.name,
        logo_url = excluded.logo_url,
        logo_cache_key = excluded.logo_cache_key,
        group_title = excluded.group_title,
        user_agent = excluded.user_agent,
        referrer = excluded.referrer,
        normalized_key = excluded.normalized_key,
        enabled = 1,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `)
    const disableMissing = this.db.prepare(`
      UPDATE channels
      SET enabled = 0, updated_at = ?
      WHERE source_id = ? AND last_seen_at != ?
    `)
    const updateSource = this.db.prepare(`
      UPDATE playlist_sources
      SET last_fetch_at = ?, last_success_at = ?, status = ?
      WHERE id = ?
    `)

    const write = this.db.transaction(() => {
      for (const ch of channels) {
        const created = findCreated.get(sourceId, ch.url)?.created_at || seenAt
        upsert.run({
          sourceId,
          name: ch.name || 'Unknown',
          url: ch.url,
          logo: ch.logo || '',
          logoCacheKey: ch.logo ? logoCacheKey(ch.logo) : '',
          group: ch.group || '',
          userAgent: ch.userAgent || '',
          referrer: ch.referrer || '',
          normalizedKey: `${(ch.name || '').toLowerCase()}|${ch.url}`,
          seenAt,
          createdAt: created,
        })
      }
      disableMissing.run(seenAt, sourceId, seenAt)
      updateSource.run(seenAt, seenAt, `ok:${channels.length}`, sourceId)
    })
    write()
  }

  markSourceFetchFailed(sourceId, error) {
    this.db.prepare(`
      UPDATE playlist_sources
      SET last_fetch_at = ?, status = ?
      WHERE id = ?
    `).run(nowIso(), `error:${String(error).slice(0, 160)}`, sourceId)
  }

  getFavorites() {
    return this.db.prepare('SELECT channel_url FROM favorites ORDER BY created_at ASC')
      .all()
      .map((row) => row.channel_url)
  }

  toggleFavorite(channelUrl) {
    const existing = this.db.prepare('SELECT channel_url FROM favorites WHERE channel_url = ?').get(channelUrl)
    if (existing) {
      this.db.prepare('DELETE FROM favorites WHERE channel_url = ?').run(channelUrl)
    } else {
      this.db.prepare('INSERT INTO favorites (channel_url, created_at) VALUES (?, ?)').run(channelUrl, nowIso())
    }
    return this.getFavorites()
  }

  importFavorites(channelUrls) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO favorites (channel_url, created_at) VALUES (?, ?)')
    const write = this.db.transaction(() => {
      for (const url of channelUrls) {
        if (url) insert.run(url, nowIso())
      }
    })
    write()
  }

  recordPlay(channelUrl) {
    this.db.prepare('INSERT INTO play_history (channel_url, played_at) VALUES (?, ?)').run(channelUrl, nowIso())
    this.updateChannelHealth(channelUrl, 'playing')
  }

  updateChannelHealth(channelUrl, status, lastError = '') {
    const row = this.db.prepare('SELECT fail_count FROM channel_health WHERE channel_url = ?').get(channelUrl)
    const failCount = status === 'error' ? ((row?.fail_count || 0) + 1) : 0
    this.db.prepare(`
      INSERT INTO channel_health (channel_url, last_check_at, status, fail_count, last_error)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel_url) DO UPDATE SET
        last_check_at = excluded.last_check_at,
        status = excluded.status,
        fail_count = excluded.fail_count,
        last_error = excluded.last_error
    `).run(channelUrl, nowIso(), status, failCount, lastError || '')
  }

  getLogoCache(logoUrl) {
    return this.db.prepare('SELECT * FROM logo_cache WHERE logo_url = ?').get(logoUrl)
  }

  touchLogoCache(logoUrl) {
    this.db.prepare('UPDATE logo_cache SET last_access_at = ? WHERE logo_url = ?').run(nowIso(), logoUrl)
  }

  saveLogoCache(logoUrl, contentType, body, ext) {
    const key = logoCacheKey(logoUrl)
    const filePath = logoFilePath(this.logoCacheDir, key, ext)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, body)
    this.db.prepare(`
      INSERT INTO logo_cache (logo_url, cache_key, file_path, content_type, size_bytes, last_access_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(logo_url) DO UPDATE SET
        file_path = excluded.file_path,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        last_access_at = excluded.last_access_at
    `).run(logoUrl, key, filePath, contentType || 'application/octet-stream', body.length, nowIso())
    return { file_path: filePath, content_type: contentType, size_bytes: body.length }
  }

  importJsonChannels(jsonPath, sourceName) {
    if (!fs.existsSync(jsonPath)) return 0
    let source = this.db.prepare(
      'SELECT id FROM playlist_sources WHERE url = ?'
    ).get(`file://${jsonPath}`)
    if (!source) {
      this.db.prepare(`
        INSERT INTO playlist_sources (name, url, enabled, priority, status)
        VALUES (?, ?, 1, 0, 'local')
      `).run(sourceName || 'Local JSON', `file://${jsonPath}`)
      source = this.db.prepare(
        'SELECT id FROM playlist_sources WHERE url = ?'
      ).get(`file://${jsonPath}`)
    }
    const channels = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    const formatted = channels.map((ch) => ({
      name: ch.name || 'Unknown',
      url: ch.url,
      logo: ch.logo || '',
      group: ch.group || '',
      userAgent: ch.userAgent || '',
      referrer: ch.referrer || '',
    }))
    this.replaceSourceChannels(source.id, formatted)
    return formatted.length
  }

  close() {
    this.db.close()
  }
}

module.exports = { IptvStore, parseM3U }
