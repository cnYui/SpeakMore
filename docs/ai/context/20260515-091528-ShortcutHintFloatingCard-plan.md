# Right Alt 长按提示悬浮卡实施计划

## 目标

把长按快捷键提示从主窗口迁移到悬浮条窗口，并在提示可见时顶替胶囊显示框。

## 文件职责

- `electron-app/renderer/src/components/AppShell.tsx`：保留快捷键状态机订阅，只发送 `shortcut-hint` 状态，不渲染提示卡。
- `electron-app/main.js`：接收 renderer 发来的 `shortcut-hint`，转发给悬浮条并控制窗口显示。
- `electron-app/renderer/public/floating-bar.html`：新增提示卡 DOM、样式和 `shortcut-hint` 事件处理；提示可见时隐藏胶囊。
- `electron-app/renderer/ui-structure.test.mjs`：更新结构测试，锁定提示卡迁移行为。
- `AGENTS.md`：记录后续协作约束，避免提示 UI 回到主窗口。

## 步骤

1. 更新结构测试：主窗口不得包含 `检测到长按快捷键`；悬浮条必须包含提示卡文案和 `shortcut-hint` 监听；主进程必须转发 `shortcut-hint`。
2. 运行结构测试，确认新断言在现有实现下失败。
3. 修改 `AppShell.tsx`：删除提示卡渲染和相关 MUI 依赖，增加 `shortcut-hint` 状态发送 effect。
4. 修改 `main.js`：新增 `ipcMain.on('shortcut-hint')`，转发到悬浮条并按可见性显示窗口。
5. 修改 `floating-bar.html`：新增提示卡结构和显示切换逻辑；关闭按钮通过 `shortcut-hint` 本地隐藏。
6. 更新 `AGENTS.md` 当前迭代约束。
7. 运行结构测试和 renderer build，确认改动可用。
