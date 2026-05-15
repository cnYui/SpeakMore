# 悬浮窗口位置校准临时功能设计计划

## 目标

临时允许用户拖动悬浮窗口，并记录拖动后的窗口坐标。用户把提示卡和胶囊栏拖到满意位置后，再把记录到的位置固化为默认位置，并删除拖动能力。

## 设计

- 保留当前默认位置计算逻辑，作为校准模式启动时的初始位置。
- `floating-bar.html` 继续使用 `-webkit-app-region: drag` 让胶囊栏和提示卡可拖动。
- Electron 主进程监听 `floatingBar` 的 `move` / `moved` 事件。
- 每次窗口移动后读取 `floatingBar.getBounds()`，写入：
  - `app.getPath('userData')/local-data/floating-bar-position.json`
- JSON 内容包括：
  - `x`
  - `y`
  - `width`
  - `height`
  - `updatedAt`

## 后续固化流程

1. 用户拖动悬浮窗口到满意位置。
2. AI 读取 `floating-bar-position.json`。
3. 将其中的 `x/y` 固化为默认位置计算结果。
4. 删除拖动 CSS 和移动位置记录逻辑。

## 验证

- 结构测试检查主进程存在 `FLOATING_BAR_POSITION_FILE_NAME`、`getBounds()`、`writeJsonFile()` 和 `move/moved` 监听。
- 结构测试检查胶囊栏和提示卡可拖动、关闭按钮不可拖动。
- 运行 `node --test electron-app/renderer/ui-structure.test.mjs`。
- 运行 `npm run build`。
