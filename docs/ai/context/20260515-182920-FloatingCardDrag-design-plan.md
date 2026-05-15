# 悬浮提示卡拖动与默认位置计划

## 目标

提示卡不再固定在一个不可调整的位置，用户可以直接拖动提示卡或胶囊栏移动悬浮窗口。默认位置仍保持底部居中，并给提示卡底部留出空间，避免被悬浮窗口裁切。

## 设计

- 复用现有 `floatingBar` BrowserWindow，不新增窗口。
- 使用 Electron frameless window 的 CSS 拖动区能力：
  - `#bar` 和 `#hint` 设置 `-webkit-app-region: drag`
  - 关闭按钮 `.dismiss` 设置 `-webkit-app-region: no-drag`
- 默认位置仍由 `main.js` 中的 `createFloatingBar()` 计算：
  - 提高 `windowHeight`，给提示卡留足垂直空间
  - 保持 `capsuleHeight` 和 `capsuleBottomGap` 逻辑不变，胶囊栏默认锚点不移动

## 取舍

- 这次先做用户可自由拖动，不做位置持久化；重启后回到默认位置。
- 拖动的是整个透明悬浮窗口，所以提示卡和胶囊栏会共享用户移动后的位置。
- 不改录音、快捷键、取消、转写逻辑。

## 验证

- 结构测试检查 `windowHeight` 默认值和 CSS 拖动区。
- 运行 `node --test electron-app/renderer/ui-structure.test.mjs`。
- 运行 `npm run build` 更新 renderer 产物。
