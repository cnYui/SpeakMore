# 首页统计与 JSON 持久化计划

## 目标

用主进程 JSON 作为历史和设置的单一数据源，完成首页四项统计、真实麦克风选择、历史页统一存储、设置页去占位。

## 实施步骤

1. 更新结构测试，先覆盖以下要求：
   - 主进程存在 `settings.json` / `history.json` 读写逻辑。
   - renderer 历史服务通过 `db:history-*` IPC 工作，不再使用 `localStorage`。
   - renderer 设置服务通过 `settings:*` IPC 工作，不再使用 `localStorage`。
   - 首页调用真实统计服务，不再显示硬编码 `23.4%`。
   - 麦克风设备使用 `navigator.mediaDevices.enumerateDevices()`，选择结果进入 `getUserMedia`。
   - 设置页不再展示“声音效果”，更新检查为禁用说明。
2. 实现主进程 JSON 存储辅助函数。
3. 实现 `settings:get`、`settings:update`、`db:history-list`、`db:history-upsert`、`db:history-clear`、`db:history-stats`。
4. 改造 `settingsStore.ts` 为异步 IPC 服务。
5. 改造 `historyStore.ts` 为异步 IPC 服务，并导出统计读取函数。
6. 在 `recorder.ts` 记录录音开始和结束时间，保存 `durationMs` 与 `textLength`，并读取设置中的麦克风设备。
7. 改造 `Dashboard.tsx`：加载统计，保存历史后刷新统计，四项指标显示真实值；个性化显示“暂未启用”。
8. 改造 `History.tsx`：异步加载、清空和复制。
9. 改造 `Settings.tsx`：异步加载设置，真实枚举麦克风，保存选择，去掉无效声音效果。
10. 调整 `AppShell.tsx` 启动时异步加载设置并同步悬浮条开关。
11. 运行 renderer 测试、Electron 测试和 renderer 构建。

## 验证标准

- `npm test` 在 `electron-app/renderer/` 通过。
- `npm run build` 在 `electron-app/renderer/` 通过。
- `npm test` 在 `electron-app/` 通过。
- 首页四个统计值来自 `db:history-stats`。
- 历史页数据来自主进程 JSON。
- 设置页的麦克风选择会影响录音 `getUserMedia`。
- 设置页不再展示未实现的声音效果开关。
