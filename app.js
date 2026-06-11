const CHANNEL_SOURCES = ['channels.json', 'channels.m3u', 'https://iptv-org.github.io/iptv/index.m3u']
const PROXY_BASE = 'http://127.0.0.1:12999/proxy?url='

const DEFAULT_SETTINGS = {
  maxBufferLength: 90,
  maxMaxBufferLength: 300,
  maxBufferSize: 200,
  backBufferLength: 30,
  enableWorker: true,
  startLevel: -1,
  capLevelToPlayerSize: true,
  startFragPrefetch: true,
  fragLoadingMaxRetry: 6,
  fragLoadingTimeOut: 20000,
}

let channels = []
let filteredChannels = []
let favorites = []
let settings = {}
let currentChannel = null
let showFavoritesOnly = false
let selectedGroup = ''
let hls = null

const video = document.getElementById('video-player')
const channelList = document.getElementById('channel-list')
const searchInput = document.getElementById('search')
const channelNameDisplay = document.getElementById('channel-name')
const channelCount = document.getElementById('channel-count')
const videoContainer = document.getElementById('video-container')

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

async function loadM3U() {
  for (const src of CHANNEL_SOURCES) {
    try {
      const res = await fetch(src)
      if (!res.ok) continue
      const text = await res.text()
      if (src.endsWith('.json')) return JSON.parse(text)
      if (text.includes('#EXTM3U')) return parseM3U(text)
    } catch {}
  }
  throw new Error('Failed to load channels')
}

function renderChannels(list) {
  channelList.innerHTML = ''
  if (list.length === 0) {
    channelList.innerHTML = '<div class="empty-msg">No channels found</div>'
    return
  }
  const frag = document.createDocumentFragment()
  for (const ch of list) {
    const item = document.createElement('div')
    item.className = 'channel-item'
    item.dataset.url = ch.url
    if (currentChannel && ch.url === currentChannel.url) item.classList.add('active')
    const isFav = favorites.includes(ch.url)
    item.innerHTML = `
      <img class="ch-logo" src="${ch.logo || ''}" alt="" loading="lazy" onerror="this.style.display='none'" />
      <span class="ch-name">${ch.name}</span>
      <button class="fav-btn${isFav ? ' favorited' : ''}" data-url="${ch.url}">${isFav ? '★' : '☆'}</button>
    `
    frag.appendChild(item)
  }
  channelList.appendChild(frag)
}

function applyFilterAndSort() {
  const q = searchInput.value.toLowerCase().trim()
  let r = channels
  if (q) r = r.filter((c) => c.name.toLowerCase().includes(q))
  if (selectedGroup) {
    r = r.filter((c) => {
      if (!c.group) return false
      const groups = c.group.split(';').map((g) => g.trim())
      return groups.includes(selectedGroup)
    })
  }
  if (showFavoritesOnly) {
    const s = new Set(favorites)
    r = r.filter((c) => s.has(c.url))
  }
  r.sort((a, b) => a.name.localeCompare(b.name))
  filteredChannels = r
  renderChannels(filteredChannels)
  channelCount.textContent = `${filteredChannels.length} channels`
}

function updateActiveChannel() {
  const items = channelList.querySelectorAll('.channel-item')
  for (const item of items) {
    item.classList.toggle('active', item.dataset.url === currentChannel?.url)
  }
}

function showError(msg, isRetryable) {
  let el = videoContainer.querySelector('.player-error')
  if (!el) {
    el = document.createElement('div')
    el.className = 'player-error'
    videoContainer.appendChild(el)
  }
  el.innerHTML = '<button class="error-close">×</button>' + msg
  el.style.display = 'block'
  el.querySelector('.error-close').onclick = (e) => { e.stopPropagation(); clearError() }
  if (isRetryable && currentChannel) {
    const btn = document.createElement('button')
    btn.className = 'retry-btn'
    btn.textContent = 'Retry'
    btn.onclick = () => { clearError(); playChannel(currentChannel) }
    el.appendChild(btn)
  }
}

