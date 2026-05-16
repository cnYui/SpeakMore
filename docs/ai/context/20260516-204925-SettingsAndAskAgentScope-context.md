# 设置页与自由提问能力范围梳理

## 背景

本轮用户提出四个问题：

- 自由提问当前只是简单问答，没有大模型工具链。
- 设置页里翻译目标语言只有一种，界面语言也只有一种。
- DeepSeek API Key 输入框没有热更新到后端。
- 开机启动功能看起来没有完整实现。

## 当前代码现状

- 自由提问走 `Right Alt + Space -> recorder.ts -> WebSocket /ws/rt_voice_flow -> server/refiner.py`，后端只调用一次 DeepSeek 文本模型，没有意图分类、工具路由或工具结果注入。
- `server/refiner.py` 的 `ask_anything` prompt 已经是“无工具安全版”，要求实时信息无工具时不要编造。
- 设置页 `Settings.tsx` 已有界面语言和翻译目标语言下拉框，但 `settingsStore.ts` 与 `electron-app/main.js` 都把界面语言固定为 `zh-CN`，翻译目标语言固定为 `en`。
- DeepSeek API Key 输入框目前只保存在组件 state，不写本地设置、不写 `server/.env`，后端 `refiner.py` 的 `AsyncOpenAI` client 也只在首次调用时读取环境变量并缓存。
- 开机启动切换会调用 `permission:update-auto-launch`，主进程也会执行 `app.setLoginItemSettings`；但设置页初值只来自本地 `settings.json`，没有回读系统真实登录项状态，外部修改后 UI 不可信。

## 设计判断

- 自由提问工具链是独立大功能，至少需要意图分类、工具选择、工具执行、失败边界和最终回答生成。不能只改 prompt 或让模型假装有联网能力。
- 多语言界面与多目标翻译语言是两个不同问题：前者需要全量 UI 文案资源和语言切换机制，后者主要影响设置、类型归一化和翻译 prompt。
- DeepSeek API Key 热更新应优先做成“运行时配置接口 + 后端 client 失效重建”，避免 renderer 直接写后端 `.env`。
- 开机启动应补齐“系统真实状态回读 + 写入失败回滚”，否则开关仍会误导用户。

## 待确认范围

需要先确认本轮是一次性打开四个方向，还是拆成两个迭代：

1. 先完成收敛且可验证的设置真实化：翻译语言列表、DeepSeek API Key 热更新、开机启动真实状态回读。
2. 另起设计实现自由提问 Agent 工具链。

## 验证方向

- renderer：设置 store 和 Settings 页面测试、`npm test`、`npm run build`。
- Electron 主进程：`node --check electron-app/main.js`，补主进程启动项和设置 IPC 测试。
- 后端：`server/test_runtime_config.py`、`server/test_refiner_prompts.py`，新增运行时配置与 client 重建测试。
- 自由提问工具链若进入本轮，需要新增后端单元测试覆盖意图分类、工具路由、工具失败和无工具边界。
