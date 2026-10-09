# Flick Music Final · v3.0.0

## 接收权限安全修复

- 服务器不再信任 `device:register` 传入的 `audioReady` 参数。每个控制 Socket 在注册时重置为未开启接收状态。
- `transfer:request` 必须确认接收端**当前主 Socket**已通过 `device:ready` 明确启用；否则立即拒绝，不创建对方的私人曲库记录。
- `transfer:stored` 再次检验接收许可；重连后必须手动重新启用，禁止直接继承旧 Socket 的 Ready 状态。
- 已增加独立 Node 单元测试及更新网络集成测试的接收许可断言。

## 用户界面升级

- 音乐卡片缩减为音乐图标、单行文件名（鼠标悬停/键盘聚焦滚动）、图标播放/暂停、竖三点展开时长和格式。发送按钮隐藏；滑动与 Motion 发送保留。
- 修复 Motion 选中光圈越界：纯白静态卡片轮廓 + 非旋转的白色流动高光；正在发送的歌曲停止流光，然后在交付确认后甩出。
- 主界面折叠 Debug Log；四种自定义事件音效、触控板方向校准及 Motion Control 归入同一个「高级功能」模块。
- 播放器右上角切换极简/唱片机模式。唱片机包含物理感唱片/唱臂/奶龙圆形唱片标签、慢速旋转、歌名/艺术家、可拖动时间轴、上一首/下一首、播放/暂停。
- MP3 添加基础 ID3v2 歌曲名、艺术家读取模块；无法识别时保持诚实的未知艺术家回退。
- 复用同一个音频实例并持久化播放器模式，保留原多设备隐私权限和浏览器音频播放策略。

# Flick Music V2.3 更新说明

- Mac / Win 触控板 Shift+左右滚动增加用户可持久化的方向映射：Mac 默认反转，Win 默认标准，均可按实际自然滚动设置手动校准。
- 手机运动甩歌：设备方向坐标换算、连续高加速度采样防误触、左右方向过滤、灵敏度阈值、方向校准和权限/无数据反馈。
- Motion 模式可多选歌曲（曲库内独立勾选/卡片点击、全选/清空、选中动态流光），与单指删除/双指传输模式隔离。
- MotionBatch 顺序发送多首音频，服务器确认 B 曲库保存后才标记 A 的单首交付成功；失败歌曲保留可重试，原接力确认规则保持不变。
- 每首 Motion 文件随机角度和纵向偏移甩出，接收方从另一侧飞入回弹，配合 Web Audio “丢弃”和“收回”互补短音效；旧 4 种自定义音效继续保留。
- 数据库 schema 3：向原 transfers 表追加 interaction 字段，用于在 B 区分普通滑动和甩动接收动画；迁移保留原曲库。
- Node 服务器可选 TLS 模式，提供 Cloudflare Quick Tunnel / mkcert 本地 HTTPS 教程。
- 修复旧版 `public/library.js` 卡片移除时引用错误的 `detachTouch` 解绑 Bug。

# Flick Music V2.2 更新说明

## 新增与修复（基于 V2.1）

- 将**手机单指右滑删除**切换为**手机单指左滑删除**：`public/gesture.js` 的阈值方向、`public/library.js` 的跟手提示与 `public/styles.css` 的揭示区域同步反转。必须松手后弹出确认框，不会直接删除。
- 保留双指左右滑歌曲发送、多选批量删除、设备配对、私人曲库和共享事件提示音。
- 新增 `public/desktopGesture.js`：Mac/Windows 桌面浏览器支持 **Shift + 触控板水平滑动** 发送、**鼠标按住歌曲卡片左右拖动** 发送、**聚焦卡片后 Shift + 左右方向键** 发送。
- 新桌面手势只在歌曲卡片非按钮区域触发，禁用多选时操作，并保留普通浏览器左右滑导航；触控板按压状态/手指数无法通过标准 WheelEvent 可靠识别。
- `public/library.js` 自动为每张歌曲卡片连接并清理桌面与触摸手势事件；`public/index.html` 提供桌面说明。
- 更新核心测试、浏览器模拟回归场景及 README，并新增 `tests/desktop.test.js`。