function clearError() {
  const el = videoContainer.querySelector('.player-error')
  if (el) el.style.display = 'none'
}

function playChannel(ch) {
  if (!ch || !ch.url) return
  try {
    if (hls) { hls.destroy(); hls = null }
    video.pause()
    video.removeAttribute('src')
    video.classList.remove('visible')
    video.muted = false

    currentChannel = ch
    channelNameDisplay.textContent = ch.name
    const infoEl = document.getElementById('channel-info')
    const parts = []
    if (ch.group) parts.push(ch.group)
    if (ch.url) parts.push(ch.url)
    if (ch.userAgent) parts.push('UA: ' + ch.userAgent)
    infoEl.textContent = parts.join(' · ')
    clearError()
    window.iptvAPI.saveLastChannel(ch.url)

    window.iptvAPI.setChannelHeaders({
      url: ch.url,
      userAgent: ch.userAgent || null,
      referrer: ch.referrer || null,
    })

    const isHLS = ch.url.includes('.m3u8')

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: settings.maxBufferLength || DEFAULT_SETTINGS.maxBufferLength,
        maxMaxBufferLength: settings.maxMaxBufferLength || DEFAULT_SETTINGS.maxMaxBufferLength,
        maxBufferSize: (settings.maxBufferSize || DEFAULT_SETTINGS.maxBufferSize) * 1000 * 1000,
        backBufferLength: settings.backBufferLength ?? DEFAULT_SETTINGS.backBufferLength,
        enableWorker: settings.enableWorker ?? DEFAULT_SETTINGS.enableWorker,
        startLevel: settings.startLevel ?? DEFAULT_SETTINGS.startLevel,
        capLevelToPlayerSize: settings.capLevelToPlayerSize ?? DEFAULT_SETTINGS.capLevelToPlayerSize,
        startFragPrefetch: settings.startFragPrefetch ?? DEFAULT_SETTINGS.startFragPrefetch,
        fragLoadingMaxRetry: settings.fragLoadingMaxRetry ?? DEFAULT_SETTINGS.fragLoadingMaxRetry,
        fragLoadingTimeOut: settings.fragLoadingTimeOut || DEFAULT_SETTINGS.fragLoadingTimeOut,
      })
      hls.loadSource(PROXY_BASE + encodeURIComponent(ch.url))
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.classList.add('visible')
        video.muted = true
        video.play().then(() => {
          setTimeout(() => { video.muted = false }, 500)
        }).catch((e) => {
          if (ch.url !== currentChannel?.url) return
          showError('Click to play: ' + e.message, true)
          video.muted = false
          video.classList.add('visible')
        })
      })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          const code = data.response ? data.response.code : ''
          const detail = data.details || data.type || 'unknown'
          const prefix = code ? 'HTTP ' + code + ' (' + detail + ')' : detail
          const hint = data.details && data.details.includes('LoadError') ? ' - stream may be offline' : ''
          showError('Stream: ' + prefix + hint, true)
        }
      })
    } else {
      video.classList.add('visible')
      video.muted = true
      video.src = ch.url
      video.play().then(() => {
        setTimeout(() => { video.muted = false }, 500)
      }).catch((e) => {
        if (ch.url !== currentChannel?.url) return
        showError('Unsupported stream: ' + e.message)
      })
    }

    updateActiveChannel()
  } catch (err) {
    showError('Error: ' + err.message)
  }
}

async function toggleFavorite(channelUrl) {
  try {
    favorites = await window.iptvAPI.toggleFavorite(channelUrl)
    applyFilterAndSort()
  } catch {}
}

