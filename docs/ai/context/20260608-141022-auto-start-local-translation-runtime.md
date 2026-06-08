# 本地翻译模型启动自动预热

## 背景

用户希望启动项目时一起运行 llama，不再每次进入设置页手动加载本地翻译模型。当前 Hy-MT 权重和 llama runtime 是可选能力，不能因为其中任意一个缺失导致 SpeakMore 后端或客户端启动失败。

## 设计

- 后端启动时自动检查本地翻译状态。
- 仅当以下条件同时满足时后台加载 Hy-MT：
  - `AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF` 已缓存。
  - `llama-server` 或 `llama-cpp-python[server]` runtime 可用。
  - 本地翻译模型尚未 ready，且没有正在进行的下载/加载任务。
- 自动预热不阻塞 `/health`、Electron 启动或 ASR 模型加载。
- 如果缺模型或缺 runtime，只跳过预热，不把整个后端标记为失败。
- 通过环境变量 `SPEAKMORE_AUTO_PRELOAD_TRANSLATION_MODEL=0/false/no/off` 可关闭自动预热，便于低配机器或调试场景。

## 取舍

- 不在启动时自动下载 Hy-MT 权重，避免用户没用本地翻译也被强制下载大模型。
- 不在缺 runtime 时反复尝试启动，避免项目启动日志噪声和资源浪费。
- 不改变设置页按钮：用户仍可手动下载、加载、卸载。

## 验证方式

- `python -m pytest -q server/test_local_translation_model.py server/test_service_readiness.py`
- `cd server; python -m pytest -q`
- `node --check electron-app/main.js`
- `cd electron-app/renderer; npm test`
- `npm run renderer:build`