## 升级兼容

可安全继承 V2.1 的 SQLite 数据库和音乐文件，无数据库迁移。**不要覆盖运行中的 `storage/`**：如需保留曲库，停止旧服务后把 V2.1 的 `storage/` 复制到 V2.2 项目目录（或用同一 `FLICK_STORAGE_DIR`）。完整备份后再升级。

# CHANGELOG

## 2.1.0 — 2026-10-08

基于用户上传的 `Flick_Music_V2.zip` 原代码升级，不影响设备配对与个人曲库所有权。

- 单首歌曲卡片**删除按钮移除**；单指向右滑动实时跟手，达到水平阈值显示可删除状态，松手打开独立确认对话框；未确认或取消不会调用删除 API。原多选批量删除保留。
- `gesture.js` 由仅双指手势扩展成单指/双指统一状态机，确保单指右滑不会发送，双指左右滑动不会删除；额外防护第三指、touchcancel、纵向滚动、误触与重复触发。
- 新增共享提示音系统 `server/soundService.js` / `public/soundEffects.js`。四个声音事件：配对成功（双方）、本机启用接收、本机上传成功、音乐文件交付成功（双方）。
- 提示音可通过网页上传、试听、恢复默认，默认内置四种音符提示，支持独立音量/静音和点击启用；主机端持久化并向在线设备广播更新。
- 提示音与主播放器完全分离，不修改音乐播放状态；标记配对 ID / 传输 ID，减少重复事件声音。提示音 4 在文件交付成功时播放，若自动播放接力被阻止仍遵循原 V2 不暂停发送端规则。
- HTTP 会话/CSRF 与上传格式检测，独立提示音存储目录，增加单元、服务接口和浏览器测试。
- V2.1 本次运行环境无网络安装 npm 完整依赖，未执行完整 Express + Socket.IO 多设备端到端验收；见 `TEST_REPORT_V2_1.md`。


## 2.0.0 — 2026-10-08

基于提供的 `Flick_Music_MVP.zip` 升级。原 ZIP、旧音频和有效媒体工具保留；这份包使用全新的运行时数据目录。

### 先复现、再修复 V1 连接问题

开发前用上传的原 V1 服务运行了竞争角色的 Socket 场景，复现“连接成功但 sender join 被占用拒绝”。另保留原代码决策的最小回归 fixture，用 `tests/legacy.test.js` 复现两类失败；旧测试源保存为历史参考，V2 语义测试重新编写并实际运行。

| V1 位置与原因                                                                                                | V2 修复                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `server.js / join-room` 为整个 demo-room 强制每种角色只允许一个 deviceId，旧 sender 或另一浏览器会占用角色   | 完全移除 Sender/Receiver 唯一性；所有设备注册同一功能界面，显式一对一配对                                                     |
| `app.js / join / setRole` 把 joined 与 Socket connected、角色和房间资格混用；Socket 已连接时 join 仍可能失败 | 独立 socketConnected、deviceRegistered、pairingStatus、audioReady、transferStatus；服务器快照权威                             |
| `app.js / enableAudio` 可在 joined 为 false 时完成本地 prime 并显示 ready，日志掩盖身份注册失败              | 初始化入口要求注册且为控制页；prime 后必须获得 device:ready 服务器 ACK；Audio Ready 与配对始终独立                            |
| 浏览器 localStorage 恢复旧角色/ID；服务端以客户端 ID 授权，同浏览器多标签页会替换/断开旧 Socket              | 服务器随机匿名会话 + HttpOnly Cookie，忽略旧 localStorage；多个 Socket 共用身份，最新注册页控制传输，旧 Socket 断开只移除自身 |
| 重连依赖旧角色/room 信息，服务器可能仍拒绝加入；io server disconnect 不一定自动重连                          | 每次 connect 重新注册 Cookie 身份并重新读取有效配对；身份、房间、控制权及过期关系由服务器验证                                 |

