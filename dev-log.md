# 开发日志

## 当前版本

- 标签：`v1.0.0`
- 发布地址：https://github.com/kzeng/my-iptv/releases/tag/v1.0.0
- 最新发布页：https://github.com/kzeng/my-iptv/releases

## 已完成能力

### 播放与代理

- 使用 HLS.js 播放 `.m3u8` 直播流，支持 ABR 自动码率选择。
- 内置本地 HTTP 代理，端口 `12999`。
- 代理会重写 M3U8 中的相对 URL，补齐为绝对 URL。
- 支持 3xx 重定向，最多 5 跳。
- 支持频道级 User-Agent 和 Referer。
- TS/m4s/aac 等媒体片段尽量直连 CDN，M3U8 通过代理重写，减少转发延迟。

### 频道与播放列表

- 使用 SQLite 管理播放列表源、频道元数据、收藏、播放历史、健康状态和缓存索引。
- 默认播放列表源：
  - `https://live.zbds.top/tv/iptv4.m3u`
  - `https://iptv-org.github.io/iptv/index.m3u`
- 启动时优先读取 SQLite 中的频道缓存。
- SQLite 为空时会自动刷新一次播放列表并写入数据库。
- 刷新按钮保留为手动更新入口：拉取播放列表、解析 M3U、upsert 到 SQLite、再刷新 UI。
- 网络刷新失败时保留已有频道，不清空本地数据库。

### Logo 缓存

- Logo 图片不存入 SQLite BLOB。
- SQLite 只保存 Logo URL、缓存 key、文件路径、内容类型、大小和访问时间。
- 图片文件存放在用户数据目录下的 `logo-cache/`。
- Renderer 使用本地 `/logo?url=...` 接口加载图片。
- 主进程先查缓存，命中则直接返回本地文件；未命中时下载、保存文件并更新 SQLite。

### 用户体验

- 支持频道搜索、分组筛选、收藏过滤。
- 支持恢复上次播放频道。
- 支持截图保存为 PNG。
- 支持 WebM 录像。
- 支持 HLS 参数面板，可调整缓冲、Worker、初始码率、重试次数和超时等参数。
- 播放错误提供可关闭提示和 Retry 操作。
- 新增应用 Logo 和 About 信息。
- 隐藏默认菜单栏，界面更接近独立播放器。

### 打包与发布

- 自定义打包脚本，按当前平台生成发布目录。
- Windows 发布包只保留 `My IPTV.exe`，剔除重复的 `electron.exe`。
- 仅打包运行所需依赖，避免携带完整 `node_modules`。
- `better-sqlite3` 是 native 模块，构建前通过 `electron-rebuild` 重编译到 Electron ABI。
- `release/`、`release-slim/`、`channels.json`、`node_modules/` 均作为构建产物忽略。

## SQLite 设计记录

### 目标

用 SQLite 管理频道列表和播放列表，让应用启动更快、弱网更稳定，并为收藏、历史、健康状态和缓存索引提供统一数据层。

### 设计决策

- SQLite 负责结构化数据和查询。
- Logo 图片走磁盘文件缓存，不直接塞进 SQLite BLOB。
- SQLite 访问集中在 Electron 主进程。
- Renderer 只通过 IPC 请求频道、刷新、收藏、播放历史和健康状态更新。

### 主要表

- `playlist_sources`：播放列表源、启用状态、优先级、最后刷新时间、状态。
- `channels`：频道名称、播放 URL、Logo URL、分组、User-Agent、Referer、来源和启用状态。
- `favorites`：收藏频道。
- `play_history`：播放历史。
- `channel_health`：播放成功、失败次数、最近错误。
- `logo_cache`：Logo URL、缓存 key、文件路径、内容类型、大小和访问时间。

### Logo 缓存行为

- 先渲染频道列表，Logo 懒加载。
- 通过本地 `/logo` 接口统一处理图片。
- 命中缓存时返回本地文件。
- 未命中时下载并写入磁盘。
- 下载失败时返回空响应，让前端隐藏图片。
- 后续可继续增加失败负缓存、TTL 和容量清理策略。

## 问题与修复记录

