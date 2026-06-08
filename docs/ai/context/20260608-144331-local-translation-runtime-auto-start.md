# 本地翻译运行时准备与自动启动

## 背景

用户希望本地翻译模型像语音模型一样好理解：未下载时显示“下载模型”，下载完成识别到缓存后显示“加载模型”；项目启动后如果本地模型和运行时都已准备好，应自动把本地翻译模型加载起来，让实时翻译可以直接使用。

当前链路中，Hy-MT GGUF 权重已经能下载并缓存，但本地推理运行时依赖 `llama-server`。原 `prepare:llama-runtime -- --source C:\path\to\llama-server.exe` 中的路径只是占位符；用户没有本机真实 `llama-server.exe` 时会失败。并且 Windows 官方 llama.cpp 包通常包含 exe 和 DLL，只复制 exe 不够稳。

## 设计

- `prepare-llama-runtime` 默认从 ggml-org/llama.cpp GitHub 最新 release 自动选择平台 CPU 包：
  - Windows x64 优先 `bin-win-cpu-x64.zip`。
  - macOS arm64/x64 分别选择 `bin-macos-arm64.tar.gz` / `bin-macos-x64.tar.gz`。
  - 保留 `--source`、环境变量和 PATH 发现逻辑，用户显式指定时优先使用用户路径。
- 解压或复制时把 `llama-server` 同目录必要动态库一并复制到 `release-artifacts/llama/`，避免 Windows 缺 DLL。
- 后端本地翻译模型下载任务完成后，如果运行时可用，立即启动加载任务；项目启动时已有缓存和 runtime 时也继续自动预热。
- 设置页仍保持和“语音模型”一致的简洁 UI，不暴露 GitHub、runtime 路径和 DLL 细节。

## 取舍

- 不把 Hy-MT 权重强制下载，仍由用户在设置页主动下载。
- 运行时属于应用能力组件，允许通过准备脚本放入 `release-artifacts`，打包时一起带上；开发态也复用同一路径。
- 默认选择 CPU runtime，覆盖最广；CUDA/Vulkan 等加速 runtime 以后可做高级安装选项。

## 验证方式

- `node --test scripts/prepare-llama-runtime.test.mjs scripts/dev-prereqs.test.mjs`
- `cd server; python -m pytest -q test_local_translation_model.py test_service_readiness.py`
- `cd electron-app/renderer; npm test`
- `npm run renderer:build`
- `node --check electron-app/main.js`
- 手动运行 `npm run prepare:llama-runtime`，确认 `release-artifacts/llama/llama-server.exe` 可用。
- 手动运行 `npm run prepare:llama-runtime -- --source C:\path\to\llama-server.exe`，确认占位路径不会阻断已准备好的运行时复用。
