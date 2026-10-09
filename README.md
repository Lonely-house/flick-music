# Flick Music Final — v3.0.0

**Final 版本重要变更：接收方未点击「启用音频接收」将无法收取任何歌曲；流动光圈改为纯白固定边框；音乐卡片改为极简，播放器新增唱片机高级模式；提示音/触控板/诊断都收进高级功能。完整使用说明请先阅读 [`README_FINAL.md`](README_FINAL.md)。**


一个在电脑运行、多台手机浏览器访问的音乐分享 Demo。每台设备都有独立曲库，同时可以上传、播放、接收和发送。先请求连接并由对方接受，再用双指左右划动歌曲卡片把指定歌曲分享给对方。**V2.2 在 V2.1 基础上把单指删除改为向左滑，新增 Mac / Windows 的触控板、鼠标拖动和键盘发送。** 四种可自定义共享事件提示音继续保留。

如果发送的是当前正在播放的歌曲，接收方会尝试从传来的时间点播放。**发送方只在收到有效的播放成功确认后暂停**。接收方尚未启用音频、正在播放另一首歌或被 autoplay 策略阻止时，歌曲仍会保存到其曲库，发送方继续播放。

技术栈：Node.js、Express、Socket.IO、Multer、better-sqlite3、HTML/CSS、Vanilla JavaScript、HTML5 Audio。没有前端框架或构建步骤。

## V2.3 新功能速览

**Mac / Windows 触控板方向：** 展开「触控板方向校准」，可使用系统推荐（Mac 默认反转、Windows 默认标准），或手动选择标准/反转。只调整 Shift + 双指触控板水平滑动，鼠标拖动、Shift+方向键不会反转；普通双指滑动仍然保留给浏览器导航。

**手机多文件 Motion Control：** 先完成设备配对，再在「高级功能 → Motion Control」点击 `Enable Motion Control`；允许传感器权限后，从「我的音乐」勾选想发送的多首音频，选中项显示旋转流光。手机横向加速度达到设定阈值时触发发送。传输**依次**完成，接收确认后才展示不规则甩出与归位动画并播放对应的“丢弃/收回”互补音效；保留原来自定义的传输成功提示音。

**在 Mac/Win 没有手机运动传感器时：** 点击「模拟甩动（Mac/Win）」，选歌后用模拟向左/向右甩按钮走相同的服务器文件传输流程。

**HTTPS 方案：** 可用 Cloudflare Quick Tunnel 临时 HTTPS，或使用新增 `FLICK_TLS_KEY`/`FLICK_TLS_CERT` 在局域网中启用受信任 HTTPS。完整说明及隐私注意事项请阅读 [`README_MOTION_HTTPS.md`](README_MOTION_HTTPS.md)。

**向后兼容：** V2.2 的单指左滑删除、双指左右滑单曲发送、私人曲库和多选批量删除均保留。数据库首次升级会自动增加 `transfers.interaction` 字段（schema v3）；**升级前备份 `storage/`，不要覆盖运行中的数据库。**

## 从零运行

安装 Node.js **22 或更高版本**，推荐当前受支持的 LTS。开发验证环境为 Node.js 24.19.0 / Linux x64。解压 `Flick_Music_V2_3.zip`，进入 `Flick_Music_V2_1` 文件夹，在终端运行：

```bash
npm install
npm start
```

也可以用 `npm ci` 按锁文件安装。浏览器自动化工具只用于测试，启动服务不需要下载浏览器。

电脑访问 <http://localhost:3000>。服务器监听 **0.0.0.0**，启动时会尽量打印局域网地址。关闭服务用 Ctrl+C。

修改端口：

```bash
# macOS / Linux
PORT=8080 npm start
```

```powershell
# Windows PowerShell
$env:PORT=8080
npm start
```

SQLite 驱动锁定 better-sqlite3 12.11.1，包含原生模块。若平台没有对应预编译文件，安装时可能需要 Python 和 C/C++ 编译工具（Windows：Visual Studio C++ Build Tools；macOS：Xcode Command Line Tools；Linux：Python 3、make、g++）。更换 Node 版本后重新运行 `npm ci`。

## 两台或三台手机现场演示

