# 长按提示卡片独立窗口设计计划

## 目标

用户按出长按提示卡片时，可以按 `Escape` 关闭提示卡片，仅关闭提示，不取消录音会话。胶囊栏和提示卡片的位置需要分开控制，拖动胶囊栏时不能影响提示卡片。

## 设计

- 胶囊栏继续使用 `floatingBar` 窗口。
  - 保留默认位置 `x=658, y=659`。
  - 保留拖动能力。
  - 保留 `floating-bar-position.json` 位置记录。
- 长按提示卡片新增独立 `shortcutHintWindow` 窗口。
  - 使用单独的 `shortcut-hint.html`。
  - 通过 `shortcut-hint` IPC 独立显示和隐藏。
  - 默认位置先按现有卡片相对胶囊窗口的位置换算，不影响胶囊栏窗口坐标。
- `Escape` 行为：
  - 如果提示卡片可见，先隐藏提示卡片并返回。
  - 如果提示卡片不可见，保留原来的 `voice-cancel-requested` 行为。

## 测试计划

- 结构测试锁定提示卡片独立窗口和独立 HTML。
- 结构测试锁定 `shortcut-hint` 不再发送给 `floatingBar`。
- 结构测试锁定 `Escape` 在提示卡片可见时只调用 `hideShortcutHint()`。
- 构建 renderer，重启 Electron 供 GUI 测试。
