const M3U_FILE = 'channels.m3u'
const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u'
const PROXY_BASE = 'http://127.0.0.1:12999/proxy?url='



let channels = []
let filteredChannels = []
let favorites = []
let currentChannel = null
let currentSort = 'name'
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
  for (const src of [M3U_FILE, M3U_URL]) {
    try {
      const res = await fetch(src)
      if (!res.ok) continue
      const text = await res.text()
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
  let r = q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels
  if (currentSort === 'name') {
    r.sort((a, b) => a.name.localeCompare(b.name))
  } else if (currentSort === 'fav') {
    const s = new Set(favorites)
    r.sort((a, b) => (s.has(a.url) ? 0 : 1) - (s.has(b.url) ? 0 : 1) || a.name.localeCompare(b.name))
  }
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
  el.innerHTML = msg
  el.style.display = 'block'
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
    clearError()

    window.iptvAPI.setChannelHeaders({
      url: ch.url,
      userAgent: ch.userAgent || null,
      referrer: ch.referrer || null,
    })

    const isHLS = ch.url.includes('.m3u8')

    if (isHLS && typeof Hls !== 'undefined' && Hls.isSupported()) {
      hls = new Hls({
        maxBufferLength: 30,
        enableWorker: false,
      })
      hls.loadSource(PROXY_BASE + encodeURIComponent(ch.url))
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.classList.add('visible')
        video.muted = true
        video.play().then(() => {
          setTimeout(() => { video.muted = false }, 500)
        }).catch((e) => {
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

document.querySelectorAll('.sort-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    currentSort = btn.dataset.sort
    applyFilterAndSort()
  })
})

document.getElementById('refresh-btn').addEventListener('click', async () => {
  channelList.innerHTML = '<div class="empty-msg">Loading channels...</div>'
  try {
    channels = await loadM3U()
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
  channelList.innerHTML = '<div class="empty-msg">Loading channels...</div>'
  try {
    channels = await loadM3U()
  } catch {
    channelList.innerHTML = '<div class="empty-msg" style="color:#e94560;">Failed to load channels. Check connection.</div>'
    return
  }
  applyFilterAndSort()
  const net = await testNetwork()
  channelCount.textContent = `${filteredChannels.length} channels | ${net}`
  if (channels.length > 0) playChannel(channels[0])
}

init()
