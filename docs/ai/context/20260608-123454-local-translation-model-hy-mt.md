# 本地翻译模型 Hy-MT 接入上下文

## 背景

用户希望翻译能力像 SenseVoiceSmall 一样支持本地模型下载和加载，但不强制下载。指定模型为 `AngelSlim/Hy-MT1.5-1.8B-2bit`，实际桌面端优先下载 GGUF 形态 `AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF / Hy-MT1.5-1.8B-2bit.gguf`，用于会议实时翻译、普通语音翻译和最终译文生成。

## 设计取舍

- 不复用 ASR 的 `voice-model` 语义，新增独立 `translation-model` 后端接口和 Electron IPC，避免把语音识别 ready 状态和翻译模型 ready 状态混在一起。
- 本地翻译模型是可选增强。默认策略为 `auto`：本地模型已加载且运行时可用时优先使用本地 Hy-MT；否则回退现有 LLM 翻译。
- 运行时采用 llama.cpp 兼容外部服务路径。开发态可通过 `SPEAKMORE_LLAMA_SERVER_PATH` 或 `LLAMA_SERVER_PATH` 指定 `llama-server`；打包态可由 Electron 注入资源目录中的 `llama-server` 路径。缺少运行时时显示 `runtime_missing`，不影响原有云端翻译。
- Hy-MT 只做机器翻译，不做会议摘要、行动项或纪要结构化。会议纪要最终总结仍由现有大模型 refiner 完成。
- 实时翻译继续沿用现有句群提交器、pending 消息和按 `sentence_index` 原地替换的前端协议，只给消息补充 `translation_engine`、`translation_latency_ms` 等可选诊断字段。
- API Key 校验按能力收敛：本地模型 ready 且任务只需要翻译时，不要求 API Key；需要云端 fallback、自由提问、会议纪要总结或普通听写润色时仍要求 API Key。

## 验证方式

- 后端覆盖模型状态、下载、缓存校验、运行时缺失、加载/卸载、翻译引擎路由和 fallback。
- Renderer 覆盖设置页模型区块、设置归一化、IPC store、实时翻译 payload 原地更新。
- 运行 `cd electron-app/renderer; npm test`、`npm run renderer:build`、`node --check electron-app/main.js`、相关主进程 `node --test` 和后端 pytest。
