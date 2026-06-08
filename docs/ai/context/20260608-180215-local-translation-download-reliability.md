# 本地翻译模型下载可靠性修复

## 背景

设置页本地翻译模型已经切到 Hy-MT2，但用户截图显示下载失败后直接暴露 `IncompleteRead` 原始异常。当前后端状态为 `tencent/Hy-MT2-1.8B Q4_K_M`、`cached=false`、`status=failed`，本地缓存目录中存在 Hy-MT2 半成品缓存和旧 Hy-MT1.5 lock 残留。

这说明模型切换已经生效，但下载链路还不够产品化：网络中断没有自动重试，错误文案没有归一化，失败后的缓存/lock 没有被清理，用户会反复看到“失败”但不知道下一步应该继续下载还是重新选择目录。

## 设计

- 下载任务增加有限次数重试，针对 `IncompleteRead`、连接中断、超时、临时网络错误自动再次调用 Hugging Face 下载，让缓存可以复用已下载 blob。
- 保持现有 `translation-model:start-download` IPC 和后端 `/translation-model/download` 接口不变。
- 失败 detail 进入后端前先归一化，前端再映射为中文/英文 i18n 文案，不再把 Python 原始异常直接显示给用户。
- 保留完整错误细节只在测试/日志可见，设置页只告诉用户“网络中断，可继续下载或更换网络后重试”。
- 清理本机旧 Hy-MT1.5 lock、旧日志和无效临时锁；不删除有效 Hy-MT2 已下载 blob，避免浪费用户已经下载的 700MB+ 数据。
- 残留清理使用路径边界校验，只允许删除翻译模型缓存目录内的目标，避免目录名前缀相似时误删旁路文件。
- 下载失败 detail 已经归一化过时不再二次包裹，避免出现 `translation_model_download_failed: translation_model_download_failed: ...` 这种重复错误码。

## 取舍

- 不引入新的下载器或第三方镜像，继续使用 `huggingface_hub.snapshot_download`，降低跨平台风险。
- 不在 renderer 直接删除缓存，缓存一致性仍由后端和本机维护。
- 不把下载失败当作模型损坏；只有已缓存模型加载失败才展示“GGUF 可能不完整或不兼容运行时”。

## 验证

- 后端测试覆盖下载中断重试、错误归一化、旧 lock 清理不影响 Hy-MT2 partial blob。
- renderer 测试覆盖网络中断文案不暴露 `IncompleteRead`。
- 运行 `cd electron-app/renderer; npm test`、`npm run renderer:build`、`cd server; python -m pytest -q server/test_local_translation_model.py server/test_service_readiness.py`、`git diff --check`。
