# 设置真实化设计

## 背景

本轮目标是把设置页中已经暴露但还不完整的能力做成真实实现：

- 翻译目标语言不再只支持英文。
- 界面语言不再只是固定简体中文。
- DeepSeek API Key 输入框需要热更新后端配置。
- 开机启动开关需要反映系统真实登录项状态。

自由提问的 DeepSeek tool calls、联网搜索、天气工具、价格新闻查询不进入本轮。

## 当前真实状态

### 翻译目标语言

- `electron-app/renderer/src/services/settingsStore.ts` 中 `TranslationTargetLanguage` 只有 `'en'`。
- `electron-app/main.js` 中 `SUPPORTED_TRANSLATION_TARGET_LANGUAGES` 只有 `en`。
- `recorder.ts` 在翻译模式启动时读取 `translationTargetLanguage` 并通过 `start_audio.parameters.output_language` 传给后端。
- 后端 `server/refiner.py` 把 `parameters.output_language` 直接写入翻译 user message。

### 界面语言

- `preferredLanguage` 固定为 `zh-CN`。
- `navigation.ts`、页面组件、`voiceTypes.ts`、`diagnostics.ts`、`floating-bar.html`、`floating-panel.html` 中存在硬编码中文文案。
- `i18n:get-language` / `i18n:set-language` 存在，但主进程会强制回落到 `zh-CN`。

### DeepSeek API Key

- 设置页输入框只存在于 `Settings.tsx` 的组件 state。
- `server/runtime_config.py` 只在进程启动后执行一次 `load_dotenv`。
- `server/refiner.py` 使用模块级 `_client` 缓存 `AsyncOpenAI`，首次读取环境变量后不会自动更新。

### 开机启动

- 设置页切换时调用 `permission:update-auto-launch`。
- 主进程会调用 `app.setLoginItemSettings({ openAtLogin, path: process.execPath })`。
- 设置页初值来自本地 `settings.json`，没有调用 `app.getLoginItemSettings()` 回读系统真实状态。
- 如果系统层状态被外部修改，UI 会显示旧状态。

## 目标

- 设置页展示的状态必须来自真实数据源，不展示不可用的假配置。
- 所有设置变更要能立即影响后续语音链路或界面。
- 本地设置仍统一经 Electron 主进程 JSON 数据源管理。
- DeepSeek 密钥不进入仓库，不在 UI 中回显完整明文。
- 改动保持本地单机架构，不引入账户、云同步或复杂配置服务。

## 非目标

- 不实现 DeepSeek tool calls。
- 不实现网页搜索、天气、新闻、价格、政策等工具路由。
- 不做快捷键编辑器。
- 不做完整更新器。
- 不把 renderer 直接改成持有后端配置文件路径。

## 方案

### 1. 翻译目标语言

新增共享语言定义，renderer 和主进程保持同一组代码值。

首批支持：

- `en`：英文
- `zh-CN`：简体中文
- `ja`：日语
- `ko`：韩语
- `fr`：法语
- `de`：德语
- `es`：西班牙语

`settingsStore.ts` 负责归一化非法值。`electron-app/main.js` 再做一次归一化，防止旧设置文件或非 renderer IPC 写入非法值。

后端不需要持久化这个值；每次翻译请求仍通过 `parameters.output_language` 传入。为了提升翻译稳定性，renderer 发送语言代码，后端把代码映射为中文目标语言名后写入 user message，例如 `目标语言：日语 (ja)`。

### 2. 界面语言

采用轻量本地 i18n，不引入 `react-i18next` 之类大型依赖。

新增：

- `electron-app/renderer/src/services/i18n.ts`
- `electron-app/renderer/src/services/i18n.test.ts`

核心接口：

```ts
export type InterfaceLanguage = 'zh-CN' | 'en-US'

export function normalizeInterfaceLanguage(value: unknown): InterfaceLanguage
export function t(language: InterfaceLanguage, key: TranslationKey, params?: Record<string, string | number>): string
```

迁移范围：

- 导航：`首页`、`历史记录`、`设置`、`诊断`
- 首页：标题、快捷键提示、统计项、最近结果、复制 aria-label
- 历史：标题、搜索占位、空状态、清除按钮
- 设置：所有区域标题、字段标签、按钮和选项显示名
- 诊断页和 `diagnostics.ts`：诊断项名称和消息
- 录音错误和状态文案：`voiceTypes.ts`
- 悬浮胶囊和悬浮面板：通过主进程广播 `i18n:language-changed` 后重新渲染文案

语言切换流程：

1. 设置页选择 `preferredLanguage`。
2. renderer 调用 `settings:update` 保存。
3. 主进程归一化后写入 `settings.json`，并广播 `i18n:language-changed` 给主窗口、悬浮条和悬浮面板。
4. React 侧用语言状态重新渲染。
5. 静态悬浮 HTML 接收事件后用本地字典重新渲染。

`preferredLanguage` 首批支持 `zh-CN` 和 `en-US`。默认值仍是 `zh-CN`，避免破坏现有中文体验。

### 3. DeepSeek API Key 热更新

新增后端运行时配置能力：

- `server/runtime_config.py`
  - 读取 `server/.env`
  - 更新或新增 `DEEPSEEK_API_KEY`
  - 更新进程环境变量
  - 返回脱敏状态
- `server/refiner.py`
  - 增加 `reset_client()`
  - `_get_client()` 每次使用当前环境变量创建缓存 client
