# 胶囊栏匹配提示卡字体记录

## 目标

提示卡当前视觉大小满意后，将胶囊栏文字同步到提示卡正文/按键 chip 的 `13px`，并按字体比例同步放大胶囊栏本体、圆点和音量柱。

## 修改点

- `electron-app/renderer/public/floating-bar.html`
  - 胶囊字号从 `8.75px` 调到 `13px`
  - 胶囊高度、宽度、内边距、间距、圆点和音量柱按约 `13 / 8.75` 放大
- `electron-app/main.js`
  - `capsuleHeight` 从 `30` 调到 `44.6`
  - `capsuleBottomGap` 不变，保持胶囊栏位置锚点不变

## 说明

这次不改提示卡大小，也不调整整体底部间距。