| 问题 | 原因 | 处理 |
| --- | --- | --- |
| HLS 播放黑屏 | M3U8 中 TS 片段路径是相对路径 | 本地代理重写 M3U8，补齐绝对 URL |
| CORS 请求失败 | 视频 CDN 未设置跨域头 | 注入 CORS 响应头，并将 M3U8 请求重定向到本地代理 |
| 切换频道出现 `play() interrupted` | 旧频道的 `play()` Promise 在新频道加载后拒绝 | 判断 URL 是否仍是当前频道，旧错误静默忽略 |
| 错误弹窗无法关闭 | UI 没有关闭机制 | 添加关闭按钮和 Retry |
| 播放卡顿 | 缓冲偏小，Worker 未启用 | 增大缓冲、启用 Worker、开启 HTTP keep-alive、调整 ABR |
| `levelParsingError` | 固定 `startLevel: 3`，但部分源码率层数不足 | 改为 `startLevel: -1`，由 HLS.js 自动选择 |
| 频道列表启动为空 | `channels.json` 是构建产物，未生成时不可用 | 构建时自动执行 `build:m3u` |
| 上次播放频道未记住 | 缺少持久化 | 通过 IPC 保存和恢复 `last-channel.json` |
| 打包后 `icudtl.dat` 报错 | Electron dist 文件复制不完整或符号链接处理不当 | 使用自定义复制逻辑保留必要结构 |
| 发布目录重复 `electron.exe` | 复制完整 Electron dist 后又复制为应用 exe | 打包时跳过原始 `electron.exe`，只保留 `My IPTV.exe` |
| `better-sqlite3` ABI 不匹配 | native 模块按本机 Node ABI 编译，Electron 需要不同 ABI | 使用 `@electron/rebuild` 在打包前重编译 |
| ZIP 阶段偶发文件锁错误 | Windows 进程或 Shell 占用发布目录文件 | 构建主体保留，ZIP 失败降级为警告 |

## 已完成优化

- HLS 缓冲参数：`maxBufferLength` 提升到 90 秒，`maxMaxBufferLength` 为 300 秒。
- `maxBufferSize` 提升到 200MB。
- 开启 Web Worker，降低主线程压力。
- HTTP keep-alive 复用连接。
- `fragLoadingMaxRetry` 设置为 6，`fragLoadingTimeOut` 设置为 20 秒。
- 手动刷新频道信息到 SQLite。
- Logo 文件缓存，减少重复远程图片请求。
- 运行依赖瘦身，只携带必要 native 模块和运行文件。

## 后续规划

### 功能

- [ ] 播放列表源管理 UI：新增、删除、启用、禁用、排序。
- [ ] 本地 M3U 导入。
- [ ] EPG 电子节目指南。
- [ ] 多源去重和同名频道聚合。
- [ ] 同频道多线路自动切换。
- [ ] 最近播放列表 UI。
- [ ] 频道详情抽屉，显示 URL、UA、Referer、健康状态和最近错误。

### 性能

- [ ] 频道列表虚拟滚动，减少上万频道时的 DOM 压力。
- [ ] Logo 缓存容量上限和定期清理。
- [ ] Logo 失败负缓存，避免失效 URL 反复请求。
- [ ] 播放列表 ETag / Last-Modified 条件请求。
- [ ] 频道搜索索引预计算。

### 用户体验

- [ ] 快捷键：方向键切台、Enter 播放、Space 暂停、F 全屏。
- [ ] 命令面板或快速切台。
- [ ] 首次启动向导。
- [ ] 记住音量、静音、上次筛选分组和搜索条件。
- [ ] 深色/浅色主题。

## 构建命令

```bash
npm install
npm run build
```

`npm run build` 会依次执行：

1. `electron-rebuild -f -w better-sqlite3`
2. `node scripts/parse-m3u.js`
3. `node scripts/package.js`

Windows 下如遇发布目录文件被锁定，需要关闭正在运行的 `My IPTV.exe`，并避免 PowerShell 或 Explorer 当前目录停留在 `release/` 或 `release-slim/` 内。



1. 频道列表虚拟滚动
现在已经有 12350 个频道，全量 DOM 渲染会影响加载、搜索、切换收藏和滚动流畅度。优先做固定行高虚拟列表，只渲染可视区域附近几十个频道。

2. 播放源筛选
增加 全部 / ZBDS IPTV / IPTV Org 下拉框。这样你可以直接只看 iptv-org，不用靠搜索猜频道名。

3. 搜索防抖
搜索框输入加 150ms 左右 debounce，避免每按一个字符就对 1.2 万条频道执行过滤、排序、重绘。

4. 数据库返回 source 信息
当前前端频道对象没有带播放源名称。需要在 db.js listChannels() 里 join playlist_sources，返回 sourceId/sourceName/sourceUrl，前端才能做播放源筛选。

5. 刷新状态可视化
在设置或关于页显示每个源的刷新状态：上次刷新时间、成功/失败、导入数量。这样能直接判断 iptv-org 是网络失败还是已成功加载。

6. Logo 加载节流
虚拟滚动后自然会减少同时出现的 logo 图片；再进一步可以给 /logo 请求加简单并发限制，避免快速滚动时触发太多图片请求。

先做 1 + 2 + 3 + 4，这四项能明显改善 12350 频道下的体验。5 + 6 可以作为第二阶段。
