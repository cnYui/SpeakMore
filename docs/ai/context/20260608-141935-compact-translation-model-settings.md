# 本地翻译模型设置区块简化

## 背景

用户反馈“本地翻译模型”区块比“语音模型”复杂太多：开关、引擎策略、GGUF 模型、运行时路径和长错误说明同时展示，导致设置页显得像调试面板。用户希望它沿用语音模型的产品思路：只呈现用户真正需要判断和操作的信息。

## 设计

- 沿用 `VoiceModelSettingsSection` 的结构密度：
  - 顶部一句说明 + 状态 chip。
  - 只展示“模型”和“缓存目录”。
  - 只保留“选择保存路径 / 下载或加载 / 刷新”。
- 底层仍保留 `translationEnginePreference`、`localTranslationModelEnabled` 和 runtime 状态，不删除数据结构或翻译引擎逻辑。
- runtime 缺失不再显示长红色技术说明；设置页只提示“运行时未就绪，自动模式会继续使用大模型翻译”。
- primary 按钮按状态切换：
  - 未下载：下载模型。
  - 已下载未加载：加载模型。
  - 已加载：模型已就绪。

## 取舍

- 不在日常设置页展示 `llama-server` 路径和来源，降低认知负担；runtime 细节仍可通过后端状态和日志排查。
- 不提供卸载按钮，保持和语音模型一致的轻量操作面；后台和 API 仍支持卸载。
- 不在本次改变本地翻译默认策略，仍保持 auto + fallback。

## 验证方式

- `cd electron-app/renderer; npm test`
- `npm run renderer:build`
- `node --check electron-app/main.js`
