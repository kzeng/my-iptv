const { app, BrowserWindow, ipcMain, session, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')
const { IptvStore, parseM3U } = require('./db')

const FAVORITES_FILE = path.join(app.getPath('userData'), 'favorites.json')
const LAST_CHANNEL_FILE = path.join(app.getPath('userData'), 'last-channel.json')
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')
const PORT = 12999
const ROOT = __dirname
const APP_ICON = path.join(ROOT, 'assets', 'my-iptv-logo.png')

let mainWindow
let server
let store
let pendingChannelHeaders = null
const keepAliveAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 32 })
const keepAliveAgentHttps = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 32 })

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

function rewriteM3U8(content, baseUrl) {
  return content.split('\n').map(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return resolveUrl(baseUrl, trimmed)
    }
    if (trimmed.includes('URI="')) {
      return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
        if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) return `URI="${uri}"`
        return `URI="${resolveUrl(baseUrl, uri)}"`
      })
    }
    return line
  }).join('\n')
}

function loadFavorites() {
  try {
    if (fs.existsSync(FAVORITES_FILE)) {
      return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8'))
    }
  } catch (e) {}
  return []
}

function saveFavorites(favorites) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favorites, null, 2))
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.m3u': 'audio/x-mpegurl',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

function fetchText(targetUrl, headers = null, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error('Too many redirects'))
      return
    }
    const isHttps = targetUrl.startsWith('https')
    const mod = isHttps ? https : http
    const options = new URL(targetUrl)
    options.agent = isHttps ? keepAliveAgentHttps : keepAliveAgent
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    if (headers) {
      if (headers.userAgent) options.headers['User-Agent'] = headers.userAgent
      if (headers.referrer) options.headers['Referer'] = headers.referrer
    }

    const req = mod.get(options, (res) => {
      const status = res.statusCode || 200
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        fetchText(resolveUrl(targetUrl, res.headers.location), headers, depth + 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status}`))
        return
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > 25 * 1024 * 1024) {
          req.destroy(new Error('Response too large'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout')))
  })
}

function logoExtension(contentType, logoUrl) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase()
  if (type === 'image/png') return '.png'
  if (type === 'image/jpeg') return '.jpg'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/svg+xml') return '.svg'
  const ext = path.extname(new URL(logoUrl).pathname).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) return ext
  return '.img'
}

function fetchBuffer(targetUrl, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error('Too many redirects'))
      return
    }
    const isHttps = targetUrl.startsWith('https')
    const mod = isHttps ? https : http
    const options = new URL(targetUrl)
    options.agent = isHttps ? keepAliveAgentHttps : keepAliveAgent
    options.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    const req = mod.get(options, (res) => {
      const status = res.statusCode || 200
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        fetchBuffer(resolveUrl(targetUrl, res.headers.location), depth + 1).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status}`))
        return
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) {
          req.destroy(new Error('Logo too large'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        resolve({
          body: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || 'application/octet-stream',
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')))
  })
}

async function refreshChannelsToDb() {
  const sources = store.getEnabledPlaylistSources()
  const results = []
  for (const source of sources) {
    try {
      const text = await fetchText(source.url)
      const channels = source.url.endsWith('.json') ? JSON.parse(text) : parseM3U(text)
      store.replaceSourceChannels(source.id, channels)
      results.push({ url: source.url, ok: true, count: channels.length })
    } catch (e) {
      store.markSourceFetchFailed(source.id, e.message)
      results.push({ url: source.url, ok: false, error: e.message })
    }
  }
  return { results, channels: store.listChannels() }
}

async function serveLogo(logoUrl, res) {
  try {
    if (!logoUrl || !/^https?:\/\//i.test(logoUrl)) {
      res.writeHead(204)
      res.end()
      return
    }
    const cached = store.getLogoCache(logoUrl)
    if (cached && cached.file_path && fs.existsSync(cached.file_path)) {
      store.touchLogoCache(logoUrl)
      res.writeHead(200, {
        'Content-Type': cached.content_type || MIME[path.extname(cached.file_path)] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=604800',
      })
      fs.createReadStream(cached.file_path).pipe(res)
      return
    }
    const fetched = await fetchBuffer(logoUrl)
    const ext = logoExtension(fetched.contentType, logoUrl)
    const saved = store.saveLogoCache(logoUrl, fetched.contentType, fetched.body, ext)
    res.writeHead(200, {
      'Content-Type': saved.content_type || MIME[path.extname(saved.file_path)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=604800',
    })
    res.end(fetched.body)
  } catch {
    res.writeHead(204)
    res.end()
  }
}

function fetchURL(targetUrl, headers, res) {
  _doFetch(targetUrl, headers, res, 0)
}

function _doFetch(targetUrl, headers, res, depth) {
  if (depth > 5) {
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('Too many redirects')
    }
    return
  }
  let parsed
  try {
    parsed = new URL(targetUrl)
  } catch {
    if (!res.headersSent) {
      res.writeHead(400)
      res.end('Invalid URL: ' + targetUrl.slice(0, 200))
    }
    return
  }
  const isHttps = targetUrl.startsWith('https')
  const mod = isHttps ? https : http
  const options = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    agent: isHttps ? keepAliveAgentHttps : keepAliveAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    },
  }
  if (headers) {
    if (headers.userAgent) options.headers['User-Agent'] = headers.userAgent
    if (headers.referrer) options.headers['Referer'] = headers.referrer
  }

  let finished = false
  let overallTimer = null
  function cleanup() { clearTimeout(overallTimer) }

  const proxyReq = mod.get(options, (proxyRes) => {
    const status = proxyRes.statusCode || 200
    if (status >= 300 && status < 400 && proxyRes.headers.location) {
      proxyRes.resume()
      finished = true
      cleanup()
      _doFetch(resolveUrl(targetUrl, proxyRes.headers.location), headers, res, depth + 1)
      return
    }
    const contentType = proxyRes.headers['content-type'] || ''
    const isM3U8 = contentType.includes('mpegurl') || contentType.includes('x-mpegurl') || targetUrl.includes('.m3u8')
    if (isM3U8) {
      const chunks = []
      proxyRes.on('data', (chunk) => chunks.push(chunk))
      proxyRes.on('end', () => {
        finished = true
        cleanup()
        const body = Buffer.concat(chunks).toString('utf-8')
        const rewritten = rewriteM3U8(body, targetUrl)
        res.writeHead(status, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        })
        res.end(rewritten)
      })
      return
    }
    let sniffedM3U8 = false
    const chunks = []
    proxyRes.on('data', (chunk) => {
      chunks.push(chunk)
      if (!sniffedM3U8 && chunks.length === 1) {
        const head = chunk.toString('utf-8').trimStart()
        if (head.startsWith('#EXTM3U')) {
          sniffedM3U8 = true
          proxyRes.removeAllListeners('data')
          proxyRes.removeAllListeners('end')
          proxyRes.on('data', (c) => chunks.push(c))
          proxyRes.on('end', () => {
            finished = true
            cleanup()
            const body = Buffer.concat(chunks).toString('utf-8')
            const rewritten = rewriteM3U8(body, targetUrl)
            res.writeHead(status, {
              'Content-Type': 'application/vnd.apple.mpegurl',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            })
            res.end(rewritten)
          })
        }
      }
    })
    proxyRes.on('end', () => {
      if (sniffedM3U8) return
      finished = true
      cleanup()
      const body = Buffer.concat(chunks)
      res.writeHead(status, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      })
      res.end(body)
    })
  })

  overallTimer = setTimeout(() => {
    if (finished || res.headersSent) return
    finished = true
    proxyReq.destroy()
    res.writeHead(504)
    res.end('Proxy timeout')
  }, 30000)
  proxyReq.on('error', () => {
    if (finished || res.headersSent) return
    finished = true
    cleanup()
    res.writeHead(502)
    res.end()
  })
  proxyReq.on('close', () => {
    if (finished || res.headersSent) return
    finished = true
    cleanup()
    if (!res.headersSent) {
      res.writeHead(502)
      res.end('Connection closed')
    }
  })
}

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
      if (parsedUrl.pathname === '/logo') {
        serveLogo(parsedUrl.searchParams.get('url'), res)
        return
      }
      if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.searchParams.get('url')
        if (targetUrl) {
          try {
            fetchURL(targetUrl, pendingChannelHeaders, res)
          } catch (e) {
            console.error('[PROXY ERROR]', e.message)
            if (!res.headersSent) {
              res.writeHead(502)
              res.end('Proxy error: ' + e.message)
            }
          }
          return
        }
      }

      const filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url)
      const ext = path.extname(filePath)
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
        res.end(data)
      })
    })
    server.listen(PORT, '127.0.0.1', () => resolve())
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'My IPTV',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadURL(`http://127.0.0.1:${PORT}/index.html`)

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  store = new IptvStore(app.getPath('userData'))

  try {
    if (fs.existsSync(FAVORITES_FILE)) {
      store.importFavorites(JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8')))
    }
  } catch {}

  const JSON_CHANNELS = path.join(ROOT, 'channels.json')
  if (store.listChannels().length === 0 && fs.existsSync(JSON_CHANNELS)) {
    try {
      const count = store.importJsonChannels(JSON_CHANNELS, 'Pre-compiled')
      console.log(`Imported ${count} channels from channels.json`)
    } catch (e) {
      console.warn('Failed to import channels.json:', e.message)
    }
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Access-Control-Allow-Origin': ['*'],
        'Access-Control-Allow-Headers': ['*'],
      },
    })
  })

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    if (url.startsWith(`http://127.0.0.1:${PORT}/`)) {
      callback({})
      return
    }
    if (url.includes('.m3u8') || url.includes('.ts') || url.includes('.m4s') || url.includes('.aac')) {
      if (url.includes('.m3u8')) {
        callback({ redirectURL: `http://127.0.0.1:${PORT}/proxy?url=${encodeURIComponent(url)}` })
      } else {
        callback({})
      }
      return
    }
    callback({})
  })

  await startServer()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (server) server.close()
  if (store) store.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-channels', () => store.listChannels())