1. 电脑和手机 A、B（可选 C）连接**同一个 Wi-Fi**。不要使用开启了客户端隔离的访客网络。
2. 查电脑局域网 IPv4：Windows 运行 `ipconfig`，找 Wi-Fi 的“IPv4 地址”；macOS 在“系统设置 → 网络 → Wi-Fi → 详细信息 → TCP/IP”查看；Linux 运行 `ip -4 addr`，找 Wi-Fi 网卡地址。macOS 也可用 `ipconfig getifaddr en0`，网卡名因设备而异。
3. 每台手机打开 `http://电脑局域网IP:3000`，例如 `http://192.168.1.23:3000`。手机不能使用电脑的 `localhost`。所有手机必须使用**相同主机名/IP 和端口**。
4. 顶部应显示 `Socket online` 和 `Device registered`。点击“修改昵称”，把设备命名为“我的 iPhone”“小米手机”等，便于辨认。
5. B 在“在线设备”中点击 A 的“请求连接”。A 弹窗显示 B 的真实昵称，点击“接受”后双方才显示“已连接”。点击“拒绝”不会建立配对。C 只看见公开设备状态，不会收到 A/B 的私人邀请或歌曲。
6. B 点击“启用音频接收”，看到 `Audio ready`。A 如果希望反向接力，也点击该按钮。
7. A 点击“上传音乐”，选择一首或多首浏览器可解码的音频。点击某张歌曲卡片“播放”，用全局原生播放器调整进度。
8. 在这张卡片的**标题、图标等非按钮区域**双指快速向左或向右划。卡片会跟手移动；松手后发送给当前配对对象。两种方向分享到同一对象。
9. B 收到真实设备名和歌曲名的提示，自己的“我的音乐”出现该歌曲。若 B 成功开始播放，A 随后暂停。卡片飞出、出现 `Send Already！`，再恢复；分享不删除 A 的歌曲。
10. B 可以同样上传、播放并把歌曲反向分享给 A。桌面浏览器可以按住 Shift + 触控板左右滑动、鼠标拖动或使用每张卡片的“发送”按钮，走完全相同的协议。

如果 B 没有启用接收、自动播放失败或正在播放自己的另一首歌，B 仍得到歌曲，可点击卡片“播放”；A 明确显示“文件已发送；对方未自动播放，当前设备继续播放”。发送一首非当前播放的歌只交付文件，不会把另一首歌的进度套过来，也不会自动抢占 B 播放器。

配对是一对一的。可点击“断开连接”，再选择另一台设备。邀请默认 30 秒过期；对方最后一个标签页持续离线 5 秒会解除配对，短暂 Socket 重连会重新验证关系。服务器重启会使所有旧配对失效，曲库和设备身份保留。

## 曲库、播放和删除

- 曲库来自服务器 SQLite；上传多首不会覆盖旧歌曲。相同内容在同一设备曲库只保留一个条目；同名不同内容分别保留。
- 每页只有一个 `<audio>` 播放器。点卡片可切换、暂停或继续，原生控件可调进度。载入元数据后显示并缓存时长。
- **删除单首：** 在歌曲卡片非按钮区域用**一根手指向左滑**。卡片实时左移，达到阈值时背景出现“松手确认删除”，松手后弹出确认框；确认后仅删除本机曲库引用，取消时保留。歌曲卡片的独立删除按钮已移除。
- **批量删除仍保留：** “多选管理”中选中歌曲后点击“删除选中”，整批确认；多选模式禁用卡片发送和单指删除手势。
- 取消确认不发删除请求。删除当前歌曲会停止本机当前播放器；删除其他歌曲不停止播放。
- 只删除自己的曲库引用；对方收到的副本仍可独立播放。最后一个引用消失且没有合法传输或活动 HTTP 流后，物理文件才回收。
- 刷新保留身份、昵称、已上传和已收到的歌曲，不自动恢复播放或 Audio Ready。删除浏览器 Cookie / 站点数据、改用另一浏览器配置文件或不同地址会得到新身份。
- 同一浏览器的多个标签页共用 Cookie。**最新注册的标签页控制配对和传输**；旧页显示提示，关闭旧页不清除新连接。旧页仍可查看自己的曲库和手动播放。

## 手势规则

双指同向水平移动：平均至少 100 CSS px，每根手指至少 60 px；每根的纵向偏移最多 80 px；两指动作在 800 ms 内完成。一次成功识别后同一卡片冷却 1 秒，整个设备最多一个进行中的传输。

**单指删除：** 向左水平移动至少 105 CSS px、纵向偏移不超过 70 px、耗时不超过 1100 ms；达到阈值只表示删除候选，**松手才弹出确认框**，绝不未经确认就删除。短划、向右滑、斜向纵向滚动无效。

