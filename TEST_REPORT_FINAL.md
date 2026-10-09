# Flick Music Final（v3.0.0）测试报告

## 以用户上传的 V2.3 ZIP 为基线

修复/交付：
1. 接收权限：`device:register` 不允许由客户端写入音频 Ready；只有当前控制 Socket 显式执行 `device:ready`，服务器才允许 `transfer:request` 和 `transfer:stored`。拒绝的请求不会写入接收方曲库的隐形记录；重连后需重新启用。
2. Motion 光圈：删除旧 conic-gradient 整体旋转伪元素，改为几何位置固定的纯白描边、柔和亮度脉冲、沿边框移动的白色高光。选中待发送时停止光效，确认接收后播放甩出动画。
3. 歌曲列表：icon、单行文件名、图标播放键、右下角竖三点（展开格式/时长）；隐藏发送按钮。悬停/焦点长标题滚动；原单指左滑删除、双指滑动发送、桌面触控板/鼠标/键盘发送、多选批量删除继续保留。
4. 整理 UI：Debug Log、全设备事件提示音、触控板校准和 Motion Control 全部合并进统一「高级功能」区域（诊断日志嵌套折叠）。通知使用会自动消失的提示。
5. 播放器：右上小按钮切换极简 / 黑胶高级模式；高级视图使用上传的奶龙图片经 CSS 裁剪为唱片中心圆形标签，播放慢转、暂停停转，提供歌名、艺术家、可拖动进度、上一首、下一首及播放/暂停。复用原有 HTML5 Audio，不额外创建播放实例。
6. MP3 ID3v2 标题/作者读取：经自己的鉴权音频接口 GET 小段 Range；无法获取元数据时使用文件名解析和“未知艺术家”回退，不伪造艺术家。

## 已实际运行

- `node --check`：**36 个 JS/CJS 文件检查，0 语法错误。**
- `node --test --test-concurrency=1 tests/receiver-ready.test.js tests/track-metadata.test.js tests/core.test.js tests/desktop.test.js tests/motion.test.js tests/legacy.test.js tests/sounds.test.js`：
  **58 / 58 通过。**
- Node 新增接收状态单元测试验证：
  - 注册时传入 `audioReady:true` 无法伪造接收授权。
  - 仅配对、未 Ready 时服务端拒绝开始文件传输。
  - 尚未 Ready 的接收方不能通过 `transfer:stored` 保存文件。
- ID3 解析单元测试验证 UTF-8 ID3v2.3 识别及异常文件不崩溃、仅获取有权访问的音频 Range 数据。
- Chromium 前端模拟检查（使用真实 Final HTML/CSS/JS、模拟 Socket.IO 和 REST 响应）：
  **9 项 desktop 功能检查通过，0 页面 JS 异常**（歌曲卡片简化、展开信息、长标题悬停、模式切换、歌名/作者、进度与切歌、Motion 固定白色光圈等）。
  **3 项 390px 手机功能检查通过，0 页面 JS 异常**（配对不等于接收 Ready、点击启用音频接收、唱片机在窄屏内布局正确）。
- 现有的 V2.3 纯 Node 手势/批次测试仍通过；browser-check.cjs 与集成测试相关断言已更新到新协议和极简卡片。
- 代码与 HTML 组件 ID、资源路径、package.json/package-lock 版本一致性已检查。

## 未完成的环境性测试

- `npm test` 在当前运行环境得到 **58 个可运行用例通过、3 个测试文件加载失败**。原因是缺少 `socket.io-client` 等 npm 依赖，尚未执行 `tests/integration.test.js`、`tests/security.test.js`、`tests/sound-http.test.js` 的业务断言。因此**不能宣称完整后端/真实设备测试全部通过**。
- 当前沙盒无法完成 npm 依赖下载/完整 Express+Socket.IO+SQLite 端到端验证；无法实际接入 Mac/Windows 触控板、iPhone/Android 传感器或扬声器。
- 未验证真实 Firefox 与 Safari 中 CSS mask 的表现。如果浏览器不支持白色光圈边缘渐变遮罩，纯白静态描边仍会保留。
- 通过模拟浏览器事件验证 Motion ACK 驱动动画；真机传感器阈值、浏览器 autoplay 权限和两台实体手机的实际延迟需要用户验收。

## 建议你在自己的 Mac 上执行

1. 备份 V2.3 `storage/` 文件夹（重要：原数据库和音频不在此 ZIP 中）。
2. 进入 Final 解压目录，执行 `npm ci`、`npm test`、`npm run test:browser`，确认测试通过。
3. 手机 A、B 配对但都不点击「启用音频接收」，A 向 B 双指发送：应被拒绝，B 曲库不新增音频。
4. B 点击「启用音频接收」，A 可发送给 B；如果 B 向 A 反向发歌，A 也必须先点击接收按钮。
5. 检查选中歌曲光圈只围绕单张卡片显示纯白边框，不跨屏、不旋转；Motion 甩动开始后停止选中项光效。
6. 检查长音频名悬停滚动，三点展开格式/时长，左右滑、批量删除不误触。
7. 切换高级/极简模式，播放时中心图片随唱片旋转，上一首/下一首/进度可用；手机上检查界面不横向溢出。
8. 需要真机甩动时，用 README_MOTION_HTTPS.md 的可信 HTTPS 配置。

本 ZIP 不打包 node_modules、数据库、已有用户音频、TLS 私钥或临时测试文件。
