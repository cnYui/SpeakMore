# 内置 llama-server 运行时方案

## 背景

本地翻译模型 `AngelSlim/Hy-MT1.5-1.8B-2bit` 已经支持下载和加载，但当前用户机器缺少本地推理运行时。仅依赖用户自行安装 `llama-cpp-python[server]` 在 Windows 上会触发源码编译，耗时长且失败概率高；仅提示用户安装 `llama-server` 也不符合 SpeakMore 对普通用户的体验要求。

## 设计

- 模型权重仍由用户自行下载，不随安装包强制携带。
- 推理运行时改为应用包内置优先：
  1. 打包资源中的 `resources/llama/llama-server(.exe)`。
  2. 开发/发布准备阶段的 `release-artifacts/llama/llama-server(.exe)`。
  3. 用户显式配置的 `SPEAKMORE_LLAMA_SERVER_PATH` / `LLAMA_SERVER_PATH`。
  4. 系统 `PATH` 中的 `llama-server`。
  5. 后端 Python 环境里的 `llama-cpp-python[server]` fallback。
- Electron 打包通过 `extraResources` 把 `release-artifacts/llama` 放入安装包。
- 开发态 `npm run server` 自动把 `release-artifacts/llama/llama-server(.exe)` 通过 `SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH` 注入后端环境，保证开发和打包行为一致。
- 发布脚本提供 `prepare:llama-runtime`，从本机安装路径或显式环境变量复制 runtime 到 `release-artifacts/llama`；源码仓库不提交二进制。

## 取舍

- 不把 runtime 二进制提交到 Git，避免仓库膨胀和平台二进制更新难维护。
- 不强制下载 Hy-MT 权重，避免用户未使用翻译功能时被迫下载约数百 MB 模型。
- `llama-cpp-python[server]` 仅作为 fallback，不作为主路径，避免 Windows CMake/MSVC 编译问题影响普通用户。
- macOS 打包产物必须包含可执行 `llama-server`，后续发布签名/公证时需要纳入资源签名检查。

## 验证方式

- `node --test scripts/dev-prereqs.test.mjs`
- `node --test electron-app/voice-backend-service.test.js`
- `python -m pytest -q server/test_local_translation_model.py`
- `npm run renderer:build`
- `node --check electron-app/main.js`
- 打包验证脚本检查 Windows zip 和 macOS app 中是否包含 `llama-server(.exe)`。
