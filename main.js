const { app, BrowserWindow, ipcMain, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const https = require('https')

const FAVORITES_FILE = path.join(app.getPath('userData'), 'favorites.json')
const LAST_CHANNEL_FILE = path.join(app.getPath('userData'), 'last-channel.json')
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')
const PORT = 12999
const ROOT = __dirname

let mainWindow
let server
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
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
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
  const isHttps = targetUrl.startsWith('https')
  const mod = isHttps ? https : http
  const options = new URL(targetUrl)
  options.agent = isHttps ? keepAliveAgentHttps : keepAliveAgent
  options.headers = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  }
  if (headers) {
    if (headers.userAgent) options.headers['User-Agent'] = headers.userAgent
    if (headers.referrer) options.headers['Referer'] = headers.referrer
  }

  let finished = false
  const proxyReq = mod.get(options, (proxyRes) => {
    const status = proxyRes.statusCode || 200
    if (status >= 300 && status < 400 && proxyRes.headers.location) {
      proxyRes.resume()
      finished = true
      _doFetch(resolveUrl(targetUrl, proxyRes.headers.location), headers, res, depth + 1)
      return
    }
    const contentType = proxyRes.headers['content-type'] || ''
    const isM3U8 = contentType.includes('mpegurl') || contentType.includes('x-mpegurl') || targetUrl.includes('.m3u8')
    if (isM3U8) {
      const chunks = []
      proxyRes.on('data', (chunk) => chunks.push(chunk))
      proxyRes.on('end', () => {
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
    res.writeHead(status, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    })
    proxyRes.pipe(res)
  })
  proxyReq.on('error', () => {
    if (finished || res.headersSent) return
    finished = true
    res.writeHead(502)
    res.end()
  })
  proxyReq.setTimeout(15000, () => {
    if (finished || res.headersSent) return
    finished = true
    proxyReq.destroy()
    res.writeHead(504)
    res.end()
  })
}

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`)
      if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.searchParams.get('url')
        if (targetUrl) {
          fetchURL(targetUrl, pendingChannelHeaders, res)
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/index.html`)

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }
}

app.whenReady().then(async () => {
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
      callback({ redirectURL: `http://127.0.0.1:${PORT}/proxy?url=${encodeURIComponent(url)}` })
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-favorites', () => loadFavorites())

ipcMain.handle('toggle-favorite', (_event, channelId) => {
  const favorites = loadFavorites()
  const index = favorites.indexOf(channelId)
  if (index === -1) {
    favorites.push(channelId)
  } else {
    favorites.splice(index, 1)
  }
  saveFavorites(favorites)
  return favorites
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