**双指发送：** 双指同向水平移动：平均至少 100 CSS px，每根手指至少 60 px；每根的纵向偏移最多 80 px；两指动作在 800 ms 内完成。单指起手随后在短时间内加入第二指，会自动转换为双指发送候选；不会误触发删除。手势结束后同一卡片有约 650 ms 冷却，整个设备最多一个进行中的传输。

按 touch identifier 跟踪两根手指。第三指、`touchcancel`、太短、太慢、纵向动作、单指固定、按钮上起手都会取消或忽略。单指正常纵向滚动保留；水平动作使用非 passive 监听和 `preventDefault()`。跟手通过 requestAnimationFrame + transform 完成，曲库刷新不会重建已有卡片；支持 `prefers-reduced-motion`。部分 iPhone 从屏幕最左边缘向右划可能被 Safari 系统后退手势抢占，建议从卡片中部起手。

## 自定义事件提示音（保留 V2.1 功能）（电脑主机集中配置）

页面左侧有 **「🔊 开启事件提示音」** 按钮。每台手机最好在配对前各点击一次（或者先点击页面里的普通按钮），使 Web Audio 音频上下文获得用户手势授权。**“启用音频接收”与“开启事件提示音”是不同功能**，都不意味着浏览器一定允许所有后续异步有声播放。若页面提示音被暂停，请点击开启提示音，必要时保持页面在前台。

展开页面下方 **「自定义事件提示音」** 设置。这里可以为四个场景分别上传 MP3、WAV 等音频，点击“试听”，或“恢复默认”。没有上传时系统会使用四段不同的内置短旋律。

| 事件 | 触发条件 | 自动发声设备 |
| --- | --- | --- |
| 音频 1 · 配对成功 | 服务器发出 `pair:established` 后 | A 和 B 双方 |
| 音频 2 · 启用音频接收 | 本机成功向服务器确认 `device:ready` 后 | 操作者本机 |
| 音频 3 · 上传文件 | 本机一批上传有至少一首成功后 | 上传方本机 |
| 音频 4 · 传输成功 | 接收方已经保存歌曲并发出 `transfer:delivered` 交付确认 | 发送方和接收方 |

**注意音频 4 表示文件已交付，不等同于播放接力成功。** 若 B 自动播放失败，歌曲仍已收到，音频 4 仍提示双方；A 继续播放原歌曲。播放器仍然使用原本的 HTML5 Audio，提示音走独立的 Web Audio 声道，不会修改主播放器的 src、currentTime 或暂停状态。

**提示音是服务器级共享配置。** 在 A 上传新提示音，电脑会存到 `storage/sound-effects/`，并通过 `sounds:updated` 通知 B/C 等在线设备刷新。**不需要在每台设备重复上传。** 更改会影响所有当前使用本主机的用户，所以这是适合可信局域网的演示设置，尚未实现管理员权限与配置版本冲突处理。每台设备的**提示音开关和音量**独立保存在本机浏览器，不会强迫其他设备静音或改变音量。

每个提示音最多 5 MiB；自定义提示音播放时截取前 12 秒。文件需要真实可解码的音频头和浏览器支持的编码，推荐 WAV 或 MP3。提示音不会进入私人歌曲曲库，不会占用曲库的删除/分享接口。更新提示音后重新启动服务器仍然保留；备份项目时请一起备份 `storage/sound-effects/`。

**批量上传歌曲**完成后只播放一次音频 3，避免快速连续重叠音效；对同一 transferId 的交付事件会去重，避免音频 4 重复播放。

## V2.2：Mac / Windows 桌面端发送方式

在桌面版 Chrome、Edge、Safari 等浏览器中，手指在触控板上左右滚动通常表现为 `wheel` 事件（横向 `deltaX`），**网页无法可靠读取手指数量、是否物理按压触控板**；系统级前进/后退也可能先于网页事件发生。因此**不要把“按下触控板同时双指划动”作为唯一手势**。

新版提供三种互为备份的操作，均针对鼠标指针所在的单张歌曲卡片：

1. **Mac / Windows 触控板：** 将鼠标指针移到歌曲卡片非按钮区域，按住 **Shift**，用两根手指在触控板上向左或向右滑动。释放触控板，停止横向滚动后，累计距离达到阈值才发送。普通的双指左右滚动不拦截，仍交给浏览器。
2. **鼠标：** 在歌曲卡片标题或图标区域按住左键，水平拖动一段距离并松开，可向左或向右发送。拖动太短、纵向拖动、松开太慢或中途取消都不会发送。
3. **键盘：** 使用 Tab 聚焦某张歌曲卡片（焦点高亮），按 `Shift + ←` 或 `Shift + →` 发送。也可使用原本卡片的“发送”按钮。

