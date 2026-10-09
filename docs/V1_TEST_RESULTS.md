# V1 历史记录（不作为 V2 验收依据）

下文保留原包内容，V2 实际结果请看根目录 TEST_REPORT.md。

# 验证记录

## 已实际执行

- npm install：成功安装锁定依赖。
- npm start：成功监听所有网络接口；独立启动检查 /api/health 返回 HTTP 200 和 {"ok":true}。
- 页面、CSS、各 JavaScript 模块与 Socket.IO 客户端资源均返回 HTTP 200。
- npm test：31 个测试通过，无失败。包括真实 HTTP 上传、Range 与 Socket.IO 服务集成；媒体行为部分使用可控假播放器验证失败和边界。
- Python：复算手势阈值及歌曲结束附近的 seek 钳制，验证有限数值和范围边界。
- Chromium 141 headless：两个独立移动尺寸浏览器会话，使用实际生成的 MP3 文件和 HTML5 Audio，完成以下 12 个场景，无页面脚本异常。

## 浏览器场景

1. real MP3 upload and HTML5 playback
2. no B: A continues playing
3. B not ready: A continues playing
4. Enable Audio initializes actual receiver audio
5. actual playback transfer and duplicate-trigger suppression
6. play() NotAllowedError: B displays tap prompt, A continues
7. Socket.IO reconnect automatically re-joins; then transfer works
8. browser touch events reject vertical, short, slow, one-finger and cancelled gestures
9. valid two-finger TouchEvent runs the same real transfer
10. end-of-track seek is finite and inside duration
11. refresh retains identity and track, resets audioReady, re-joins
12. mobile and desktop layout does not overflow

## 测试范围

- 正常播放、上传与跨浏览器转移使用真实 HTML5 Audio 和真实 Socket.IO。
- autoplay 失败通过将接收端 play() 注入 NotAllowedError 验证；不代表测量了所有手机的真实自动播放策略。
- 双指识别用实际 DOM TouchEvent 事件测试，并用纯函数覆盖阈值；不是物理手指在手机上的测试。
- 末尾位置测试确认 seek 有限且位于 duration 范围内；非常接近末尾的歌曲可能马上自然结束。
- 移动端和桌面宽度检查无横向溢出，最终界面截图已经人工查看。
- 没有声称完成真实 iPhone Safari / Android Chrome 两台手机验收。请按 README 在真机现场检查权限和系统手势。
- B 已经开始播放却丢失成功确认的极端网络中断可能导致短暂双端播放；优先保证 A 不因失败而停。
