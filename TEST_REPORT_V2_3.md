# Flick Music V2.3 测试与交付报告

## 本次具体改动

- Shift+触控板横向滚轮事件，Mac 默认反转，Windows 默认标准，提供可持续保存的用户手动覆盖选项（只改变 wheel，鼠标拖动/键盘不变）。
- 运动手势需要 HTTPS、安全上下文及支持的手机传感器。浏览器有 requestPermission 时在真实 click 里请求；未收到采样时报告无硬件/权限提示。
- 横向加速度 m/s² 阈值和方向过滤，旋转坐标换算、重力高通近似、防误触冷却。不能当作真正速度估计。
- 甩歌独立多选、环绕流动光圈、模拟甩动、独立逐首传输队列、ACK 后的随机甩出与对应接收归位动画、音效。
- 原始 4 类可替换事件提示音仍支持，补充 Motion 专用的 WebAudio 甩出/收回音效。
- 传输协议附加 `interaction=motion|swipe`，数据库由 schema 2 迁移至 3（新增字段，无需清空已有曲库）。
- Node 服务器新增可选 TLS 配置，默认 HTTP 行为不变；完整 HTTPS 使用方法见 README_MOTION_HTTPS.md。
- 修复 V2.2 歌曲卡片删除/刷新时 `detachTouch` 名称引用错误。

## 实际执行的测试

1. `node --check` 检查 33 个 `.js`/`.cjs` 文件：**33 通过，0 失败**。
2. `node --test --test-concurrency=1 tests/core.test.js tests/desktop.test.js tests/motion.test.js tests/legacy.test.js tests/sounds.test.js`
   - **52 个单元测试通过、0 失败**。
   - 覆盖：双指/单指边界、Shift+wheel 方向校准、滚轮不拦截、键盘/鼠标、加速度强度与方向过滤、旋屏、高通回退、冷却、连续批量交付、失败、离线和取消。
3. **Chromium 真实前端页面 + 模拟 Socket.IO/HTTP 响应**：通过 6 项检查，包括加载三首歌曲、Mac/Win 方向映射两种配置、普通滚动不拦截、多选高亮动画、两首逐首 ACK 批量传输、接收方 motion 专用归位动画；页面未捕获到 JavaScript 异常。
4. Python SQLite 内存数据库验证数据库 DDL，transfer INSERT 字段数量、位置参数个数与 `interaction` 列：结构验证通过。

## 实际未验证的部分和限制

- 当前环境无法联网获取 npm 缺失依赖，`npm ci` 在线安装报 `EAI_AGAIN`、离线报 `ENOTCACHED`。
- 执行 `npm test` 共收集 55 个测试，其中 52 个通过，另 3 个测试文件（`integration`、`security`、`sound-http`）因 `socket.io-client` 缺失而**加载失败，未进入业务测试**，不能算通过。
- 未在完整 Express + Socket.IO + better-sqlite3 真实后端下完成端到端部署验证。
- 未实际使用手机 iOS/Android 加速度计、实体 Mac / Windows 触控板验证不同驱动和浏览器的真实硬件事件方向。
- 未实际建立公网 Tunnel 或安装可信 CA 证书测试移动浏览器 HTTPS。
- 自动播放提示音仍可能受各手机浏览器策略限制，建议两端先点击「开启事件提示音」。

## 用户机器必做验收

1. 先停止 V2.2 服务器并备份完整 `storage/`（数据库、blobs、sound-effects）；解压新压缩包，不要用新项目的空 storage 覆盖用户数据。
2. Node 22+，`npm ci`，然后 `npm test`，再 `npm run test:browser`，出现失败请附完整日志。
3. Mac 与 Windows 分别测试 Shift+触控板左右划，方向不对就在「触控板方向校准」切换；普通滚动和浏览器手势不应被劫持。
4. 先用「模拟甩动」选两首歌，验证发送端流光、接收保存/动画/音效及发送端逐首 ACK；不连接时不应显示虚假成功。
5. 用 HTTPS 方案在真实手机上请求 Motion 权限，确认 Debug 数值随手机移动而变化，再测试阈值和甩动方向。
6. 测试无音频、未配对、对方离线、取消/重试、双方声音被阻止、曲库删除与服务器重启保留。
