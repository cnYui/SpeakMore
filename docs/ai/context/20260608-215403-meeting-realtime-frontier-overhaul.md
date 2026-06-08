# 会议笔记实时链路系统性重构

## 背景

用户反馈会议笔记、实时翻译和导入文件体验仍然不达标：快语速时文字识别明显落后，实时翻译慢、重复、断句突兀，会议录制还存在自动结束问题。当前代码中会议实时链路虽然已有 AudioWorklet、端点检测和 Hy-MT2 本地翻译，但 WebSocket 收到 PCM 后仍同步等待 ASR 推理，CPU 上一旦 ASR 慢于实时音频输入，就会产生堆积。

## 取舍

- 会议笔记不做录制时长限制；普通语音模式如需限制，按模式单独保留。
- 不改会议笔记现有 UI 结构，优先改底层实时数据链路。
- 当前环境 ASR 在 CPU 上运行，短期不能承诺云厂商级硬件延迟；本轮先消除架构阻塞、重复和自动结束，再通过诊断指标暴露真实瓶颈。
- 保留 SenseVoiceSmall 作为最终高质量转写和 fallback；新增实时 pipeline 抽象后续可接 FunASR online/streaming ASR。
- 实时翻译采用“预览粗译 + 稳定句群修正”的同声传译体验，同一个 sentence_id 原地更新，不重复旧句。

## 实施重点

- 后端新增 per-session realtime pipeline：音频接收只入队，ASR worker 异步消费，WebSocket 不被 ASR 推理阻塞。
- 后端输出新增 backlog、RTF、partial/stable 字段，renderer 可继续兼容旧字段。
- stable transcript 只追加冻结段，partial 只覆盖尾巴，避免旧句回流。
- 会议翻译只翻译未提交句群；预览译文不能覆盖稳定译文。
- renderer 会议模式不启动录制时长限制。

## 验证

- 后端单测覆盖音频接收不阻塞、backlog 字段、partial/stable 更新、翻译去重。
- renderer 单测覆盖会议无限时、预览/稳定译文原地更新。
- 运行 `cd server; python -m pytest -q`、`cd electron-app/renderer; npm.cmd test -- --runInBand`、`npm.cmd run renderer:build`、`node --check electron-app/main.js`、`git diff --check`。

## 风险

- CPU-only ASR 仍可能无法达到极低延迟，尤其是高噪声、混合音频或长句。新诊断字段用于定位是否 ASR 推理、翻译模型或前端采集是瓶颈。
- 新增实时 pipeline 会改变测试中的消息时序，需确保最终完成消息和错误路径仍能关闭 worker 并清理队列。
