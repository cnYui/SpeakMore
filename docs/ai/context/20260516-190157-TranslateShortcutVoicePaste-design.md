# Right Alt + Right Shift 语音翻译粘贴设计

## 背景

当前分支把 `Right Alt + Right Shift` 和选区绑定得过紧：只要启动时读到选区，就会直接调用文本翻译并走选区替换，不会进入麦克风录音。用户期望的显式翻译快捷键不是“翻译当前选区”，而是“开始语音翻译；用户说完后，再把翻译后的结果粘贴到当前光标位置”。

同时，快捷键状态由主进程转发的是“本次变化事件附近的键态片段”。如果 `Right Shift` 先松开，renderer 可能把缺少 `RightAlt: true` 的事件误判为整组快捷键结束，或者在恢复到 `RightAlt` 单键态时把翻译意图降级为听写意图。这会造成翻译录音无法稳定按“按一次开始、再按一次停止”的方式工作。

## 目标行为

- `Right Alt + Right Shift` 始终表示显式语音翻译。
- 语音翻译必须启动麦克风录音，结束后把后端返回的翻译结果走普通粘贴链路 `keyboard:type-transcript`。
- 该快捷键不再因为启动时存在选区而进入“直接翻译选区并替换”的分支。
- 同一轮 `Right Alt` 按压周期中，只要出现过 `Right Shift`，本轮意图就保持为 `TranslateShortcut`，直到 `Right Alt` 松开触发。
- `Right Alt` 有选区仍保留“选区转译并覆盖原选区”的能力。
- `Right Alt + Space` 的自由提问选区规则不变。

## 取舍

- 不新增新的 UI 或设置项；本次只修快捷键任务解析和边沿触发。
- 不把选区文本传给 `translation` 模式；显式翻译模式只翻译用户语音内容。
- 如果用户在有选区时使用 `Right Alt + Right Shift`，最终粘贴行为交给操作系统当前焦点处理。选区仍存在时，`Ctrl+V` 可能自然覆盖选区；但应用层不再做选区有效性校验和悬浮面板降级。

## 验证重点

- 单元测试覆盖 `RightShift` 先释放、`Space` 先释放和组合键意图保持。
- 任务解析测试覆盖 `TranslateShortcut` 有选区仍为 `shouldRecordAudio: true`、`delivery: paste`。
- 录音行为测试覆盖 `RightAlt + RightShift` 有选区时走 WebSocket 录音，完成后粘贴翻译结果，不调用文本流直接翻译。
- 修改 renderer 后运行 `npm test` 和 `npm run build`，并重启本地 Electron。
