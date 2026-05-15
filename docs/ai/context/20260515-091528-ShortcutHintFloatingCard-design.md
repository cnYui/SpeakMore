# Right Alt 长按提示悬浮卡设计

## 目标

长按 `Right Alt` 时，不再在主窗口内显示提示浮层；提示卡应直接出现在胶囊悬浮条的位置，并临时顶替胶囊条。录音、取消、转写、历史保存等语音链路逻辑不变。

## 方案

采用独立 `shortcut-hint` IPC 事件控制提示卡显示。`AppShell` 继续负责快捷键守卫和长按判定，但不再渲染提示 UI；当 `shortcutGuard.modalVisible` 变化时，只把 `{ visible: boolean }` 发给主进程。

主进程接收 `shortcut-hint` 后转发给 `floatingBar`，并在提示可见时显示悬浮条窗口。这样即使主窗口隐藏，用户也能在屏幕底部看到提示。

`floating-bar.html` 同时保留胶囊条和新增提示卡。提示可见时隐藏胶囊条、显示卡片；提示关闭或新一轮正常快捷键/录音状态到来时恢复胶囊条。

## 取舍

- 不复用 `voice-state`，避免把快捷键提示和语音会话状态混在一起。
- 不新增第二个窗口，复用现有悬浮条窗口，保持位置和置顶策略一致。
- 关闭按钮仍保留在提示卡上，但只影响提示显示，不改变快捷键守卫和录音逻辑。

## 测试重点

- `AppShell` 不再包含长按提示文案或 MUI 浮层。
- `AppShell` 仍然负责 `global-keyboard`、`toggleRecording`、`voice-cancel-requested`。
- `main.js` 注册并转发 `shortcut-hint` 到 `floatingBar`。
- `floating-bar.html` 接收 `shortcut-hint`，提示可见时隐藏 `#bar` 并显示提示卡。
