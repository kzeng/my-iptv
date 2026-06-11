# My IPTV

一个轻量、快速、面向桌面端的 IPTV 播放器。My IPTV 基于 Electron 和 HLS.js 构建，内置播放代理、频道数据库、Logo 缓存、收藏夹、播放历史和性能调优能力，适合日常观看、频道源测试和个人 IPTV 播放列表管理。

## 下载

- 最新版本：https://github.com/kzeng/my-iptv/releases
- v1.0.0：https://github.com/kzeng/my-iptv/releases/tag/v1.0.0

下载对应平台的发布包后，解压并运行 `My IPTV.exe` 即可。

## 功能亮点

- **国内可用源优先**  
  默认内置 `https://live.zbds.top/tv/iptv4.m3u`，并保留 `iptv-org` 作为补充源。

- **SQLite 频道库**  
  频道列表、播放列表源、收藏、播放历史、健康状态和缓存索引统一由 SQLite 管理。启动时优先读取本地数据库，弱网或离线时也能继续使用上一次成功缓存的频道。

- **手动更新频道数据库**  
  刷新按钮会拉取播放列表、解析 M3U 并写入 SQLite，而不是只做临时加载。网络失败时不会清空已有频道。

- **Logo 磁盘缓存**  
  频道 Logo 通过本地缓存接口加载，图片文件存放在磁盘，SQLite 只保存索引，避免大量远程图片请求拖慢启动和滚动。

- **稳定的 HLS 播放体验**  
  内置本地 HTTP 代理，自动重写 M3U8 中的相对路径，处理 CORS、重定向、User-Agent 和 Referer，提升各类直播源的兼容性。

- **实用播放工具**  
  支持搜索、分组筛选、收藏、恢复上次播放频道、截图、录制 WebM、错误重试和 HLS 参数调优。

- **更轻的发布包**  
  发布包只带运行所需文件，排除测试、文档、未使用 npm 包和重复的 `electron.exe`，减少体积和启动 I/O。

## 适合谁用

- 想在 Windows 桌面上快速播放 IPTV 直播源的用户。
- 需要管理大频道列表、收藏和播放历史的用户。
- 需要测试 M3U/HLS 源可用性、User-Agent、Referer 和播放兼容性的用户。
- 希望有本地缓存能力，减少 Logo 请求和频道加载等待的人。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建会自动执行 native 依赖重编译、频道 JSON 生成和平台打包。Windows 发布目录默认为 `release/`，也可以通过 `MY_IPTV_RELEASE_DIR` 指定输出目录。

## 技术栈

- Electron
- HLS.js
- SQLite / better-sqlite3
- Node.js 本地 HTTP 代理

## 开发记录

详细实现记录、问题修复、后续计划见 [dev-log.md](./dev-log.md)。