以上都是**发送**操作。单指左滑删除只用于真实触摸屏，桌面端删除可通过“多选管理 → 删除选中”。原有手机双指左右滑发送继续有效。

安全防误触：只有 Shift 修饰的横向 wheel 事件才会 `preventDefault()`；纵向滚动、无修饰的滑动、Ctrl 缩放及交互按钮上的滚动全部保留浏览器行为。不强制修改浏览器的系统前进/后退设置；部分 macOS/Safari 系统手势可能在网页收到事件之前拦截。此时推荐改用鼠标拖动或键盘快捷键。

### Motion Control 为什么手机提示 HTTPS，电脑没有？

手机通过 `http://192.168.x.x:3000` 访问的是普通局域网 HTTP，通常**不是安全上下文**。`DeviceMotionEvent` / `devicemotion` 在支持的浏览器上要求 HTTPS，并可能需要用户点击权限按钮。电脑上访问 `http://localhost:3000` 通常属于被浏览器信任的本机安全上下文，所以 HTTPS 提示可能不出现；**不等于台式电脑有运动传感器，也不代表 Motion Control 真正可用**。这不影响单指/双指触屏手势或桌面触控板操作。

如需测试手机“甩动”功能，建议给服务器配置浏览器信任的 HTTPS 地址（例如可信 HTTPS 隧道或有可信证书的局域网反向代理）；不要只把 http 改写成 https 而不配置 TLS。iPhone 的运动传感器权限必须在用户点击后请求，并以浏览器实际授权和能否收到运动数据为准。

## 数据位置及备份

```text
storage/
  music.db             SQLite：设备、会话哈希、曲库、请求、配对和传输
  music.db-wal/-shm     服务运行中可能存在的 WAL 文件
  audio-blobs/          SHA-256 + 验证后扩展名的集中音频仓库
  tmp/                  上传临时文件
  sound-effects/        共享提示音文件 + settings.json（V2.1 原有）
uploads/                空目录；仅提示 V1 旧文件来源，不公开访问
```

默认目录为项目内 `storage`，可用 `FLICK_STORAGE_DIR` 指向其他目录，例如 `FLICK_STORAGE_DIR=/absolute/music-data npm start`。管理脚本读取同一环境变量。

运行过服务并生成数据库后，在电脑查看归属关系：

```bash
npm run inspect
# 设备昵称 → deviceId → 歌曲名称 → libraryTrackId → blobId
```

只备份 SQLite 的一致性快照：

```bash
node scripts/admin.js backup /absolute/backup/music.db
```

**完整备份推荐停止服务后复制整个 `storage/` 目录**，必须同时包含数据库、`audio-blobs/` 和 `sound-effects/`。单独备份 music.db 不包含音频；服务运行时直接复制单一 DB 可能遗漏 WAL。数据库包含会话关联数据，备份应妥善保存，不公开发布。恢复时停服务，将整份备份放回，再启动；保留相同地址和浏览器 Cookie 才能继续使用原设备身份。

Schema 通过 `PRAGMA user_version` 事务化初始化/升级；早期 V2 数据库的可选时长列会自动补齐，过高版本会拒绝启动以防损坏。SQLite 外键、唯一约束和所有权校验在服务器执行。

## 从 V1 安全迁移

不要覆盖 V1 文件夹和旧 `uploads/`。在新文件夹解压 V2 并启动，先用浏览器创建目标设备身份，在 Debug Log 中查看本机完整 ID，或用 `npm run inspect` 确认。

V1 没有可靠的服务器曲库所有权，因此旧音频**不会自动分发给所有设备**。重新通过页面上传是最简单的认领方式；也可以先停止 V2 服务，在电脑手动指定归属：

```bash
node scripts/admin.js claim-legacy /absolute/path/to/v1/uploads TARGET_DEVICE_ID
```

脚本复制并校验旧文件，导入指定设备的私有曲库，按内容去重。不会移动、覆盖或删除源文件；不支持的文件跳过并提示。先备份原目录。V1 的 localStorage 角色、旧 deviceId 和单曲缓存被忽略/移除，它们不能当作 V2 身份凭证。

## 协议与权限

