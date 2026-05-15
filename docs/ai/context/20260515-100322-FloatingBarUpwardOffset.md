# 悬浮条上移记录

## 目标

把当前的长按提示卡和胶囊整体向上移动一点，先固定现有屏幕上的视觉位置，再做后续分辨率适配。

## 修改点

- `electron-app/main.js`：把 `capsuleBottomGap` 从 `16` 调到 `32`，整体上移窗口。
- `electron-app/renderer/ui-structure.test.mjs`：同步更新对 `capsuleBottomGap` 的结构断言。

## 说明

这次只调整窗口的垂直锚点，不改提示卡内部布局，也不改多显示器或不同 DPI 的适配逻辑。
