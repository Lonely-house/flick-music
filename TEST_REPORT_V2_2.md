# Flick Music V2.2 检验说明

## 范围
- 单指向左滑触发删除确认、向右单指不触发；双指左右发送无变化。
- Mac / Windows 浏览器下：Shift + 横向滚动、鼠标拖动、键盘组合键。
- 普通横向 wheel 不取消默认行为，垂直滚动、交互控件、误触发不发送。
- 原 V2.1 的服务与四个提示音配置保持原样；未修改服务器数据表。

## 实测与限制
实际可执行的命令及结果见本文件生成时附加的记录。
Node 单元测试覆盖触控手势正反方向、阈值、取消、多指识别、桌面滚轮/指针/键盘及边界。
没有实际 MacBook、Windows 精密触控板或 iPhone 传感器硬件；系统级手势和实体设备体验需要用户在真机上验收。服务器完整集成测试取决于当前环境是否可以安装 Node 依赖。

## 真机验证步骤
1. 手机：左滑一指打开删除确认；取消应保留歌曲；右滑一指不删除；左右双指仍向配对设备发送。
2. Mac Safari/Chrome 和 Windows Edge/Chrome：鼠标停在歌曲卡片文字上，按住 Shift 并在触控板横向滑动，等待手势结束；另一设备收到歌曲。
3. 放开 Shift，仅两指左右滑，原浏览器导航不应被网页的自定义 JS 阻止。遇系统级导航抢占，用鼠标拖动/键盘。
4. 拖动音乐卡片左右发送，纵向拖动和短距离不发送；卡片按钮仍能点击。
5. Tab 选中音乐卡片，Shift+←/→ 分别发送 left/right；多选模式禁止手势发送。
6. 已配对与未配对分别测试、发送成功/失败动画、正常纵向滚动、重新连接后是否可操作。

## 本次执行结果（在当前沙盒中实际执行）

- 环境：Node.js v22.16.0；独立 Chromium v144.0.7559.96。
- `node --check` 对 28 个 JavaScript 文件的语法检查：**通过**。
- `node --test --test-concurrency=1 tests/legacy.test.js tests/core.test.js tests/desktop.test.js tests/sounds.test.js`：**45 通过、0 失败**。
- Chromium 前端沙盒对真实 HTML + CSS + 手势事件侦听器：**7 项交互检查通过、0 页面脚本错误**；覆盖单指左滑、单指右滑无效、双指右滑发送、普通 Wheel 未被取消、Shift+Wheel 发送、鼠标拖动发送、Shift+方向键发送。输入为注入的浏览器事件，**不是实体触控板的硬件输入**。
- 执行 `npm test`：45/48 测试通过；剩余 3 个测试文件（integration / security / sound-http）在加载测试依赖时失败，报错 `Cannot find module 'socket.io-client'`，原因为当前环境未安装项目 npm 依赖，未进入这些测试的业务断言。这 3 项**未验证**，不能算作通过。
- 未执行两台手机 Socket.IO 全链路验证，也未在实体 Mac、Windows 触控板和 iPhone 动作传感器上测试。必须在用户环境运行 `npm ci && npm test`、`npm run test:browser` 并按 README 做实体设备演示。
