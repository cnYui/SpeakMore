# 会议笔记实时识别与实时翻译低延迟重构

## 背景

用户现场反馈实时翻译仍然慢、识别慢、识别准确率低、已识别内容会变化、句子会漏翻或突然跳到下一句。截图显示实时翻译列表中的英文原文和中文译文已经形成行，但识别结果像离线 ASR 对短窗口的误识别，且前端展示依赖整体 rawText 覆盖，导致用户感知为“前面识别过的内容又变了”。

## 取舍

- 不继续只调断句阈值，先保证已稳定文本不再被 partial 覆盖。
- 本轮优先实现 LocalAgreement、stable/partial transcript、preview/commit 翻译阶段和诊断字段。
- 真正 FunASR streaming 模型接入做成可选增强接口和状态，不强制用户下载，缺模型时保留 SenseVoice endpoint fallback。
- UI 结构不大改，只改变底层数据流和必要状态字段。

## 实施重点

- 后端 `StreamingAsrSession` 增加 hypothesis 稳定器，连续 hypothesis 的公共前缀进入 stable，尾巴作为 partial。
- WebSocket `transcription` 输出 `stable_text`、`partial_text`、`revision_id`、`utterance_id`、`asr_engine`。
- Renderer 会议模式不再用整段 `text` 覆盖已稳定逐字稿，而是维护 `stableTranscriptText + partialTranscriptText`。
- 实时翻译消息补充 `phase`、`source_stable`，同一 `sentence_id` 原地从 preview 修正到 commit。
- ASR 队列按实时优先处理，backlog 过大时丢弃 live partial 但保留完整音频用于最终转写。

## 验证

- 后端协议测试覆盖 stable 不回退、partial 可覆盖、preview/commit 原地更新。
- Renderer 行为测试覆盖已稳定逐字稿不被 partial 改写。
- 跑 `npm.cmd run verify:voice`、`cd server; python -m pytest -q`、`cd electron-app/renderer; npm.cmd test -- --runInBand`、`npm.cmd run renderer:build`、`node --check electron-app/main.js`。

## 风险

- CPU-only SenseVoiceSmall 仍可能是识别准确率和速度瓶颈，本轮主要消除“显示变动、重复、漏翻、队列阻塞”的架构问题。
- 可选 streaming 模型需要后续完整下载/自检体验，否则默认 fallback 不应影响当前用户使用。