V1 的 Connect and join as Device A first、This role is already in use、join-room 与固定 demo-room 角色路由已退出运行时代码。它们只存在于明确标记的历史测试/报告中。

### 新增

- 每台设备可改昵称；三设备最小公共发现，私人设备房间只用于本设备事件。
- 定向配对请求、接受、拒绝、过期、重复接受、冲突邀请、断开及短暂重连处理；唯一 pair_members 约束保证一设备至多一个活跃对象。
- SQLite 曲库持久化、SHA-256 中央 Blob 去重、独立所有权、批量事务删除、HTTP 活动流与传输引用保护、回收日志和启动孤儿清理。
- Cookie/CSRF/Origin 校验与后台曲库所有权检查；废弃公开 /uploads，私有 GET/HEAD 音频流支持 Range/206/416。
- 双向指定歌曲交付；区分文件交付与播放接力，未启用/忙碌/autoplay 失败仍保存歌曲，只播放成功 ACK 暂停原播放器。
- 服务端 transferId、请求幂等键、指定接收 Socket、超时/重放防护、取消、播放器 generation 校验与旧异步回调隔离。
- 多曲上传、唯一全局播放器、单曲/确认批量删除、服务器曲库刷新和接收复用高亮。
- 每首歌曲卡片双指左/右划、跟手 RAF、取消回弹、交付确认后方向飞出、Send Already！、原卡片恢复、接收弹出以及 reduced-motion。
- 管理脚本查看归属、SQLite 快照备份、手动认领 V1 旧文件且保留源文件。
- schema version 迁移、中文 multipart 文件名 UTF-8 修正和回归测试。

### 重构与保留

- 重构 server.js、app.js、transfer.js、gesture.js、index.html 和 styles.css，按职责拆出 auth/device/pair/library/storage/transfer 服务。
- 保留 V1 media.js 的 metadata 等待、末尾 seek clamp、play Promise/超时/取消处理；新增 player.js 统一一个播放器。
- 保留独立 motionGesture.js，放入高级设置，只调用统一传输入口，仍要求安全上下文/用户权限。
- 取消原角色选择与独立 Gesture Area。旧角色缓存清除，不迁移其伪授权。
- 原 TEST_RESULTS.md 移至 docs/V1_TEST_RESULTS.md 并标明历史；当前测试结果以根目录 TEST_REPORT.md 为准。

### 验证中修复

- 格式合法且元数据载入后才能 seek，接近末尾会向内 clamp；play reject 不产生成功 ACK。
- 正常非播放交付/失败播放结果不误发接收取消事件；真正超时/断开才取消仍进行的接收。
- 第三触点取消后，全部手指抬起允许下一次手势，不永久阻塞。
- GC 失败日记中的 Blob 重上传可重新成为 ready；缺失文件重上传修复物理文件，不改变既有曲库身份。
- 老接收任务结束不覆盖新接收任务的提示或状态，旧 ACK 不暂停后来切换的歌曲。
- CSRF 字节长度校验先于 timingSafeEqual，异常编码不造成 500。

- 向右飞出动画扩大移动布局宽度、后续点击坐标错位：根部与应用外壳限制横向溢出，左右发送与恢复后点击重新验证。

- 解压 npm ci 时 13.0.3 触发隐式 node-gyp 并在当前环境失败：改为锁定 better-sqlite3 12.11.1，其预编译安装已实际验证；重新运行测试和启动，未采用忽略依赖安装脚本的方案。

### 测试和限制

见 TEST_REPORT.md 的实际命令、输出和人工检查项。没有声称在真实 iPhone Safari 或 Android Chrome 上验收；Motion、后台/锁屏、实际手机手指行为仍需现场检查。
