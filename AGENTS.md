# 项目协作约定

## 目录职责

- `server/`：本地 FastAPI 后端，负责语音上传、ASR 转写、文本润色和 WebSocket 语音流接口。
- `electron-app/`：手写 Electron 本地壳，负责主窗口、悬浮录音条、托盘和快捷键。
- `app-extracted/`：Typeless 逆向参考资料，只作为协议、页面、迁移和原始实现参考。
- `experiments/`：独立实验代码，不参与主应用运行链路。
- `docs/ai/context/`：AI 上下文、设计、计划和决策记录。

## 清理规则

- 可以删除可再生成产物：`node_modules/`、`__pycache__/`、`*.log`。
- 不要删除 `app-extracted/dist/`、`app-extracted/build/`、`app-extracted/lib/`、`app-extracted/drizzle/`，除非明确确认不再需要逆向参考。
- 新增 AI 上下文文档使用 `YYYYMMDD-HHMMSS-文件名.md` 命名。

## 开发偏好

- 默认中文沟通和注释。
- 优先复用现有 `server/` 和 `electron-app/`，不要把逆向包当作主要开发入口。
- 修改前先明确 design / plan，并写入 `docs/ai/context/`。
- 用户可见文案默认全部使用中文；仅品牌名和原始按键名可保留英文，例如 `SpeakMore`、`Right Alt`、`Right Shift`、`Space`。
- `electron-app/renderer/` 是 Vite + React + MUI + TypeScript 前端项目，像素级复刻 Typeless UI。
- `app-extracted/` 仅作为 UI 视觉参考和协议参考，不作为运行时加载目标。
- `main.js` 加载 `electron-app/renderer/dist/index.html`（构建产物）。
- 前端修改后需在 `electron-app/renderer/` 下运行 `npm run build` 再重启 Electron 验证。

## 当前迭代重点

- P0：优先补齐语音输入链路的错误兜底和状态统一，包括录音状态机、WebSocket 生命周期、麦克风/后端/ASR/润色/粘贴错误处理、悬浮条状态同步和测试漂移修复。
- P1：在 P0 稳定后，再把历史、设置、诊断从静态页面升级为真实数据和真实操作。
- 不要在 P0 中扩大范围做整套页面重构、账户体系、云同步、自动更新或复杂快捷键编辑器。
- 快捷键驱动录音必须基于边沿触发，不要对每次 `global-keyboard` 键态更新直接做 `toggleRecording`。
- 悬浮条显示开关以主进程状态为准；渲染进程设置变更必须通过 IPC 同步到主进程，而不是只写本地存储。
- WebSocket 语音流默认输入来自 `audio/webm;codecs=opus`，后端不能把未知音频头直接当 `.wav`；非 wav 输入必须先转码再喂 ASR。
- ASR 后端唯一使用 `faster-whisper`，默认模型固定为 `base`；不要再兼容 Handy `ggml` 或 SenseVoice 变量。
- 模型扫描顺序固定为 `WHISPER_MODEL_DIR` → `%LOCALAPPDATA%\Typeless\models\faster-whisper` → `%USERPROFILE%\.cache\huggingface\hub`；三者都未命中时首次下载到 `%LOCALAPPDATA%\Typeless\models\faster-whisper`。
- 开发态 `uvicorn reload` 必须显式由环境变量开启，不要在代码里默认写死 `reload=True`。
- 录音期间静音后台声音时，保持现有“点按开始、再次点按结束”的交互，不改成 `PTT`；Windows 上按音频会话静音实现，结束后只恢复本轮被 Typeless 主动静音的会话。
- 悬浮条录音波形只在 `electron-app/renderer/public/floating-bar.html` 展示；需要真实消费录音输入音量，不要再使用固定 CSS 假动画。
- 悬浮条录音波形统一为 8 根更细的柱子；音量数据由 `recorder.ts` 基于同一份 `MediaStream` 计算整体响度并通过 `voice-state` 同步。
- 胶囊栏可见期间按 `Escape` 必须取消当前未完成语音会话：不发送 `end_audio`、不自动粘贴、忽略迟到结果，悬浮条显示 `当前转录已取消` 后自动隐藏。
- 历史记录和设置统一由 Electron 主进程写入 `app.getPath('userData')/local-data/` 下的 JSON 文件；renderer 不再把这类业务数据写入 `localStorage`。
- 首页统计只统计成功听写记录：总时长累加 `durationMs`，累计字数使用最终文本长度，平均速度为字数/听写分钟，节省时间按 60 字/分钟手打基准估算；个性化指标在真实 AI 个性化能力完成前保持未启用。
