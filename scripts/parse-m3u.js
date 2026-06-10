const fs = require('fs')
const path = require('path')

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

const m3uPath = path.join(__dirname, '..', 'channels.m3u')
const jsonPath = path.join(__dirname, '..', 'channels.json')

if (!fs.existsSync(m3uPath)) {
  console.error('channels.m3u not found')
  process.exit(1)
}

const text = fs.readFileSync(m3uPath, 'utf-8')
const channels = parseM3U(text)
fs.writeFileSync(jsonPath, JSON.stringify(channels))
console.log(`Parsed ${channels.length} channels → channels.json`)