async function takeScreenshot() {
  if (!video.classList.contains('visible') || !video.videoWidth) return
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  canvas.getContext('2d').drawImage(video, 0, 0)
  canvas.toBlob(async (blob) => {
    if (!blob) return
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1]
      await window.iptvAPI.saveFile(
        { defaultName: 'screenshot.png', filters: [{ name: 'PNG', extensions: ['png'] }] },
        base64
      )
    }
    reader.readAsDataURL(blob)
  }, 'image/png')
}

let mediaRecorder = null
let recordedChunks = []

function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop()
  } else {
    startRecording()
  }
}

function startRecording() {
  if (!video.classList.contains('visible') || !video.videoWidth) return
  const stream = video.captureStream()
  if (!stream) return
  recordedChunks = []
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : 'video/webm'
  mediaRecorder = new MediaRecorder(stream, { mimeType: mime })
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data)
  }
  mediaRecorder.onstop = async () => {
    document.getElementById('btn-record').classList.remove('recording')
    document.getElementById('btn-record').textContent = '⏺ Record'
    const blob = new Blob(recordedChunks, { type: 'video/webm' })
    if (blob.size === 0) return
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1]
      await window.iptvAPI.saveFile(
        { defaultName: 'recording.webm', filters: [{ name: 'WebM', extensions: ['webm'] }] },
        base64
      )
    }
    reader.readAsDataURL(blob)
  }
  mediaRecorder.start()
  document.getElementById('btn-record').textContent = '⏹ Stop'
  document.getElementById('btn-record').classList.add('recording')
}

document.getElementById('btn-screenshot').addEventListener('click', takeScreenshot)
document.getElementById('btn-record').addEventListener('click', toggleRecording)

channelList.addEventListener('click', (e) => {
  const item = e.target.closest('.channel-item')
  if (!item) return
  const favBtn = e.target.closest('.fav-btn')
  if (favBtn) { toggleFavorite(favBtn.dataset.url); return }
  const url = item.dataset.url
  if (!url) return
  const ch = filteredChannels.find((c) => c.url === url)
  if (ch) playChannel(ch)
})

searchInput.addEventListener('input', applyFilterAndSort)

function populateGroupFilter() {
  const groups = new Set()
  for (const c of channels) {
    if (c.group) {
      for (const g of c.group.split(';')) {
        const t = g.trim()
        if (t) groups.add(t)
      }
    }
  }
  const sel = document.getElementById('group-filter')
  const current = sel.value
  sel.innerHTML = '<option value="">All Groups</option>'
  for (const g of [...groups].sort()) {
    const opt = document.createElement('option')
    opt.value = g
    opt.textContent = g
    sel.appendChild(opt)
  }
  sel.value = groups.has(current) ? current : ''
}

document.getElementById('toggle-fav').addEventListener('click', () => {
  showFavoritesOnly = !showFavoritesOnly
  document.getElementById('toggle-fav').classList.toggle('active', showFavoritesOnly)
  applyFilterAndSort()
})

document.getElementById('group-filter').addEventListener('change', () => {
  selectedGroup = document.getElementById('group-filter').value
  applyFilterAndSort()
})

function populateSettingsPanel() {
  const s = { ...DEFAULT_SETTINGS, ...settings }
  document.getElementById('s-maxBufferLength').value = s.maxBufferLength
  document.getElementById('s-maxBufferSize').value = s.maxBufferSize
  document.getElementById('s-startLevel').value = s.startLevel
  document.getElementById('s-fragLoadingMaxRetry').value = s.fragLoadingMaxRetry
  document.getElementById('s-fragLoadingTimeOut').value = s.fragLoadingTimeOut
  document.getElementById('s-enableWorker').checked = s.enableWorker
  document.getElementById('s-capLevelToPlayerSize').checked = s.capLevelToPlayerSize
  document.getElementById('s-startFragPrefetch').checked = s.startFragPrefetch
}

