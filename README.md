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
- **跨平台打包** — `npm run build` 自动检测当前平台：
  - macOS → `.app` 捆绑包 + ZIP
  - Windows → `.exe` + 依赖 DLL + ZIP
  - Linux → ELF 二进制 + tar.gz
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
| 打包后 app 闪退（icudtl.dat） | `fs.cpSync` 将 Framework 内相对符号链接转成绝对路径 | `fs.lstatSync` + 递归逐条目拷贝，保留相对链接 |

### 已完成的优化

- **HLS.js 缓冲** — `maxBufferLength: 30→90`、`maxMaxBufferLength: 300`、`maxBufferSize: 200MB`、`backBufferLength: 30`
- **Web Worker** — 启用，TS 解析任务 offload 到后台线程，主线程不阻塞
- **HTTP keep-alive** — 代理使用 `Agent({ keepAlive: true, maxSockets: 32 })`，复用 TCP 连接，减少延迟
- **ABR 调优** — `startLevel: -1` 自动选码率、`capLevelToPlayerSize` 限制分辨率、`startFragPrefetch` 预下载下一片段
- **片段加载** — `fragLoadingMaxRetry: 6`、`fragLoadingTimeOut: 20s`
- **M3U 预编译** — ~10018 频道从 M3U 转 JSON，启动时间从数秒降至毫秒级
- **错误处理** — 错误弹窗可关闭、含 Retry 按钮、自动忽略旧频道的残余错误
- **参数可调** — 所有 HLS.js 优化参数通过 UI 面板可实时调整，无需修改代码
- **代理旁路** — TS/m4s/aac 片段直连 CDN，仅 M3U8 过代理重写 URL，减少转发延迟
- **跨平台打包脚本** — 自动检测平台，macOS/Win/Linux 各自打包为原生格式，保留 Framework 符号链接

### 后续可做的优化


- [ ] 频道分组多选过滤
- [ ] EPG 电子节目指南集成
- [ ] 键盘快捷键（方向键切换频道、空格暂停等）
- [ ] 深色/浅色主题切换
- [ ] 频道组自定义 User-Agent
- [ ] 频道列表定时自动刷新
- [ ] 播放历史记录
- [ ] 自定义频道源 URL 导入

### 头脑风暴建议

#### 创新功能点
- [ ] **频道健康度雷达** — 后台定时探测频道可用性、首帧耗时、失败率和最近成功播放时间，在列表中标记稳定/较慢/不可用，减少用户反复试错。
- [ ] **智能频道去重与别名合并** — 根据频道名、logo、分组和流 URL 指纹合并重复频道，为 CCTV/卫视/地方台等常见别名建立统一入口。
- [ ] **EPG + 回看入口** — 接入 XMLTV/EPG 数据后，在播放区显示当前/下一节目；如果源支持 timeshift，可进一步做节目单点击回看。
- [ ] **多源优先级与自动切换** — 同一个频道可绑定多个候选流，当前源失败或卡顿时自动切换到备用源，并记录用户偏好的最佳线路。
- [ ] **家庭模式/儿童模式** — 用频道分组白名单、隐藏成人或不稳定频道、锁定设置面板等方式支持客厅场景。
- [ ] **局域网投屏/遥控接口** — 提供本地 HTTP/WebSocket 控制接口，手机浏览器可作为遥控器切台、收藏、暂停和调音量。

#### 性能
- [ ] **频道列表虚拟滚动** — 当频道数量上万时只渲染可视区域，降低 DOM 节点数量，提升搜索、分组切换和滚动流畅度。
- [ ] **频道索引预计算** — 构建 `channels.json` 时同时生成小写名称、分组数组、去重 key 和排序 key，减少启动后的重复字符串处理。
- [ ] **代理缓存与条件请求** — 对 M3U8/EPG/频道源增加短 TTL 缓存和 ETag/Last-Modified 支持，减少重复网络请求。
- [ ] **播放质量遥测** — 记录缓冲次数、平均下载耗时、错误类型、当前码率等本地指标，为自动调参和频道健康度提供依据。
- [ ] **分级加载频道资源** — 首屏先加载频道名和 URL，logo 懒加载并设置失败缓存，避免大量失效 logo 拖慢列表。
- [ ] **打包依赖瘦身** — 只带运行所需文件，排除测试、文档和未使用的 npm 包，降低 release 体积和启动 I/O。

#### 用户体验
- [ ] **命令面板/快速切台** — 类似 Spotlight 的搜索框，支持输入频道名、分组、收藏状态并直接回车播放。
- [ ] **频道详情抽屉** — 展示 URL、User-Agent、Referer、分辨率、码率、最近错误、测速结果，并提供复制和诊断按钮。
- [ ] **首次启动向导** — 引导用户选择内置源、导入本地 M3U、输入远程 URL，并解释收藏和播放失败诊断。
- [ ] **可恢复错误提示** — 播放失败时给出“重试/换备用源/复制诊断信息/标记不可用”等操作，而不仅是错误文本。
- [ ] **快捷键与遥控友好焦点** — 支持方向键切台、Enter 播放、Space 暂停、F 全屏、数字键跳转，并确保焦点状态清晰。
- [ ] **播放状态记忆增强** — 记住音量、静音、全屏、上次分组/搜索条件和最近频道，减少重复配置。