ipcMain.handle('refresh-channels', async () => refreshChannelsToDb())

ipcMain.handle('get-playlist-sources', () => store.getPlaylistSources())

ipcMain.handle('get-favorites', () => store.getFavorites())

ipcMain.handle('toggle-favorite', (_event, channelId) => {
  return store.toggleFavorite(channelId)
})

ipcMain.handle('set-channel-headers', (_event, headers) => {
  pendingChannelHeaders = headers
})

function loadLastChannel() {
  try {
    if (fs.existsSync(LAST_CHANNEL_FILE)) {
      return JSON.parse(fs.readFileSync(LAST_CHANNEL_FILE, 'utf-8'))
    }
  } catch (e) {}
  return null
}

function saveLastChannel(url) {
  try {
    fs.writeFileSync(LAST_CHANNEL_FILE, JSON.stringify({ url }))
  } catch (e) {}
}

ipcMain.handle('get-last-channel', () => loadLastChannel())
ipcMain.handle('save-last-channel', (_event, url) => { saveLastChannel(url) })

ipcMain.handle('record-play', (_event, url) => {
  if (url) store.recordPlay(url)
})

ipcMain.handle('update-channel-health', (_event, url, status, error) => {
  if (url) store.updateChannelHealth(url, status, error)
})

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    }
  } catch (e) {}
  return null
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  } catch (e) {}
}

ipcMain.handle('get-settings', () => loadSettings())
ipcMain.handle('save-settings', (_event, settings) => { saveSettings(settings) })

ipcMain.handle('save-file', async (_event, options, data) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, options)
  if (!filePath) return null
  try {
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
    return filePath
  } catch (e) {
    return null
  }
})