function readSettingsPanel() {
  return {
    maxBufferLength: parseInt(document.getElementById('s-maxBufferLength').value) || DEFAULT_SETTINGS.maxBufferLength,
    maxBufferSize: parseInt(document.getElementById('s-maxBufferSize').value) || DEFAULT_SETTINGS.maxBufferSize,
    startLevel: parseInt(document.getElementById('s-startLevel').value) || DEFAULT_SETTINGS.startLevel,
    fragLoadingMaxRetry: parseInt(document.getElementById('s-fragLoadingMaxRetry').value) || DEFAULT_SETTINGS.fragLoadingMaxRetry,
    fragLoadingTimeOut: parseInt(document.getElementById('s-fragLoadingTimeOut').value) || DEFAULT_SETTINGS.fragLoadingTimeOut,
    enableWorker: document.getElementById('s-enableWorker').checked,
    capLevelToPlayerSize: document.getElementById('s-capLevelToPlayerSize').checked,
    startFragPrefetch: document.getElementById('s-startFragPrefetch').checked,
  }
}

document.getElementById('settings-btn').addEventListener('click', () => {
  populateSettingsPanel()
  document.getElementById('settings-overlay').classList.remove('hidden')
})

document.getElementById('settings-close').addEventListener('click', () => {
  document.getElementById('settings-overlay').classList.add('hidden')
})

document.getElementById('settings-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settings-overlay'))
    document.getElementById('settings-overlay').classList.add('hidden')
})

document.getElementById('settings-reset').addEventListener('click', () => {
  settings = {}
  populateSettingsPanel()
})

document.getElementById('settings-apply').addEventListener('click', async () => {
  settings = readSettingsPanel()
  await window.iptvAPI.saveSettings(settings)
  document.getElementById('settings-overlay').classList.add('hidden')
  if (hls) { hls.destroy(); hls = null }
  if (currentChannel) playChannel(currentChannel)
})

document.getElementById('about-btn').addEventListener('click', () => {
  document.getElementById('about-overlay').classList.remove('hidden')
})

document.getElementById('about-close').addEventListener('click', () => {
  document.getElementById('about-overlay').classList.add('hidden')
})

document.getElementById('about-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('about-overlay'))
    document.getElementById('about-overlay').classList.add('hidden')
})

document.getElementById('refresh-btn').addEventListener('click', async () => {
  channelList.innerHTML = '<div class="empty-msg">Loading channels...</div>'
  try {
    channels = await loadM3U()
    populateGroupFilter()
    applyFilterAndSort()
  } catch {
    channelList.innerHTML = '<div class="empty-msg" style="color:#e94560;">Failed to load channels</div>'
  }
})

async function testNetwork() {
  try {
    const res = await fetch('https://clients3.google.com/generate_204', { mode: 'no-cors' })
    return 'net OK'
  } catch {
    try {
      const res = await fetch('http://example.com', { mode: 'no-cors' })
      return 'net OK (http)'
    } catch (e) {
      return 'net FAIL: ' + e.message
    }
  }
}

async function init() {
  try { favorites = await window.iptvAPI.getFavorites() } catch {}
  try {
    const saved = await window.iptvAPI.getSettings()
    if (saved) settings = saved
  } catch {}
  channelList.innerHTML = '<div class="empty-msg">Loading channels...</div>'
  try {
    channels = await loadM3U()
    populateGroupFilter()
  } catch {
    channelList.innerHTML = '<div class="empty-msg" style="color:#e94560;">Failed to load channels. Check connection.</div>'
    return
  }
  applyFilterAndSort()
  const net = await testNetwork()
  channelCount.textContent = `${filteredChannels.length} channels | ${net}`
  if (channels.length > 0) {
    let restored = false
    try {
      const saved = await window.iptvAPI.getLastChannel()
      if (saved && saved.url) {
        const found = channels.find((c) => c.url === saved.url)
        if (found) { playChannel(found); restored = true }
      }
    } catch {}
    if (!restored) playChannel(channels[0])
  }
}

init()
