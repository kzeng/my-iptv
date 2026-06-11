# My IPTV

Electron IPTV 播放器，内置 HLS 流代理、收藏夹、分组过滤、可调性能参数面板。

---

## 功能特性

### 频道管理
- **M3U 加载** — 依次尝试 `channels.json`（预编译 JSON，秒开）、`channels.m3u`、远程 iptv-org 源
- **M3U 预编译** — `scripts/parse-m3u.js` 将 ~10018 个频道从 M3U 解析为 JSON，冷启动从数秒降至毫秒级
- **搜索** — 按频道名称实时过滤
- **分组过滤** — 从 M3U `group-title` 字段提取分组列表（支持 `;` 分隔的多分组），下拉菜单筛选
- **收藏夹** — "☆ Favorites" 切换按钮，只显示已收藏频道，收藏数据通过 IPC 持久化到磁盘

### 播放内核
- **HLS.js 播放器** — 支持 HLS 流（`.m3u8`），自动码率切换（ABR）
- **内置 HTTP 代理** — Node.js 代理服务器（端口 12999）：
  - 重写 M3U8 中相对 URL 为绝对 URL
  - 代理转发 TS/m4s/aac 视频片段，绕过 CORS 限制
  - 跟随 3xx 重定向（最多 5 跳）
  - 支持频道自定义 User-Agent / Referer
- **自动播放** — 启动后自动播放第一个频道，或恢复上次播放的频道
- **频道信息** — 底部信息栏显示当前频道分组、流 URL、User-Agent

### 工具
- **截图** — 📷 按钮将当前视频帧保存为 PNG
- **录像** — ⏺ 按钮录制 WebM 视频（含音频），再次点击停止并保存
- **参数面板** — ⚙ 按钮打开调优面板，可实时调整 HLS.js 参数（缓冲、Worker、初始码率等）
- **错误提示** — 播放错误时弹出红色信息条，带 × 关闭按钮和 Retry 重试

### 构建
- **手动打包** — `npm run build` 将应用打包为 macOS `.app`，同时生成 ZIP 压缩包
- `.gitignore` 排除 `release/`、`channels.json`、`node_modules/`

---

## 开发日志

### 问题与解决

| 问题 | 原因 | 解决 |
|------|------|------|
| HLS 播放黑屏 | M3U8 中 TS 片段路径为相对路径 | 代理服务器重写 M3U8，将相对 URL 补齐为绝对 URL |
| 跨域请求被拦截 | 视频 CDN 未设置 CORS 头 | `onHeadersReceived` 注入 CORS 头；`onBeforeRequest` 将媒体请求重定向到本地代理 |
| 打包脚本失败 `cp: no such file or directory` | `rm -rf release` 删除目录后 `cp` 目标不存在 | 添加 `mkdir -p release` |
| electron-builder / electron-packager 下载失败 | DNS 封锁 `release-assets.githubusercontent.com` | 改为手动打包：直接拷贝 `Electron.app` + 资源文件 |
| 切换频道时弹出 "play() interrupted" 错误 | `video.play()` Promise 在新频道加载后拒绝 | `.catch()` 中检查 `ch.url !== currentChannel?.url`，旧频道错误静默忽略 |
| 错误弹窗无法关闭 | 缺少关闭机制 | 添加 × 关闭按钮 + 点击弹窗关闭 |
| 播放途中卡顿（缓冲跟不上） | `maxBufferLength: 30` 缓存太小，Worker 未启用 | 增大缓冲至 90s，启用 Web Worker，添加 HTTP keep-alive，调优 ABR |
| `levelParsingError` | `startLevel: 3` 但某些频道只有 1 个码率 | 改为 `startLevel: -1`（HLS.js 自动选择） |
| Git 仓库体积臃肿（112MB） | `release/` 目录被提交 | 重新初始化仓库，添加 `.gitignore`，降至 924KB |
| 应用启动后频道列表为空 | `channels.json` 是构建产物，未自动生成 | `build:m3u` 脚本在构建时自动创建 |
| 上次播放的频道未记住 | 无持久化逻辑 | 通过 IPC 保存/恢复 `last-channel.json` |

### 已完成的优化

- **HLS.js 缓冲** — `maxBufferLength: 30→90`、`maxMaxBufferLength: 300`、`maxBufferSize: 200MB`、`backBufferLength: 30`
- **Web Worker** — 启用，TS 解析任务 offload 到后台线程，主线程不阻塞
- **HTTP keep-alive** — 代理使用 `Agent({ keepAlive: true, maxSockets: 32 })`，复用 TCP 连接，减少延迟
- **ABR 调优** — `startLevel: -1` 自动选码率、`capLevelToPlayerSize` 限制分辨率、`startFragPrefetch` 预下载下一片段
- **片段加载** — `fragLoadingMaxRetry: 6`、`fragLoadingTimeOut: 20s`
- **M3U 预编译** — ~10018 频道从 M3U 转 JSON，启动时间从数秒降至毫秒级
- **错误处理** — 错误弹窗可关闭、含 Retry 按钮、自动忽略旧频道的残余错误
- **参数可调** — 所有 HLS.js 优化参数通过 UI 面板可实时调整，无需修改代码

### 后续可做的优化

- [ ] 代理旁路：TS/m4s/aac 片段直连 CDN，不经过 Node 代理（降低延迟）
- [ ] 频道分组多选过滤
- [ ] EPG 电子节目指南集成
- [ ] 键盘快捷键（方向键切换频道、空格暂停等）
- [ ] 深色/浅色主题切换
- [ ] 频道组自定义 User-Agent
- [ ] 频道列表定时自动刷新
- [ ] Windows / Linux 打包支持
- [ ] 播放历史记录
- [ ] 自定义频道源 URL 导入
