# Right Alt + Right Shift 语音翻译粘贴计划

## 目标

修复显式翻译快捷键：`Right Alt + Right Shift` 按一次开始语音翻译，再按一次停止，完成后把翻译结果粘贴到光标位置。

## 文件范围

- 修改 `electron-app/renderer/src/services/shortcutGuard.behavior.test.ts`：增加组合键释放顺序回归测试。
- 修改 `electron-app/renderer/src/services/shortcutGuard.ts`：只在 `RightAlt` 释放边沿触发动作，并在一个按压周期内保持最高优先级意图。
- 修改 `electron-app/renderer/src/services/voiceTaskResolver.test.ts`：更新显式翻译快捷键有选区时的预期。
- 修改 `electron-app/renderer/src/services/voiceTaskResolver.ts`：让 `TranslateShortcut` 始终走语音翻译粘贴。
- 修改 `electron-app/renderer/src/services/recorder.behavior.test.ts`：更新 `RightAlt + RightShift` 有选区的录音与粘贴行为测试。
- 修改 `AGENTS.md`：记录新的长期快捷键约束。

## 步骤

1. 先写失败测试：
   - `RightAlt + RightShift` 中 `RightShift` 先释放时不能立即触发，也不能降级为听写。
   - `RightAlt + Space` 中 `Space` 先释放时不能立即触发，也不能降级为听写。
   - `TranslateShortcut` 有选区时仍录音、粘贴。
2. 运行目标测试，确认测试以当前实现失败。
3. 修改 `shortcutGuard.ts`：
   - 增加 `hasRightAltUpEvent` 判断。
   - 只在实际收到 `RightAlt` 释放事件时触发。
   - 用优先级合并当前意图，避免组合键释放后降级。
4. 修改 `voiceTaskResolver.ts`：
   - `TranslateShortcut` 固定返回 `mode: Translate`、`delivery: paste`、`shouldRecordAudio: true`。
5. 更新 `AGENTS.md` 中 `Right Alt + Right Shift` 的规则描述。
6. 运行验证：
   - `cd electron-app/renderer; npm test`
   - `npm run renderer:build`
   - `node --check electron-app/main.js`
   - `node --test electron-app/right-alt-relay.test.js`
7. 重启当前本地 Electron，让用户测试新分支运行结果。
