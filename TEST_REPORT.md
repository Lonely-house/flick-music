# Flick Music V2 测试报告（历史记录，非 V2.1 验收）

验证日期：2026-10-08。代码基线：用户提供的 Flick_Music_MVP.zip；需求依据：本次提供的 Flick Music V2 Prompt。

## 已实际执行

- npm install：成功，最终锁定 better-sqlite3 12.11.1；解压副本中的普通 npm install 也执行成功，锁文件随包交付。
- npm test：Node test runner 60 项通过、0 项失败（计数含 3 个父级集成测试；非 60 个独立手机场景）。
- npm run test:browser：Chromium 141.0.7390.37，26 个浏览器场景全部通过，页面脚本异常 0 个。使用实际合成 MP3 和 WAV。
- 实际 npm start：成功；监听 0.0.0.0；健康检查、页面、全部脚本/CSS/Socket.IO 资源、会话和私有曲库接口有效，SQLite 自动初始化。
- Python 独立复算：手势距离/方向/时间边界、每根手指纵向限制、合法 seek clamp 和 Range 长度通过。
- 解压新包后的 npm ci：成功安装 137 个依赖；npm test：60 项通过、0 失败；实际 npm start 再次通过健康检查、全部前端路径、私有 API 和数据库初始化。

## Node / HTTP / Socket.IO / SQLite 覆盖

- 保留 V1 决策复现 fixture：角色占用导致 Socket 已连接但 join 失败；未 joined 时仍显示本地 Audio receiver ready。开发前还对原 V1 服务进行了真实竞争角色 Socket 复现。
- A/B/C 各自稳定的服务端 Cookie 身份；不同设备并行注册；客户端伪造 deviceId 不改变授权身份。
- 定向连接请求不通知 C；接受前未配对；拒绝、过期、重复请求/接受、互相请求、多邀请冲突、配对繁忙、主动断开。
- 私人曲库隔离；同名不同内容；重复内容去重；修改昵称；配对不开放对方曲库。
- 后台授权读取/删除/metadata；HTTP 401/403/404；Origin 和 CSRF；非法字节长度；猜测文件 ID、路径遍历、废弃公共上传路径。
- 格式头/扩展名/大小、假 MP3、空文件、临时文件清理、通用 MIME 的合法音频、中文文件名。
- Range 有界/开放/后缀/超长截断；If-Range；HEAD；206、Content-Range、Content-Length；非法 Range 的 416。
- 双向播放/非播放交付；后台 transferId 和目标权限；幂等键重试、旧/重复/越权 ACK；不接受任意 audioUrl。
- 文件交付成功永不直接暂停 A；播放成功 ACK 才暂停匹配的原播放器；not-ready/busy/blocked/timeout 仍保存文件并保持 A 播放。
- 重复触发、单设备互斥、播放 generation 改变、超时、断线、晚回调。
- metadata 等待、NotAllowedError、音频缺失、取消和末尾有限 seek。
- 单曲/原子批量删除；混入他人 ID 整批回滚；重复 ID 去重；活动传输/流引用保护；最后引用回收；GC 日记重试和孤儿清理。
- 删除源记录之后仍能合法交付；接收记录和授权 URL 独立于源曲库记录。
- 多 Socket 最新标签页控制，旧 Socket 关闭不清除新页；Socket reconnect 重注册/验证；持续离线解除；服务器重启保留身份/曲库，旧配对与未完成传输失效。
- schema 升级保留曲库；管理脚本 inspection 不输出凭证；SQLite backup 可打开且外键一致；手动认领旧音频去重且保留源文件。

## 真实浏览器测试边界

使用三个独立 Playwright BrowserContext，390×844 手机尺寸、hasTouch，以及 1180 px 桌面布局。HTTP、Cookie、Socket.IO、SQL 持久化和 HTML5 Audio 播放是真实运行；测试使用合成 MP3/WAV，未使用 autoplay-policy 绕过参数。

单指纵向滚动用 Chromium CDP Input 触摸输入验证；双指卡片事件为 DOM TouchEvent 模拟；自动播放拒绝为 play() 注入 NotAllowedError；丢 ACK 为测试拦截该 Socket 事件。它们验证失败分支，不代表测试了所有手机系统策略。

