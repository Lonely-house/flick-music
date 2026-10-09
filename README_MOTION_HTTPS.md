# Flick Music V2.3 · 手机 Motion Control / HTTPS 启动指南

## 为什么 Mac 能点 Enable，手机却提示 Requires HTTPS？

- `DeviceMotionEvent` 在手机浏览器中需要**安全上下文**。`http://192.168.x.x:3000` 通常不是安全上下文；手机 Safari/Chrome 会限制获取运动传感器。
- `http://localhost:3000` 可能被电脑浏览器视作可信本机地址，因此不会显示 HTTPS 警告。但大多数 Mac、Windows 笔记本并没有浏览器可用的手机运动传感器，点击 Enable 不会带来真正的甩动数据。
- iOS Safari 在支持 `DeviceMotionEvent.requestPermission()` 时需要真实点击触发权限申请；不能页面一加载就请求。
- 本版提供**模拟甩动模式**，Mac/Windows 也可用来验证从多选、双端传输到动画音效的整个链路，但不会伪造传感器数据。

官方资料：<https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static>

## 方案 A：最快，临时 HTTPS Tunnel（需互联网）

保留 Node 服务器原来的 HTTP 运行方式：

```sh
npm ci
npm start
```

在另一终端安装 Cloudflare 官方 `cloudflared`：

- macOS Homebrew: `brew install cloudflared`
- Windows: 按 <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/> 安装官方 CLI。

再执行：

```sh
cloudflared tunnel --url http://localhost:3000
```

终端会生成 `https://随机名称.trycloudflare.com` 的临时地址。两台手机**使用同一个完整 HTTPS 地址**访问，然后重新配对。

注意：HTTPS 地址与旧的 `http://192.168...` 是不同 origin，浏览器 Cookie / 匿名设备 ID 不通用，因此第一次进入 HTTPS 页面可能显示全新的设备身份和空曲库。服务器原来的音频文件和旧曲库仍在；新会话可重新上传需要演示的音频。千万不要把新设备为空曲库误判为服务器丢失音乐。

Quick Tunnel 是开发测试用途，任何知道网址的人都可以访问。不要通过公开隧道展示私密音频或依靠随机网址充当身份认证；可参考 Cloudflare 的访问限制选项，或用方案 B 的受信任局域网 TLS。

官方资料：<https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/>

## 方案 B：纯局域网 HTTPS（对私人曲库更合适）

V2.3 的 Node 服务器现在支持使用证书和密钥直接启动 HTTPS：

- 环境变量 `FLICK_TLS_CERT`: 服务器证书路径
- 环境变量 `FLICK_TLS_KEY`: 与证书配对的**服务器私钥**路径

证书必须覆盖手机访问的 IP 或 DNS 名，且手机浏览器需要信任颁发它的根 CA。直接创建一个未受信任的自签名证书通常不能可靠解决传感器权限问题。

下面以 Mac + [mkcert](https://github.com/FiloSottile/mkcert) 为例，**IP 只是示例，必须替换为你的电脑当前 LAN 地址**：

```sh
brew install mkcert
mkcert -install
mkcert -key-file local-key.pem -cert-file local-cert.pem 192.168.1.23 localhost 127.0.0.1
FLICK_TLS_KEY="$(pwd)/local-key.pem" FLICK_TLS_CERT="$(pwd)/local-cert.pem" npm start
```

随后手机打开 `https://192.168.1.23:3000`。在手机中安全安装/信任 mkcert 的**公共 CA 根证书**，并按各系统设置验证信任状态。不要把 CA 私钥 `rootCA-key.pem` 或服务器私钥 `local-key.pem` 传给手机或他人。部分 Android 浏览器对用户安装的 CA 仍有额外限制，需以实际浏览器行为为准。

Windows PowerShell 示例：

```powershell
$env:FLICK_TLS_KEY="C:\path\to\local-key.pem"
$env:FLICK_TLS_CERT="C:\path\to\local-cert.pem"
npm start
```

启动后应打印 HTTPS LAN 地址。若同时设置了两个 TLS 变量，服务器的会话 Cookie 会标记 Secure。

## Motion Control 使用步骤

1. 手机 A、B 打开同一个可信 HTTPS 地址，完成连接配对。
2. 两端按需点击「开启事件提示音」；接收端如需自动接力播放，还要点击「启用音频接收」。
3. A 展开「高级功能 → Motion Control」，点 `Enable Motion Control`，允许运动传感器权限。
4. 在 A 的「我的音乐」勾选多首音频（或点击歌曲卡片非按钮区域），看到环绕流动光圈。
5. 默认阈值为 **13 m/s² 的横向加速度**；不是物理速度。可改方向、灵敏度；若动作左右反了，勾选「反转传感器方向」。
6. 握稳手机，以小幅快速横向摆动触发一次甩动。**不要将手机从手里抛出，远离人脸和易碎物。**
7. 系统逐首等待 B 的保存确认，A 的文件卡片不规则甩出并出现轻短丢弃音效，B 的卡片从相反侧飞入回弹并播放对应收回音效。失败歌曲保留选中供重试。
8. 页面保持前台；一些浏览器/系统在后台或锁屏时会停止传感器和音频。

## 故障排查

- `Motion Control requires HTTPS`：检查地址是否以受信任 `https://` 开头、没有证书警告。
- `没有有效加速度`：Mac/Win 缺少硬件或浏览器未提供传感器；手机需要用户授权、页面前台和浏览器支持。
- 数据有变化但没触发：先配对、选至少一首歌、阈值调整到 10–13 m/s²，试侧向小幅动作；不要大力挥甩。
- 左右动作相反：勾选「反转传感器方向」；浏览器间轴向可能不同。
- 无声音：点击「开启事件提示音」。自动播放受浏览器策略限制，发送成功不等于播放接力成功。
- 无法连通另一台手机：检查地址是否完全一致、端口和 Socket.IO 是否连接、是否重新配对。

## 验证方法

如果暂时无法解决 HTTPS，在电脑、手机 HTTP 页面点「模拟甩动（Mac/Win）」同样可选多首歌、触发**真实的服务器传输**及动画音效，只是通过按钮代替物理运动。优先通过模拟模式验证业务链路，再调试运动权限。
