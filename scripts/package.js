const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const RELEASE = path.join(ROOT, 'release')
const APP_NAME = 'My IPTV'
const APP_FILES = ['main.js', 'preload.js', 'index.html', 'style.css', 'app.js', 'channels.json', 'channels.m3u', 'package.json']
const APP_DIRS = [
  { src: 'lib', dst: 'lib' },
  { src: path.join('node_modules', 'hls.js'), dst: path.join('node_modules', 'hls.js') },
]

const platform = process.platform

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {
      try { execSync(`rm -rf "${dir}"`) } catch {}
    }
  }
}

function cp(src, dst) {
  const stat = fs.lstatSync(src)
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(src)
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    try { fs.unlinkSync(dst) } catch {}
    fs.symlinkSync(target, dst)
  } else if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      cp(path.join(src, entry.name), path.join(dst, entry.name))
    }
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

function buildMac() {
  const appDir = path.join(RELEASE, `${APP_NAME}.app`)
  const contentsDir = path.join(appDir, 'Contents')
  const resourcesDir = path.join(contentsDir, 'Resources')
  const macosDir = path.join(contentsDir, 'MacOS')
  const appResources = path.join(resourcesDir, 'app')

  rmrf(appDir)
  cp(path.join(ELECTRON_DIST, 'Electron.app'), appDir)
  rmrf(path.join(resourcesDir, 'default_app.asar'))
  rmrf(path.join(resourcesDir, 'app'))

  fs.mkdirSync(appResources, { recursive: true })

  for (const f of APP_FILES) {
    cp(path.join(ROOT, f), path.join(appResources, f))
  }
  for (const d of APP_DIRS) {
    cp(path.join(ROOT, d.src), path.join(appResources, d.dst))
  }

  const plist = path.join(contentsDir, 'Info.plist')
  try {
    execSync(`/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName ${APP_NAME}' '${plist}'`)
    execSync(`/usr/libexec/PlistBuddy -c 'Set :CFBundleName ${APP_NAME}' '${plist}'`)
    execSync(`/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.myiptv.app' '${plist}'`)
  } catch {}

  const symlink = path.join(macosDir, APP_NAME)
  if (fs.existsSync(symlink)) fs.unlinkSync(symlink)
  try {
    fs.symlinkSync('Electron', symlink)
  } catch {}

  const zipName = `${APP_NAME}-1.0.0-mac-x64.zip`
  const zipPath = path.join(RELEASE, zipName)
  execSync(`ditto -c -k --sequesterRsrc --keepParent "${appDir}" "${zipPath}"`)
  console.log(`Packaged: ${zipPath}`)
}

function buildWin() {
  const appDir = path.join(RELEASE, APP_NAME)
  const resourcesDir = path.join(appDir, 'resources')
  const appResources = path.join(resourcesDir, 'app')

  rmrf(appDir)
  fs.mkdirSync(appResources, { recursive: true })

  cp(path.join(ELECTRON_DIST, 'electron.exe'), path.join(appDir, `${APP_NAME}.exe`))
  if (fs.existsSync(path.join(ELECTRON_DIST, 'ffmpeg.dll'))) {
    cp(path.join(ELECTRON_DIST, 'ffmpeg.dll'), path.join(appDir, 'ffmpeg.dll'))
  }
  for (const f of ['LICENSE', 'LICENSES.chromium.html', 'version']) {
    const src = path.join(ELECTRON_DIST, f)
    if (fs.existsSync(src)) cp(src, path.join(appDir, f))
  }

  for (const f of APP_FILES) {
    cp(path.join(ROOT, f), path.join(appResources, f))
  }
  for (const d of APP_DIRS) {
    cp(path.join(ROOT, d.src), path.join(appResources, d.dst))
  }

  const zipName = `${APP_NAME}-1.0.0-win-x64.zip`
  buildZip(appDir, path.join(RELEASE, zipName))
  console.log(`Packaged: ${path.join(RELEASE, zipName)}`)
}

function buildLinux() {
  const appDir = path.join(RELEASE, APP_NAME)
  const resourcesDir = path.join(appDir, 'resources')
  const appResources = path.join(resourcesDir, 'app')

  rmrf(appDir)
  fs.mkdirSync(appResources, { recursive: true })

  cp(path.join(ELECTRON_DIST, 'electron'), path.join(appDir, APP_NAME))
  for (const f of ['LICENSE', 'LICENSES.chromium.html', 'version']) {
    const src = path.join(ELECTRON_DIST, f)
    if (fs.existsSync(src)) cp(src, path.join(appDir, f))
  }

  for (const f of APP_FILES) {
    cp(path.join(ROOT, f), path.join(appResources, f))
  }
  for (const d of APP_DIRS) {
    cp(path.join(ROOT, d.src), path.join(appResources, d.dst))
  }

  const archiveName = `${APP_NAME}-1.0.0-linux-x64.tar.gz`
  const archivePath = path.join(RELEASE, archiveName)
  execSync(`tar -czf "${archivePath}" -C "${RELEASE}" "${APP_NAME}"`)
  console.log(`Packaged: ${archivePath}`)
}

function buildZip(srcDir, dstPath) {
  if (process.platform === 'darwin') {
    execSync(`ditto -c -k --sequesterRsrc --keepParent "${srcDir}" "${dstPath}"`)
  } else {
    const { createWriteStream } = require('fs')
    const archiver = require('archiver')
    // fallback: use zip command if available
    try {
      execSync(`zip -r "${dstPath}" "${path.basename(srcDir)}"`, { cwd: path.dirname(srcDir) })
    } catch {
      console.warn('zip command not available, skipping ZIP')
    }
  }
}

function main() {
  rmrf(RELEASE)
  fs.mkdirSync(RELEASE, { recursive: true })

  if (platform === 'darwin') {
    buildMac()
  } else if (platform === 'win32') {
    buildWin()
  } else if (platform === 'linux') {
    buildLinux()
  } else {
    console.error(`Unsupported platform: ${platform}`)
    process.exit(1)
  }
}

main()
