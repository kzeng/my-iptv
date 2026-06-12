const { spawnSync } = require('child_process')
const path = require('path')

require('./patch-v8-headers')

const bin = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild'
)

const result = spawnSync(bin, ['-f', '-w', 'better-sqlite3'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    CXXFLAGS: [process.env.CXXFLAGS, '-std=c++20'].filter(Boolean).join(' '),
  },
})

process.exit(result.status ?? 1)
