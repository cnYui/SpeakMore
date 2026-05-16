# UIA 选区读取与卡片兜底验证记录

## 实现结果

- `focused-context:get-selection-snapshot` 使用 UIA confirmed 选区作为唯一可信选区来源。
- 剪贴板读取不再参与模式解析。
- `Right Alt` 在 UIA 有选区时进入选区翻译，UIA 为空时保持普通听写。
- `Right Alt + Space` 有选区时只传 `selected_text`，结果展示悬浮卡片。
- `Right Alt + Right Shift` 保持语音翻译粘贴。
- 普通听写、选区翻译和语音翻译在粘贴失败时展示悬浮卡片。

## 验证命令

- `node --test electron-app/focused-context.test.mjs`
- `node --test electron-app/right-alt-relay.test.js`
- `node --check electron-app/main.js`
- `cd electron-app/renderer; node --import tsx --test src/services/focusedContext.test.ts src/services/voiceTaskResolver.test.ts src/services/recorder.behavior.test.ts`
- `cd electron-app/renderer; npm test`
- `npm run renderer:build`

## 结果

- `node --test electron-app/focused-context.test.mjs`：通过，10 passed，0 failed。
- `node --test electron-app/right-alt-relay.test.js`：通过，7 passed，0 failed。
- `node --check electron-app/main.js`：通过，exit 0。
- `node --import tsx --test src/services/focusedContext.test.ts src/services/voiceTaskResolver.test.ts src/services/recorder.behavior.test.ts`：通过，33 passed，0 failed。
- `cd electron-app/renderer; npm test`：通过，95 passed，0 failed。
- `npm run renderer:build`：通过，`tsc -b` 与 Vite build 均成功。
