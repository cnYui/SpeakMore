# 胶囊悬浮条放大记录

## 目标

把胶囊显示框整体放大 25%，包括文字、圆点和音量柱，同时补高悬浮条窗口，避免放大后贴边。

## 修改点

- `electron-app/renderer/public/floating-bar.html`
  - `#bar` 高度从 `24px` 调到 `30px`
  - 胶囊间距、最小宽度、内边距、字号、圆点和音量柱按 1.25 倍放大
  - 音量柱动态高度范围从 `5-18` 调到 `6.25-22.5`
- `electron-app/main.js`
  - `capsuleHeight` 从 `24` 调到 `30`
  - `windowHeight` 从 `250` 调到 `280`

## 说明

窗口定位仍以胶囊底边为锚点，`capsuleBottomGap` 不变；这次只放大胶囊态，不改提示卡大小。
