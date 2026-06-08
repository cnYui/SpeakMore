# Hy-MT2 双轨本地翻译运行方案

## 背景

当前本地翻译模型使用 `AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF / Hy-MT1.5-1.8B-2bit.gguf`。本地文件经 Hugging Face LFS 元数据校验后确认下载正确，但普通 `llama-server` 加载时报 `gguf_init_from_reader` tensor offset 错误。官方模型卡说明 llama.cpp kernel 仍在准备中，因此继续把该模型作为默认会造成“下载成功但无法加载”的产品问题。

用户确认改为双轨方案：稳定可用优先，同时接入最前沿 STQ 专用 kernel。默认让产品能用，STQ 可用时再优先走轻量极速模型。

## 设计

- 极速轨：`tencent/Hy-MT2-1.8B-1.25Bit-GGUF / Hy-MT2-1.8B-1.25Bit.gguf`，需要 STQ 专用 `llama-server`。
- 稳定轨：`tencent/Hy-MT2-1.8B-GGUF / Hy-MT2-1.8B-Q4_K_M.gguf`，使用标准 `llama-server`。
- 后端状态、下载和加载仍复用 `translation-model:*` IPC 与 `/translation-model/*` HTTP API，避免扩散新入口。
- 下载选择规则：STQ runtime 可用时下载 1.25Bit，否则下载 Q4_K_M；加载时优先 STQ 缓存与 runtime，失败时自动回退到 Q4。
- 设置页继续保持和语音模型一致的单按钮体验，只展示当前模型、缓存目录、运行模式和简短状态。

## 取舍

- 不再把旧 Hy-MT1.5 2bit 缓存视为有效本地翻译模型。
- 不把 STQ 构建失败作为打包失败；STQ PR 尚未合并，首版必须允许标准 Q4 兜底。
- 不提交任何 `release-artifacts` 二进制。构建脚本负责准备标准 runtime 和可选 STQ runtime。
- 清理本机旧 Hy-MT1.5 缓存、旧日志和临时排查文件，但保留标准 `release-artifacts/llama` 供 Q4 fallback 使用。

## 验证方式

- `node --test scripts/prepare-llama-runtime.test.mjs scripts/dev-prereqs.test.mjs`
- `node --test electron-app/voice-backend-service.test.js electron-app/app-paths.test.js`
- `cd server; python -m pytest -q test_local_translation_model.py test_service_readiness.py`
- `cd electron-app/renderer; npm test`
- `npm run renderer:build`
- `node --check electron-app/main.js`
- `git diff --check`