- `server/main.py`
  - `GET /config/deepseek`
  - `POST /config/deepseek`

接口行为：

- `GET /config/deepseek` 只返回是否已配置、尾号后四位，不返回完整 Key。
- `POST /config/deepseek` 接收 `{ "api_key": "..." }`。
- 空字符串表示清空本地配置。
- 更新成功后调用 `refiner.reset_client()`，下一次 DeepSeek 请求使用新 Key。
- 写入 `server/.env` 时只更新 `DEEPSEEK_API_KEY`，保留其他环境变量。

Electron renderer 不直接写文件，只调用主进程 IPC；主进程再请求后端配置接口。这样后续如果后端地址或鉴权策略调整，renderer 不需要知道细节。

新增 IPC：

- `deepseek:get-config`
- `deepseek:update-api-key`

设置页展示：

- 初始加载显示 `已配置` / `未配置`。
- 密码框为空，placeholder 根据状态显示。
- 点击保存后调用 `deepseek:update-api-key`。
- 保存成功后清空输入框并刷新脱敏状态。

### 4. 开机启动

新增主进程函数：

```js
function readAutoLaunchEnabled() {
  return Boolean(app.getLoginItemSettings().openAtLogin)
}
```

IPC：

- `permission:get-auto-launch`：返回 `{ enabled: boolean }`
- `permission:update-auto-launch`：调用 `app.setLoginItemSettings()`，再用 `getLoginItemSettings()` 回读确认，返回 `{ enabled: boolean }`

设置页加载时：

1. 先读取 `settings:get`。
2. 再调用 `permission:get-auto-launch` 覆盖 `launchAtSystemStartup`。
3. 如系统状态与本地设置不一致，调用 `settings:update` 同步本地 JSON。

切换时：

1. 先乐观更新 UI。
2. 调用 `permission:update-auto-launch`。
3. 成功后用返回状态写入本地设置。
4. 失败后回滚到旧状态并显示错误文案。

## 数据流

### 翻译目标语言

```text
Settings.tsx -> settings:update -> settings.json
recorder.ts -> getTranslationTargetLanguage() -> start_audio.parameters.output_language
server/main.py -> refine_text(parameters.output_language) -> DeepSeek
```

### 界面语言

```text
Settings.tsx -> settings:update(preferredLanguage)
main.js -> settings.json + i18n:language-changed
React components -> t(language, key)
floating HTML -> receive event -> local dictionary render
```

### DeepSeek API Key

```text
Settings.tsx -> deepseek:update-api-key IPC
main.js -> POST http://127.0.0.1:8000/config/deepseek
server/runtime_config.py -> update server/.env + os.environ
server/refiner.py -> reset cached AsyncOpenAI client
```

### 开机启动

```text
Settings.tsx -> permission:get-auto-launch
main.js -> app.getLoginItemSettings()
Settings.tsx -> permission:update-auto-launch
main.js -> app.setLoginItemSettings() -> app.getLoginItemSettings()
```

## 错误处理

- 翻译目标语言非法：renderer 和 main 都回落到 `en`。
- 界面语言非法：renderer 和 main 都回落到 `zh-CN`。
- i18n 缺 key：返回 key 本身，测试覆盖所有使用的 key，避免 UI 静默空白。
- DeepSeek 配置接口不可达：设置页显示后端未启动，不改本地输入。
- DeepSeek Key 保存失败：保留输入，显示错误。
- 开机启动写入失败：回滚 UI 到系统回读状态。

## 测试策略

### renderer

- `settingsStore` 归一化多语言和翻译目标语言。
- `i18n` 字典 key 完整性、参数替换和非法语言回退。
- `Settings.tsx` 结构测试覆盖新增语言选项、DeepSeek 保存入口、开机启动回读 IPC。
- `recorder` 现有测试扩展：翻译模式使用非英文目标语言时正确发送 `output_language`。

### Electron 主进程

- 新增可导出的纯函数，测试：
  - 本地设置归一化接受新语言。
  - `readAutoLaunchEnabled` 读取 `getLoginItemSettings().openAtLogin`。
  - `updateAutoLaunch` 写入后回读状态。

### server

- `runtime_config` 测试：
  - `.env` 中新增/更新/清空 `DEEPSEEK_API_KEY`。
  - 保留其他变量。
- `refiner` 测试：
  - `reset_client()` 后下一次 `_get_client()` 使用新环境变量。
  - 翻译 user message 使用语言显示名。
- `main` 测试：
  - `GET /config/deepseek` 不泄露完整 Key。
  - `POST /config/deepseek` 更新配置并触发 client reset。

## 实施顺序

1. 翻译目标语言扩展。
2. 开机启动真实状态回读。
3. DeepSeek API Key 热更新。
4. 界面语言 i18n。

这个顺序先完成风险较低的设置数据流，再做后端配置，最后迁移 UI 文案，避免 i18n 改动掩盖行为问题。

## 参考依据

- Electron `app.getLoginItemSettings()` / `app.setLoginItemSettings()` 是官方登录项 API。
- DeepSeek API Key 是 OpenAI SDK `AsyncOpenAI(api_key=...)` 初始化参数；当前项目已经用该方式创建 client。

## 自检

- 无工具调用：本设计没有引入 DeepSeek tool calls。
- 无实时搜索：本设计没有引入联网工具。
- 无假状态：四个设置项都以真实数据源为准。
- 与当前架构兼容：仍由 Electron 主进程管理本地设置，后端只暴露必要配置接口。
