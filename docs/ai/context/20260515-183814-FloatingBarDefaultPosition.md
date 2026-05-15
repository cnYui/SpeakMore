# 悬浮窗口默认位置固化记录

## 目标

先把用户拖动后的悬浮窗口位置设为默认位置，其他逻辑暂时不动。

## 记录到的位置

- `x`: `658`
- `y`: `659`
- `width`: `405`
- `height`: `365`

## 修改点

- `electron-app/main.js`
  - 在 `createFloatingBar()` 中新增 `defaultFloatingBarX = 658`
  - 在 `createFloatingBar()` 中新增 `defaultFloatingBarY = 659`
  - `BrowserWindow` 默认 `x/y` 使用这两个值

## 说明

这次只固化默认位置；拖动能力和位置记录能力暂时保留，后续确认后再删除。
