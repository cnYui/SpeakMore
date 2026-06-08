# 本地翻译运行时与设置区块样式修复

## 背景

用户在设置页点击“本地翻译模型”的加载模型后看到 `llama-server runtime is missing`。原因是当前 Hy-MT GGUF 权重已经能下载和扫描，但本地推理仍需要 llama.cpp 兼容运行时。现有实现只查找独立 `llama-server` 可执行文件；开发环境没有该文件时只能显示缺少运行时。

同时，本地翻译模型区块使用了浅蓝背景，和上方“语音模型”灰色区块不一致，需要改为同一视觉密度与灰色背景。

## 取舍

- 保持本地翻译模型为可选增强，不下载或不加载时不影响原有 LLM 翻译。
- 后端加载本地翻译模型时先使用独立 `llama-server`，再支持 `llama-cpp-python` 的 OpenAI 兼容 server 作为开发态/用户环境兜底。
- 如果两个运行时都没有，状态仍为 `runtime_missing`，但 detail 改成更清楚的中文，说明需要安装或提供 llama.cpp 运行时，而不是只显示英文底层错误。
- UI 区块背景、间距和错误提示风格向 `VoiceModelSettingsSection` 收敛，不再使用蓝色提示底。
- 不把 `llama-cpp-python` 强制加入主依赖安装链路，避免 Windows 无编译环境时安装失败影响基础语音功能；保留可选运行时检测。

## 验证方式

- `cd electron-app/renderer; npm test`
- `npm run renderer:build`
- `node --check electron-app/main.js`
- `cd server; python -m pytest -q server/test_local_translation_model.py`
- 手动刷新设置页，确认本地翻译模型区块为灰色，缺少运行时时展示中文提示。