| 事件                                                           | 作用                                              |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `device:register` / `device:ready`                             | Cookie 身份注册 / 当前标签页音频准备声明          |
| `device:state` / `devices:updated`                             | 私有设备快照 / 必要的公开设备发现数据             |
| `pair:request` / `pair:incoming`                               | 请求配对 / 仅目标设备收到邀请                     |
| `pair:accept` / `pair:reject` / `pair:expired`                 | 接受、拒绝、超时                                  |
| `pair:established` / `pair:disconnected`                       | 服务器确认建立、解除配对                          |
| `transfer:request` / `transfer:incoming`                       | 指定自己的歌曲 / 仅对方控制标签页接收             |
| `transfer:stored` / `transfer:delivered`                       | 曲库保存确认 / 文件交付成功，**不暂停发送方**     |
| `transfer:playback` / `transfer:handoff`                       | 实际播放结果 / 只有有效播放成功才暂停原发送播放器 |
| `transfer:complete` / `transfer:failed` / `transfer:cancelled` | 非接力完成、失败、取消或超时                      |

自定义提示音（V2.1）：`GET /api/sounds`、`POST /api/sounds/:kind`（上传）、`DELETE /api/sounds/:kind`（恢复默认）、`GET /api/sounds/:kind/file`（经会话鉴权读取），以及广播 `sounds:updated`。四类可配置 kind 为 `paired`、`receiverReady`、`uploaded`、`delivered`。共享音效配置不提供单设备私人控制；变更接口要求当前设备会话及 CSRF，若用于公网应另外加入管理员身份验证。

HTTP：`GET /api/session` 创建/恢复设备，`POST /api/device` 改昵称，`GET/POST /api/tracks` 自己的曲库/上传，`DELETE /api/tracks/:id` 和 `POST /api/tracks/batch-delete` 删除，`GET/HEAD /api/tracks/:id/stream` 授权播放，`POST /api/tracks/:id/metadata` 缓存可选时长，`GET /api/transfers/:id` 仅参与者查状态。

匿名会话由服务器生成随机凭证，Cookie 为 HttpOnly / SameSite=Strict；数据库只保存会话凭证哈希。HTTP 写操作要求 CSRF token 和同源 Origin，Socket 握手共享同一 Cookie 并校验 Origin。客户端提供的 deviceId、receiverId、audioUrl 不作为媒体授权来源。配对仅允许主动分享指定歌曲，不能读取对方全曲库。公开发现列表不包含歌名、文件地址、会话凭证或配对详情。

媒体不是公共静态文件；服务器验证本机曲库归属后支持单段 Range（206 / Content-Range / Content-Length）、HEAD 和非法 Range 的 416。B 收到的是自己的授权 track URL，删除 A 的记录不会撤销 B 已保存的记录。文件交付完成前，新接收记录不可查询或播放。

上传默认单文件最多 **50 MiB**。支持扩展名 MP3、M4A/MP4 audio、AAC、WAV、OGG/OGA、WebM audio、FLAC，实际支持取决于浏览器。校验扩展名、文件大小和格式头，不信任客户端 MIME。头部校验不等同完整解码，损坏但有合法容器头的文件可能上传后播放失败，页面会提示。

transferId 由服务器生成，客户端 requestKey 仅作幂等键；绑定配对、双方身份、拥有者和当前接收 Socket。旧 ACK、越权 ACK、重复播放 ACK、过期配对不会暂停发送方。发送方切换/删除当前歌曲或标签页控制权改变时取消旧接力；暂停前还检查歌曲、src 和播放 generation。

普通 HTTP 局域网演示**不等于完整公网传输安全**：Cookie 和音频传输未加密，局域网流量可能被观察。公开部署应启用 HTTPS、设置 `SECURE_COOKIE=1` 并进一步完善认证、限流、配额和日志清理。使用 HTTPS 反向代理时保留正确 Host 与同源地址。不要在普通 HTTP 上设置 Secure Cookie，否则浏览器不会发送会话。

## 手机播放、Motion 与排错

