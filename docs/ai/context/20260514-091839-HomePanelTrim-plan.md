# Home 面板裁剪计划

## 目标

从 Home 主面板删除 `Voice dictation` 和 `Recent history` 两块内容，保留 `Latest result`。

## 步骤

1. 在 `Dashboard.tsx` 删除 `activeMode`、`statusLabel`、`voiceModes`、`getVoiceStatusLabel` 相关代码。
2. 删除 `Voice dictation` 卡片 JSX。
3. 删除 `Recent history` 标题和空状态 JSX。
4. 将 `Latest result` 卡片保留为单独区域。
5. 更新 `ui-structure.test.mjs` 中 Dashboard 状态机断言，移除对已删除状态文字函数的要求。
6. 运行 `npm run build` 验证 TypeScript 和 Vite 构建。
7. 运行 `npm test` 验证结构测试。

## 验证标准

- Home 页面不再出现 `Voice dictation` 主内容卡片。
- Home 页面不再出现 `Recent history`、`0`、`暂无历史记录`。
- `Latest result` 仍显示并可复制。
- renderer 构建通过。
- renderer 结构测试通过。
