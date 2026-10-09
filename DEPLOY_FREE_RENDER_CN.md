# Flick Music Final — 完全免费 Render 部署

本压缩包保留了原始作品所有文件，只新增免费云部署配置与此说明。
**本版本与之前的 Render 付费磁盘版本不同：它明确配置 plan: free，且不创建持久磁盘。**

## 1. 上传 GitHub
1. 下载并解压 `Flick_Music_Final_FREE_Render.zip`。
2. 在 https://github.com/new 建立一个空的 Private 仓库（例如 flick-music-final-free）。
3. 将解压后所有文件和文件夹上传到仓库**根目录**。
   GitHub 根目录须能直接看到 `render.yaml`、`server.js`、`package.json`、`public/` 等。
   **不要只上传 ZIP 文件，也不要再套一层 Flick_Music_Final 文件夹。**
4. 旧的 `render.yaml`（含 plan: 0.5c-512mb 和 disk 字段）不要混入仓库。
   本 ZIP 的 `render.yaml` 使用 plan: free，不包含 disk。

## 2. 在 Render 一键部署
1. 打开 https://dashboard.render.com/ 并登录。
2. 选择 New → Blueprint，授权 GitHub 并选择刚创建的仓库。
3. 检查预览计划：**Web Service / Free**，不创建持久磁盘，不创建数据库。
4. 点击应用部署，观察 Events / Deploy Logs，等待部署状态显示 Live。
5. 点击服务页面提供的真正 URL（类似 https://项目唯一名称.onrender.com）。
   请使用 Render 实际分配的地址，不要把示例地址直接复制成真实地址。
6. 测试 URL 加 `/api/health` 应返回 `{"ok":true,"version":"3.0.0"}`。

如果不用 Blueprint，也可以在 Render 中 New → Web Service，连接 GitHub 后手动填写：
- Runtime: Node
- Instance Type: Free
- Build Command: `npm ci --omit=dev`
- Start Command: `npm start`
- 环境变量：`NODE_ENV=production`、`SECURE_COOKIE=1`
- 不附加 Disk

## 3. HTTPS / Motion Control / 两部手机传歌
- Render 自动提供有效的 HTTPS 公网 URL。无需 cloudflared，不配置 `FLICK_TLS_CERT` 或 `FLICK_TLS_KEY`。
- 两台手机直接在 Safari / Chrome 打开**同一个 HTTPS 域名**，完成昵称和设备配对。
- 接收端点击“启用音频接收”。
- 发送端上传一首音频，展开高级功能 → Motion Control，**点击** Enable Motion Control。
- 如果手机显示传感器权限提示，请允许。
- 选中音乐卡片，小幅、快速横向摆动手机（不要真的把手机扔出去）。
- 如果加速度变化但没有触发，可检查方向反转、调低阈值。
- 接收端成功入库不等于自动播放；浏览器可能要求接收端点一次播放解锁音频。

电脑开发者工具可检查：
```js
location.protocol // "https:"
window.isSecureContext // true
```
浏览器提示 Secure Context 不成立时，务必检查是否直接访问真实的 .onrender.com HTTPS URL。

## 4. 重要的免费限制（一定要读）
Render 免费 Web Service 15 分钟没有 HTTP / WebSocket 入站通信会休眠；
再次访问时通常要等待启动。最关键的是：
**上传的歌曲、SQLite 数据库、设备昵称、配对和会话信息保存在免费实例的临时本地存储中；
休眠、重启或重新部署后可能全部清空。**
清空后，两台手机需要重新建立设备身份、上传音乐、重新配对。
这不影响源代码和页面继续被托管，启动后的实时功能仍可使用。

如想长期保存用户上传的音乐和曲库，必须另外使用长期持久存储。
本免费部署没有实现跨休眠数据持久化，不要把它当作永久云音乐库。

免费的服务仍可能受每月实例时数、带宽和构建额度约束；
若账户绑定了付款方式，超额用量可能产生费用。希望严格 0 支出，
请检查 Render 的账单和额度页面，并避免开启付费磁盘或实例。

该作品含公开上传能力与匿名设备身份，请勿存放私密或无权分享的音频；
面向不受控公网长期开放前建议添加用户身份验证、上传配额和速率限制。

## 5. 常见问题
- 部署预览要收费：确认仓库根目录的 `render.yaml` 是否 `plan: free` 且没有 `disk:`。
- `Missing module` / `npm ci` 失败：检查是否完整上传 `package-lock.json`。
- Render 页面打不开：检查 Events / Deploy Logs 中的错误。
- 休眠后曲库空了：属于免费服务的临时文件限制，不是甩动或 Socket.IO 出错。
- `Motion Control requires HTTPS`：查看地址栏是否为实际分配的 HTTPS 地址，
  是否在内嵌浏览器打开，或浏览器是否显示证书警告。
- HTTPS 正常但不能甩动：传感器权限、系统浏览器兼容性、页面前台、
  配对状态和灵敏度都需要真机逐项确认。

官方资料：
https://render.com/docs/free
https://render.com/docs/blueprint-spec
https://render.com/docs/websocket
https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static
