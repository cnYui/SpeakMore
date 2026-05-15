# 长按提示卡单独上移记录

## 目标

提示卡底部接近悬浮窗口边界，需要单独上移；胶囊栏位置保持不变。

## 修改点

- `electron-app/renderer/public/floating-bar.html`
  - 在 `#hint` 上增加 `top: calc(50% - 24px)`
  - 不修改 `#bar` 定位和 `main.js` 的悬浮窗口位置参数
- `electron-app/renderer/ui-structure.test.mjs`
  - 增加结构断言，确保提示卡有独立上移偏移

## 说明

`#bar` 和 `#hint` 仍共用基础居中定位；`#hint` 通过覆盖 `top` 单独向上移动。
