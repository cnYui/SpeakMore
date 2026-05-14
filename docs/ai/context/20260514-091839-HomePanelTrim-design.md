# Home 面板裁剪设计

## 背景

用户要求删除 Home 主页面中的 `Voice dictation` 和 `Recent history` 两个区域及其文字内容。截图中的 `Latest result` 未被点名删除，因此保留。

## 设计

- 修改 `electron-app/renderer/src/pages/Dashboard.tsx` 和对应结构测试。
- 删除 Home 内容区的 `Voice dictation` 卡片，包括模式切换和状态文字。
- 删除 Home 内容区的 `Recent history` 标题、数量和空状态卡片。
- 保留 `Latest result` 卡片和复制功能，因为它不属于本次明确删除范围。
- 将 `Latest result` 从双列区域调整为单卡片显示，避免左侧删除后出现空列。

## 非目标

- 不改侧边栏底部的 `Voice dictation / Right Alt` 快捷状态卡。
- 不改历史页、设置页、诊断页。
- 不改录音、WebSocket、ASR、润色或历史存储链路。

## 取舍

保留 Dashboard 内的语音会话订阅和历史保存副作用。虽然删除了 Home 的录音状态卡，但 `Latest result` 仍依赖当前会话文本；同时历史保存不应因 UI 卡片删除而被破坏。

结构测试原先要求 Dashboard 使用 `getVoiceStatusLabel`，该函数只服务于已删除的状态文字。测试应改为验证 Dashboard 仍订阅语音状态机并保存历史，而不是绑定到已删除 UI。
