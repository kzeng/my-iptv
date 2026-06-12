const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')
const RELEASE = process.env.MY_IPTV_RELEASE_DIR
  ? path.resolve(ROOT, process.env.MY_IPTV_RELEASE_DIR)
  : path.join(ROOT, 'release')
const APP_NAME = 'My IPTV'
const APP_FILES = ['main.js', 'preload.js', 'index.html', 'style.css', 'app.js', 'db.js', 'channels.json', 'package.json']
const APP_DIRS = [
  { src: 'assets', dst: 'assets' },
  { src: 'lib', dst: 'lib' },
  { src: path.join('node_modules', 'better-sqlite3'), dst: path.join('node_modules', 'better-sqlite3') },
  { src: path.join('node_modules', 'bindings'), dst: path.join('node_modules', 'bindings') },
  { src: path.join('node_modules', 'file-uri-to-path'), dst: path.join('node_modules', 'file-uri-to-path') },
]
const PRUNE_APP_PATHS = ['channels.m3u']

const platform = process.platform

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

function rmrfIfPossible(dir) {
  try {
    rmrf(dir)
  } catch (e) {
    if (e.code === 'EPERM') {
      console.warn(`Cannot clean ${dir}; existing files will be overwritten where possible.`)
      return
    }
    throw e
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

function replaceExecutable(src, dst) {
  try {
    rmrf(dst)
    fs.copyFileSync(src, dst)
  } catch (e) {
    if (e.code === 'EPERM' && fs.existsSync(dst)) {
      console.warn(`Cannot replace ${dst}; keeping existing executable. Close the app before rebuilding to refresh it.`)
    } else {
      throw e
    }
  }
}

function copyElectronDist(appDir, executableName) {
  fs.mkdirSync(appDir, { recursive: true })
  rmrfIfPossible(path.join(appDir, executableName))

  for (const entry of fs.readdirSync(ELECTRON_DIST, { withFileTypes: true })) {
    if (entry.name === executableName) continue
    cp(path.join(ELECTRON_DIST, entry.name), path.join(appDir, entry.name))
  }
}

function pruneAppResources(appResources) {
  for (const p of PRUNE_APP_PATHS) {
    rmrfIfPossible(path.join(appResources, p))
  }
}

function pruneRuntimeDependencies(appResources) {
  const sqliteDir = path.join(appResources, 'node_modules', 'better-sqlite3')
  for (const p of ['deps', 'src', 'binding.gyp', 'README.md']) {
    rmrfIfPossible(path.join(sqliteDir, p))
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
  pruneRuntimeDependencies(appResources)

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

  copyElectronDist(appDir, 'electron.exe')
  replaceExecutable(path.join(ELECTRON_DIST, 'electron.exe'), path.join(appDir, `${APP_NAME}.exe`))
  rmrfIfPossible(path.join(resourcesDir, 'default_app.asar'))
  rmrfIfPossible(appResources)
  fs.mkdirSync(appResources, { recursive: true })
  pruneAppResources(appResources)

  for (const f of APP_FILES) {
    cp(path.join(ROOT, f), path.join(appResources, f))
  }
  for (const d of APP_DIRS) {
    cp(path.join(ROOT, d.src), path.join(appResources, d.dst))
  }
  pruneRuntimeDependencies(appResources)

  const zipName = `${APP_NAME}-1.0.0-win-x64.zip`
  buildZip(appDir, path.join(RELEASE, zipName))
  console.log(`Packaged: ${path.join(RELEASE, zipName)}`)
}

function buildLinux() {
  const appDir = path.join(RELEASE, APP_NAME)
  const resourcesDir = path.join(appDir, 'resources')
  const appResources = path.join(resourcesDir, 'app')

  rmrf(appDir)
  copyElectronDist(appDir, 'electron')
  replaceExecutable(path.join(ELECTRON_DIST, 'electron'), path.join(appDir, APP_NAME))
  rmrfIfPossible(path.join(resourcesDir, 'default_app.asar'))
  rmrfIfPossible(appResources)
  fs.mkdirSync(appResources, { recursive: true })
  pruneAppResources(appResources)

  for (const f of APP_FILES) {
    cp(path.join(ROOT, f), path.join(appResources, f))
  }
  for (const d of APP_DIRS) {
    cp(path.join(ROOT, d.src), path.join(appResources, d.dst))
  }
  pruneRuntimeDependencies(appResources)

  const archiveName = `${APP_NAME}-1.0.0-linux-x64.tar.gz`
  const archivePath = path.join(RELEASE, archiveName)
  execSync(`tar -czf "${archivePath}" -C "${RELEASE}" "${APP_NAME}"`)
  console.log(`Packaged: ${archivePath}`)
}

function buildZip(srcDir, dstPath) {
  if (process.platform === 'darwin') {
    execSync(`ditto -c -k --sequesterRsrc --keepParent "${srcDir}" "${dstPath}"`)
  } else if (process.platform === 'win32') {
    const releaseDir = path.dirname(srcDir)
    const appDirName = path.basename(srcDir)
    try {
      rmrfIfPossible(dstPath)
      execSync(`tar -a -cf "${dstPath}" -C "${releaseDir}" "${appDirName}"`, { stdio: 'inherit' })
    } catch {
      console.warn('tar ZIP failed, trying Compress-Archive')
      execSync(`powershell -NoProfile -Command "Compress-Archive -LiteralPath '${srcDir}' -DestinationPath '${dstPath}' -Force"`, { stdio: 'inherit' })
    }
  } else {
    // fallback: use zip command if available
    try {
      execSync(`zip -r "${dstPath}" "${path.basename(srcDir)}"`, { cwd: path.dirname(srcDir) })
    } catch {
      throw new Error('zip command not available')
    }
  }
  if (!fs.existsSync(dstPath) || fs.statSync(dstPath).size === 0) {
    throw new Error(`ZIP was not created: ${dstPath}`)
  }
}

function main() {
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
