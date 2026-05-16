# 选区参与模式判断验证记录

## 实现结果

- 快捷键层输出 `ShortcutIntent`，不再直接输出最终 `VoiceMode`。
- `Space + RightShift` 同时存在时优先翻译意图。
- renderer 启动前读取选区快照，并由 `voiceTaskResolver` 合成最终 `VoiceTask`。
- `Right Alt + 有选区` 进入选区转译，不启动麦克风。
- `Right Alt + Space + 有选区` 录音时携带 `selected_text`，完成后优先覆盖原选区。
- 原选区目标不可靠时，不强制覆盖，改为悬浮结果面板展示。

## 验证命令

- `node --test electron-app/right-alt-relay.test.js`：通过，7 个测试。
- `node --test electron-app/focused-context.test.mjs`：通过，7 个测试。
- `node --check electron-app/main.js`：通过。
- `cd electron-app/renderer; npm test`：通过，87 个测试。
- `npm run renderer:build`：通过，`tsc -b` 和 `vite build` 均成功。