| 现象                   | 排查/操作                                                                         |
| ---------------------- | --------------------------------------------------------------------------------- |
| 手机无法打开           | 同 Wi-Fi、电脑 IP 正确、防火墙允许端口、关闭 AP 客户端隔离；服务监听 0.0.0.0      |
| Socket online 但未注册 | 查看 Debug Log；刷新恢复 Cookie；不要用旧 V1 页面或缓存服务                       |
| Audio ready 但未配对   | 音频权限与配对独立，需要发请求并让对方接受                                        |
| 请求被拒绝/过期        | 对方确认前不会建立连接；等待失败提示后重新请求                                    |
| 另一标签页控制         | 在最新页操作，或刷新当前页使其重新注册；关闭旧页不会清除新页                      |
| 已发送但对方没自动播   | 对方点“启用音频接收”；若出现 Tap to allow playback，点收到歌曲的播放按钮          |
| 接收方在播另一首歌     | 保留当前播放，仅保存新歌；可自行切换                                              |
| 文件不存在/格式不可用  | 重新上传；先用普通 MP3/WAV，浏览器需支持编码；查看 Debug Log                      |
| Socket 断开            | 发送方继续播放；自动重连后重新注册、验证配对；持续离线或服务器重启需重新配对      |
| 刷新后曲库不同         | 检查相同 URL/端口、浏览器配置文件和 Cookie 是否被清除；切换地址会切换会话         |
| 数据库打不开           | Node 版本、storage 目录写权限、原生驱动安装；不要同时运行两个服务使用同一 storage |

iPhone Safari 和 Android Chrome 都应先用真实按钮点击初始化媒体。一次 Audio ready 只是本次尝试，不保证后续任意 src 能自动播放。每次接力都会等待 metadata、合法 seek，并检查 play() Promise 和播放器实际状态；reject 不返回成功。Safari 可能仍要求对收到歌曲再点一次播放，这时发送方继续播放。保持页面在前台、设备不要锁屏，后台媒体/Socket 行为需真机验证。

高级设置保留实验 Enable Motion Control。iOS 的 DeviceMotionEvent.requestPermission() 只在按钮 click handler 中调用。不安全地址若传感器不可用，显示 Motion control requires HTTPS on this browser.；测试通常需要设备信任的 HTTPS 证书。该实验只对当前选择的歌调用统一 transferMusic()，不影响双指卡片滑动，也不属于 V2 验收必需项。

## 自动化验证

V2.1 当前可重复运行的检查及环境限制见 `TEST_REPORT_V2_1.md`；原 `TEST_REPORT.md` 是 V2 的历史测试记录，不代表 V2.1 已在真机上完成验收。


```bash
npm test
# 旧版报错复现 + 手势/状态机 + 声音设置 + HTTP/Socket.IO/SQLite 集成与权限测试

npx playwright install chromium
npm run test:browser
# 独立三会话，真实页面与音频播放；触摸和 autoplay 拒绝部分为模拟
```

Linux 测试机器若缺浏览器系统依赖，可按 Playwright 的官方安装说明安装依赖。可通过 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定已安装 Chromium 路径。测试使用临时数据库/合成 WAV，不接触自己的 storage；浏览器报告和截图输出到 test-output/。

实际结果、测试边界和人工手机检查见 TEST_REPORT.md。旧 TEST_RESULTS.md 仅作为 docs/V1_TEST_RESULTS.md 的历史参考。

## 代码结构

```text
server.js                   启动、路由、Socket 事件编排
server/auth.js              匿名会话、CSRF、Socket Cookie
server/database.js          SQLite schema / migration
server/deviceManager.js     在线状态与多标签页控制权
server/pairingManager.js    定向邀请、确认、超时和断开
server/storageService.js    格式头、SHA-256、原子发布、引用回收
server/libraryService.js    私有曲库、事务删除、授权 Range
server/transferService.js   交付、播放确认、幂等、失效清理
public/app.js               独立状态、UI、HTTP/Socket 编排
public/player.js / media.js 单播放器、metadata、seek、play
public/devices.js           设备列表
public/library.js           keyed 卡片、多选、动画
public/gesture.js           双指左右划与跟手
public/transfer.js          发送状态机
public/motionGesture.js     实验传感器
scripts/admin.js            查看归属、备份、旧文件认领
tests/                    核心、历史回归、集成、浏览器测试
```

## 当前边界

局域网 Demo，单进程服务，不支持多个服务同时修改同一仓库。不传实时音频流，不做无缝采样级同步；接力采用发送时刻的时间戳，网络/加载延迟会带来偏差。极端丢包下接收方可能已开始播放但确认未送达，发送方优先继续播放；超时/取消会尽量停止仍在准备的接收，不能保证分布式环境完全没有短暂重叠。

暂未增加公网账号系统、云存储、DRM、第三方音乐平台或 WebRTC。生产改进可考虑更严格的全文件解码、容量配额、过期历史清理和 HTTPS 身份恢复。
# flick-music