本次没有真实 iPhone Safari、Android Chrome 两台物理手机，也没有 Safari/WebKit 验收。没有测量保证 60fps、无缝采样同步、锁屏/后台策略或真实 DeviceMotion 精度。

## 已修复的测试发现

- 新包解压后的 npm ci 暴露 better-sqlite3 13.0.3 的隐式 node-gyp 路径和当前环境 tar/fchown 失败。锁定预编译安装已验证的 12.11.1，再做完整新包安装/测试/启动；不跳过必需验证。

- 中文 multipart 文件名乱码：浏览器 UTF-8 文件名与 Busboy 默认 Latin-1 解码不一致；兼容解码修正，并加 HTTP/浏览器回归。
- 向右飞出卡片扩大移动页面宽度并造成点击坐标错位：根部/外壳限制横向溢出；右划后页面宽度与点击均重新验证。
- 正常交付完成被误当接收取消；第三指取消后无法再次起手；GC 日记再上传不可播放；旧接收任务覆盖新提示：分别修正后重新运行相应核心/集成/浏览器测试。
- 末尾测试会自然结束；其后的 ACK 丢失用例显式回到歌曲中段，避免把自然结束误判为转移错误暂停。

## 已知边界和人工手机检查

1. 在同 Wi-Fi 的真实 iPhone Safari / Android Chrome 打开相同 LAN 地址：注册、定向配对、允许音频、MP3 双向接力。
2. 真实双指左右滑、按下顺序、快速抬一指/两指、第三指、浏览器 touchcancel；单指滚动、按钮点击、屏幕缩放和浏览器系统手势。
3. iOS 点击初始化后切换新 src 的 autoplay 策略：若拒绝，应保存歌曲、显示手动播放提示且 A 继续。
4. 开关 Wi-Fi、持续离线、浏览器后台/锁屏/前台恢复、真实高延迟/丢包。
5. 不同编码 MP3/M4A/AAC/OGG/FLAC/WebM 的实际支持。头部校验不是完整解码；浏览器可能拒绝损坏文件。
6. DeviceMotion 的 HTTPS/证书信任/permission click 与方向。实验模块不是 V2 必需验收项。
7. Windows/macOS 的驱动安装、音频文件回收和 LAN 防火墙，当前安装及运行实测环境为 Linux x64 / Node.js 24.19.0。

极端网络中断下 B 可能已播放而 ACK 丢失，A 优先继续；短暂双端重叠无法完全消除。时间同步为发送时快照，会有网络/加载偏差，歌曲接近结尾可自然很快结束。单进程局域网匿名 Demo，不宣称具备公网生产级身份与安全性。

## 浏览器场景清单

1. three isolated mobile browser sessions register with independent identity
2. multiple uploads retain independent personal lists; real HTML5 Audio plays
3. unpaired send rebounds without pausing or success animation
4. directed invitation needs consent; rejection leaves both unpaired; C sees no invitation
5. receiver not audio-ready still saves the file; sender keeps playing
6. Enable Audio primes real receiver media without confusing pairing state
7. left swipe follows the card and hands off real playback only after ACK
8. right swipe shares a non-playing card without borrowing another track position
9. rightward reverse playback handoff uses the same protocol
10. receiver playing another song retains playback while importing selected song
11. injected NotAllowedError keeps received song and A playback; tap prompt is visible
12. duplicate transfer triggers produce exactly one network request
13. vertical/short/slow/stationary-finger/cancelled touches never send
14. native one-finger vertical scrolling is preserved on a song card
15. multi-selection disables gestures and sending; cancelled batch deletion changes nothing
16. deleting an unrelated song preserves current playback and the peer copy
17. Socket reconnect re-registers and verifies pairing before another send
18. near-end MP3 handoff clamps to a finite legal seek position
19. refresh retains Cookie identity and private songs; Audio Ready is newly initialized
20. a newer tab controls the same identity; closing the old tab cannot clear it
21. loss of playback ACK never pauses the sender and does not retract delivery
22. switching the sender song during metadata loading cancels stale handoff
23. deleting the current song stops its player; received copy survives and reloads
24. confirmed batch deletion removes selected received songs but keeps peer references
25. manual unpair and offline target leave the sender playing without a success stamp
26. mobile/desktop layout stays in bounds; Debug Log and reduced motion work
