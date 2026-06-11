const fs = require('fs')
const path = require('path')

const header = path.join(
  process.env.HOME,
  '.electron-gyp',
  process.env.npm_config_electron_version || '33.0.0',
  'include',
  'node',
  'v8-internal.h'
)

if (!fs.existsSync(header)) {
  console.warn('V8 header not found, skipping patch:', header)
  process.exit(0)
}

let content = fs.readFileSync(header, 'utf-8')

const patches = [
  [
    'using iterator_concept = Iterator::iterator_concept;',
    'using iterator_concept = typename Iterator::iterator_concept;',
  ],
  [
    'using iterator_concept = std::iterator_traits<Iterator>::iterator_concept;',
    'using iterator_concept = typename std::iterator_traits<Iterator>::iterator_concept;',
  ],
]

let modified = false
for (const [from, to] of patches) {
  if (content.includes(from)) {
    content = content.replace(from, to)
    modified = true
    console.log('Patched:', from)
  }
}

if (!modified) {
  console.log('V8 headers already patched or not needed.')
} else {
  fs.writeFileSync(header, content)
}
