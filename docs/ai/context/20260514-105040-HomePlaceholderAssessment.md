# 首页占位现状评估

## 范围

- 主页壳：`electron-app/renderer/src/components/AppShell.tsx`
- 首页面板：`electron-app/renderer/src/pages/Dashboard.tsx`
- 相关页：`History.tsx`、`Settings.tsx`、`Diagnostics.tsx`
- 相关服务：`recorder.ts`、`historyStore.ts`、`settingsStore.ts`、`diagnostics.ts`
- 主进程桥接：`electron-app/main.js`

## 结论

当前首页不是纯静态图，但也不是完整产品。它由三层混合组成：

1. 语音录音、转写、自动粘贴、悬浮条同步，已经接了真实本地链路。
2. 历史、设置、诊断，只有部分能力真实，更多是本地 `localStorage` 或兼容层。
3. 首页统计卡片和部分设置项仍是明显占位，会误导用户以为这些指标和控制项已经生效。

## 已经是真实链路的部分

### 首页最近结果

- `Dashboard.tsx` 通过 `subscribeVoiceSession` 订阅真实录音状态：`electron-app/renderer/src/pages/Dashboard.tsx`
- `recorder.ts` 会真正：
  - 拉起本地后端：`audio:ensure-voice-server`
  - 打开 WebSocket：`ws://localhost:8000/ws/rt_voice_flow`
  - 获取麦克风流并发送 `audio/webm;codecs=opus`
  - 接收转写/润色结果
  - 调用 `keyboard:type-transcript` 执行自动粘贴
- 主进程里这些能力都不是空函数：
  - `keyboard:type-transcript`
  - `audio:ensure-voice-server`
  - `audio:mute-background-sessions`
  - `audio:restore-background-sessions`

### 首页到历史页的数据落盘

- `Dashboard.tsx` 在会话 `completed/error` 后保存记录。
- `historyStore.ts` 真实持久化到了渲染进程 `localStorage`。
- 这意味着“历史记录”不是纯假数据，但它只是本地前端缓存，不是正式历史库。

### 悬浮条显示开关

- `Settings.tsx` 切换“显示悬浮条”时会调用 `page:set-floating-bar-enabled`。
- `AppShell.tsx` 启动时会回放这个设置。
- `main.js` 会按该开关真正控制悬浮条显示状态。

### 开机启动

- `Settings.tsx` 的“开机启动”会调用 `permission:update-auto-launch`。
- `main.js` 使用 `app.setLoginItemSettings`，这是实打实的系统行为，不是占位。

### 诊断页里的部分检查

- `diagnostics.ts` 会真实请求 `http://127.0.0.1:8000/health`
- 会真实读取 `navigator.mediaDevices.enumerateDevices()`
- 会真实调用 `troubleshooting:get-system-info`
- 但诊断项仍然偏浅，只能算“有真实探测”，还不算完整诊断能力。

## 明显是占位符的部分

### 首页统计卡片

- `Dashboard.tsx` 里的 `23.4%`、`0 分钟`、`0`、`--` 都是硬编码。
- 没有任何计算逻辑，也没有对应 store / IPC / 后端来源。
- 这块是最典型的假 UI。

### 麦克风设备下拉

- `Settings.tsx` 会请求 `audio:get-devices-async`，但主进程实现直接返回：
  - `success: true`
  - `devices: []`
  - `message: 'no devices in shim'`
- 所以下拉框现在只是壳子，既拿不到真实设备，也不会影响录音设备选择。

### 历史页的“真实”只到本地缓存

- `History.tsx` 的搜索、复制、清空都能工作。
- 但数据完全来自 `historyStore.ts` 的 `localStorage`，没有接 `db:history-*`。
- 同时主进程里的 `db:history-list/get/latest/...` 仍大量返回空数组、`not_found`、`empty` 或直接 `success: true`。
- 所以“历史页可用”只成立于“本地单机临时记录”这个层级，不是正式实现。

### 声音效果开关

- `Settings.tsx` 只写了 `localStorage`。
- 代码里没有消费 `enableSoundEffects` 的地方。
- 这是纯占位设置。

### 语言设置

- UI 只显示固定文案“简体中文 (zh-CN)”。
- 没有切换控件，也没有接入 `i18n:set-language`。
- 这是静态展示，不算实现。

### 检查更新

- 按钮只是根据 IPC 是否存在决定是否禁用。
- `main.js` 里的 `updater:*` 处理器全部返回 `null`。
- 这是典型占位入口。

## 需要真正实现的部分

### P1 应补的真实能力

1. 首页统计卡片
   - 基于真实历史记录或正式数据库计算总时长、字数、速度、节省时间。
   - 如果短期不做，应该直接删掉或明确标注“暂未启用”，不要显示硬编码数值。

2. 麦克风设备管理
   - `audio:get-devices-async` 改为真实枚举输入设备。
   - 设置页选中的设备要进入 `getUserMedia` 约束或录音链路配置。

3. 正式历史存储
   - 从 `localStorage` 过渡到统一历史存储接口。
   - 让首页最近结果、历史页、统计卡片使用同一数据源。

4. 设置项去占位
   - `enableSoundEffects` 要么接真实行为，要么移除。
   - 语言、更新等入口如果当前不做，应降级成只读说明，不要伪装成可操作功能。

5. 诊断页深化
   - 现在只能检查“后端能否访问”“有没有麦克风”“IPC 在不在”。
   - 还缺录音权限、WebSocket 可用性、ASR 模型状态、粘贴权限、设备选择有效性等真实诊断。

## 取舍建议

- 如果目标还是 P0 稳定优先，首页最该先处理的不是“补全所有功能”，而是先消除误导。
- 最低成本方案：
  - 删掉首页假统计卡
  - 禁用或隐藏无效设置项
  - 历史页明确标注“仅本地缓存”
- 真正补实现时，再把历史、统计、设备选择统一到一个正式数据源上。
