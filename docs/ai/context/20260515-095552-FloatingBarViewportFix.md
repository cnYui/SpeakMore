# 悬浮条提示卡视口修复记录

## 现象

长按 `Right Alt` 后，长按提示卡没有出现在悬浮条位置，胶囊条也没有正常显示。

## 根因

新增提示卡时把 `#bar` 和 `#hint` 放进了 `#scene` 容器，但 `html` / `body` 没有设置 `width: 100%` 和 `height: 100%`。  
结果 `#scene` 的定位参考系在运行时塌缩，绝对定位元素被放到了不可见位置。

## 修复

- 给 `html, body` 补上 `width: 100%` 和 `height: 100%`
- 保持 `#scene` 作为统一定位容器
- 补一条结构测试，锁定视口尺寸约束

## 验证

- `node --test electron-app/renderer/ui-structure.test.mjs`
- `npm run build`（`electron-app/renderer`）
