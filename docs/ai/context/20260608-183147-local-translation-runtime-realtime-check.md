# 本地翻译模型运行与实时翻译生效检查

## 背景

用户截图显示设置页“本地翻译模型”已经显示为“已加载”，需要确认这是否代表可以正常使用，并进一步检查会议实时翻译是否真的走本地模型。

实际检查结果：

- `/translation-model/status` 返回 `status=ready`、`ready=true`、`runtime_kind=llama-server`、`runtime_url=http://127.0.0.1:8105`。
- `llama-server /v1/models` 能列出 `Hy-MT2-1.8B-Q4_K_M.gguf`。
- 直接调用本地 runtime 使用官方单用户翻译 prompt，可以在约 857ms 返回英文译文。
- 调用后端实时翻译路由 `translate_text_with_engine(... realtime=True)` 返回 `translation_engine=local_hy_mt`、`local_model_status=ready`，说明会议实时翻译在 `auto` 策略下会优先使用本地 Hy-MT2。

## 发现的问题

- 当前 `build_local_translation_messages` 仍使用 system prompt + user prompt。Hy-MT2 1.8B/7B 官方使用方式更接近单条用户翻译指令，不建议依赖默认 system prompt；为提升稳定性，需要改成本地翻译专用的单用户 prompt。
- 设置页“运行说明”在 ready 状态下直接显示后端英文 detail，例如 `Local translation model loaded with llama-server`，不符合设置页中文 i18n 体验。
- 开发态重启时可能留下旧 `llama-server.exe` 占用 8105。旧 runtime 实际已经加载 Hy-MT2，但新后端只看到端口占用并进入 failed，导致“模型明明可用但设置页失败”。需要识别并复用这个已有 runtime。

## 设计

- 后端本地翻译 prompt 改为单条 user message：
  - 明确目标语言。
  - 上下文只作为术语和代词参考。
  - 明确只输出译文，不输出解释、标签、Markdown、emoji 或历史句子。
- 保持 `translation_engine=local_hy_mt`、WebSocket 消息和设置项不变。
- 前端设置页将 ready detail 映射为 i18n 文案，不直接展示英文后端 detail。
- 后端启动本地翻译模型时，如果 8105 已被占用，会先检查 `/v1/models` 是否正在服务当前 Hy-MT2 GGUF；如果匹配，则接管为 `llama-server-existing` ready 状态，不再报端口占用。

## 验证

- 直接调用本地 llama-server `/v1/chat/completions` 验证 Hy-MT2 能输出英文译文。
- 调用 `translate_text_with_engine(... realtime=True)` 验证返回 `translation_engine=local_hy_mt`。
- 运行后端本地翻译测试、renderer 测试、renderer build、主进程语法检查。
