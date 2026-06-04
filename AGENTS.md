# 项目协作约定

## 协作原则

- 本文件只记录长期有效的项目约束、当前真实架构和已知限制；历史迭代、临时计划和排查记录写入 `docs/ai/context/`。
- 默认使用中文沟通、写文档和写注释；用户可见文案默认中文，仅品牌名和原始按键名可保留英文，例如 `SpeakMore`、`Right Alt`、`Right Shift`、`Option`、`Space`。
- 修改前先明确 design / plan，并新增 `docs/ai/context/YYYYMMDD-HHMMSS-文件名.md` 记录背景、取舍和验证方式。
- 优先复用现有 `server/`、`electron-app/` 和 `electron-app/renderer/`，不要把逆向资料当作主要开发入口。
- 代码和测试是最终事实来源；如果本文件、README、上下文文档和代码冲突，先读代码与测试，再更新文档。

## 目录职责

- `server/`：本地 FastAPI 后端，负责音频上传、WebSocket 语音流、音频转码、ASR 转写和大模型文本处理。
- `electron-app/`：Electron 主进程、preload、本地兼容层、托盘、窗口、快捷键、结果交付、本地数据、Windows 音频会话控制和 macOS 开发态适配。
- `electron-app/renderer/`：Vite + React + MUI + TypeScript 前端，包含首页、历史记录、词典、设置、录音状态机、悬浮胶囊和悬浮面板静态页面。
- `docs/ai/context/`：AI 上下文、设计、计划、验证和决策记录。新增内容只创建新文件，不覆盖、重命名或删除历史文件。
- `experiments/`：如果存在，只放独立实验代码，不参与主应用运行链路。

## 当前真实架构

- 开发态后端独立启动，Electron 只消费 `http://127.0.0.1:8000`；打包态 Electron 负责拉起和关闭内置后端进程。
- 开发态后端通过 `npm run server` 启动时必须优先使用 `server/.venv` 中的 Python；不要直接依赖裸 `python main.py`，避免误用 Conda 或系统 Python 导致 `funasr` 等 ASR 依赖缺失。
- 开发启动脚本只做前置检查和进程拉起，不自动安装依赖；缺少 `server/.venv`、后端核心包、根目录 Electron 依赖或 renderer `dist/index.html` 时必须快速失败并提示明确准备命令。
- `main` 是统一源码主线，保留 Windows 和 macOS 源码、测试、配置、打包脚本和发布说明；ZIP、DMG、EXE、APP、blockmap、`release/` 和 `release-artifacts/` 等打包产物不得提交到仓库，正式产物只上传 GitHub Releases。
- 发布准备应从 `main` 拉 `release/vX.Y.Z` 分支处理版本号、签名、公证和 release note；不要创建用于长期保存打包产物的 Git 分支。
- macOS 打包态应用名必须设置为 `SpeakMore`，确保 `app.getPath('userData')` 指向 `~/Library/Application Support/SpeakMore`；设置页保存 `asrDeviceMode=mps` 后，用户真实退出并重开 App 时，Electron 必须按该设置给内置后端注入 `FUNASR_DEVICE=mps`；Windows 设置页保存 `asrDeviceMode=cuda` 后，打包态 Electron 必须给内置后端注入 `FUNASR_DEVICE=cuda:0`。
- 后端关键接口为 `GET /health`、`GET /model/status`、`POST /model/download`、`GET /ready`、`POST /config/reload`、`POST /ai/voice_flow` 和 `WebSocket /ws/rt_voice_flow`。
- `/health` 表示后端进程存活；`/model/status` 表示 SenseVoiceSmall 初始化状态；`/ready` 表示当前 ASR 模型已加载完成，语音链路可接收请求。
- 旧模型管理能力已删除，Electron 不再注册 `model:*` IPC，也不提供模型切换、删除或选择入口；当前只允许单模型初始化页触发 SenseVoiceSmall 下载/加载。
- 当前正式 ASR 模型只支持 `FunAudioLLM/SenseVoiceSmall`，用户可见层只有“初始化”页的单模型下载/加载入口。
- `sensevoice-small` 通过 FunASR `SenseVoiceSmall` 接入，不描述为原生在线 streaming；后端通过累计音频伪流式输出维持现有 WebSocket 协议。
- ASR 运行时通过 `FUNASR_DEVICE` 选择设备；空值保持默认稳定策略，优先 CUDA，最后 CPU，不自动启用 MPS；`auto` 时优先 CUDA，其次 macOS MPS，最后 CPU；显式 `cuda` / `cuda:0` / `mps` 不可用或非 CPU 初始化失败时必须回退 CPU；MPS 仍是 Apple Silicon 实验加速路径，不承诺性能指标；`/model/status` 和 `/ready` 暴露 `device`、`requested_device`、`device_source` 和 `fallback_reason`；模型扫描顺序固定为 `SENSEVOICE_SMALL_MODEL_DIR` → 用户设置的 `modelCacheDir` / 后端 `TYPELESS_MODEL_CACHE_DIR` → 平台默认模型目录（Windows `%LOCALAPPDATA%\Typeless\models\funasr`，macOS `~/Library/Application Support/SpeakMore/models/funasr`）→ `%USERPROFILE%\.cache\huggingface\hub` 或当前用户 Hugging Face cache → 初始化页点击下载到用户设置的 `modelCacheDir`，未设置时下载到平台默认模型目录。
- `electron-app/main.js` 加载 `electron-app/renderer/dist/index.html`、`floating-bar.html` 和 `floating-panel.html`。
- `electron-app/main.js` 是 Electron 主进程组合根，主要负责创建服务、依赖接线和生命周期注册；窗口、悬浮状态、IPC、本地数据、后端客户端、音频会话、文本观察和 Right Alt 监听逻辑应放在对应独立模块。
- `electron-app/main-ipc-registry.js` 负责按上下文注册 IPC，主进程只注入依赖，不在 `main.js` 里直接拼装各通道业务逻辑。
- `electron-app/voice-backend-client.js` 是主进程与语音后端的统一 HTTP facade，配置重载和语音流协议分别拆到 `voice-config-client.js`、`voice-flow-form-data.js` 和 `voice-backend-urls.js`。
- Windows 托盘图标由 `electron-app/assets/tray-placeholder.png` 提供，并通过 `electron-app/app-paths.js` 暴露给主进程。
- 结构测试不能假设所有主进程逻辑都内联在 `main.js`，应检查 `main.js` 与拆分后的生产模块共同组成的主进程实现面。
- Windows 文本观察 helper 位于 `electron-app/windows-text-observer/`，只服务本轮粘贴后的短时自动学习，不参与基础录音链路。
- macOS 开发态 Option 监听 helper 位于 `electron-app/macos-option-listener.c`，当前只服务开发态 MVP；主进程启动时用 `clang` 编译到本机临时目录，再把 macOS 右侧 `Option` 组合映射成既有 `global-keyboard` 事件，不改变 renderer 录音状态机协议；左侧 `Option` 不应触发提示、录音或模式切换。
- macOS 平台能力 helper 位于 `electron-app/macos-platform-helper.m`，由 `electron-app/macos-platform-capabilities.js` 按需编译和调用；当前用于 Accessibility 权限状态、前台应用、可输入目标、AX selected text、AX focused text 观察、剪贴板恢复和受控 `Cmd+V`。
- `electron-app/renderer/src/components/AppShell.tsx` 只承担全局壳层和持久化订阅，页面状态拆到 `useGlobalShortcutBridge`、`useVoiceHistoryPersistence` 和 `useSettingsPageState` 之类的专用 hook。
- 前端修改后必须在 `electron-app/renderer/` 下运行 `npm run build`，再重启 Electron 验证。
- macOS 本地打包入口为 `npm run build:app:mac`，内容检查为 `npm run verify:app:mac`，MPS 重启生效烟测为 `npm run smoke:app-mps:mac`；公开 release 入口为 `npm run build:release:mac`，必须提供 Developer ID 签名和 Apple notarization 凭证。
- 主窗口关闭按钮只隐藏窗口到后台，托盘“退出”或真实应用退出才结束 Electron。
- 历史、设置、统计、日志和录音相关本地数据由 Electron 主进程写入 `app.getPath('userData')/local-data/`。
- 词典和自动学习候选也属于本地数据，由 Electron 主进程写入 `app.getPath('userData')/local-data/`，renderer 只能通过 IPC 访问。
- `electron-app/renderer/src/services/recorder.ts` 是语音状态机 facade 和唯一对外入口；会话状态、音频运行时和生命周期边界分别拆到 `electron-app/renderer/src/services/voice/voiceSessionStore.ts`、`recordingTransportRuntime.ts` 和 `voiceSessionLifecycle.ts`，其余语音链路内部模块仍放在 `electron-app/renderer/src/services/voice/` 下的 `recordingStartup.ts`、`voiceSocket.ts`、`voiceResultDelivery.ts`、`voiceSessionUtils.ts`、`backgroundAudio.ts`、`audioCapture.ts` 和 `audioLevelMonitor.ts`。

## 语音链路约束

- 快捷键由平台监听器和 `shortcutGuard.ts` 处理，录音启动/停止基于释放边沿触发，不要对每次 `global-keyboard` 键态更新直接调用 `toggleRecording`。
- Windows 当前固定快捷键：
  - `Right Alt`：听写。
  - `Right Alt + Space`：自由提问。
  - `Right Alt + Right Shift`：翻译。
  - `Escape`：取消当前未完成语音会话，或关闭当前悬浮面板。
- macOS 开发态 MVP 固定快捷键：
  - 右侧 `Option`：听写。
  - 右侧 `Option + Space`：自由提问。
  - 右侧 `Option + Shift`：翻译。
  - 左侧 `Option`：无触发条件，不显示提示，不启动录音。
  - `Escape`：取消当前未完成语音会话，或关闭当前悬浮面板。
- `Escape` 取消语音会话时不能发送 `end_audio`，不能自动粘贴，必须忽略迟到结果。
- 录音状态源由 `recorder.ts` 管理；悬浮胶囊只消费 `voice-state`，不要在悬浮胶囊里重新实现录音状态机。
- 悬浮胶囊录音波形只在 `electron-app/renderer/public/floating-bar.html` 展示，音量来自 `electron-app/renderer/src/services/voice/audioLevelMonitor.ts` 基于同一份 `MediaStream` 计算出的 `inputLevel`，并由 `recorder.ts` 统一写入会话状态。
- 自由提问录音时悬浮胶囊显示 `请随意提出问题`；最终结果不自动粘贴、不进入首页最近结果，而是通过 `floating-panel` IPC 进入独立悬浮面板展示。
- 自由提问 `ask_anything` 当前先按“无工具安全版”设计：有 `selected_text` 时优先围绕选区执行翻译、解释、题目解答、总结、改写等任务；没有工具结果时不得编造天气、新闻、价格、政策等实时信息。
- 快捷键层只输出意图，不直接决定最终语音任务；最终任务由快捷键意图和启动前选区快照共同解析。
- Windows UIA 和 macOS AX confirmed 选区是最高可信选区来源；剪贴板读取不能参与“是否有选区”的模式判断，只能在自由提问且 confirmed 选区不可用时作为低可信 `selected_text` fallback。macOS 当前先不启用剪贴板选区 fallback。
- `Right Alt` 始终是普通听写并优先自动粘贴；是否有 UIA 选区都不能改变为翻译或自由提问。
- `Right Alt + Space` 永远是自由提问；有 UIA confirmed 选区时优先把选区作为 `selected_text` 上下文，UIA 无 confirmed 选区但剪贴板 fallback 成功时可作为低可信 `selected_text` 上下文，结果永远展示在悬浮卡片，不自动替换。
- `Right Alt + Right Shift` 是显式语音翻译；不因有选区而直接翻译选区，必须录音，完成后走普通粘贴链路把翻译结果贴到当前光标位置。
- macOS 阶段四支持普通听写和语音翻译在可信输入目标中自动粘贴，失败时展示悬浮面板；右侧 `Option + Space` 自由提问会读取 AX confirmed 选区并作为 `selected_text` 上下文，结果仍固定展示悬浮面板；自动学习只在 macOS 自动粘贴成功后围绕本轮 focused text target 短时观察。
- 三种模式只要粘贴或替换失败，都必须把最终结果展示到悬浮卡片，不能让用户丢失结果。
- 自动粘贴前必须先确认当前存在可信文本输入目标；找不到光标或输入目标时，不得静默写剪贴板和发送 `Ctrl+V`，必须直接展示悬浮卡片。
- 自动粘贴前的输入目标判定按四层收敛：`UIA confirmed` -> `Win32 caret confirmed` -> `app_compat` 弱可信应用族兜底 -> 悬浮卡片；不要把“前台窗口存在”当成可粘贴条件，第三层只在 allowlist 应用族且弱信号充分时放行。当前 allowlist 只做显式应用族匹配，包含微信、QQ、Discord、Codex、Claude Code、ChatGPT、VS Code、Cursor、Slack、Notion、Spotify，不把所有 Electron / Chromium 一刀切放开。
- 自动粘贴成功后必须恢复用户原剪贴板内容，不能让 SpeakMore 的结果长期占用系统剪贴板。
- 如果同一轮键态里同时存在 `Space` 和 `RightShift`，优先按翻译意图处理，避免自由提问抢占翻译。
- `focused-context:get-selection-snapshot` 在 Windows 使用 UI Automation 读取 confirmed 选区，读取顺序为 `FocusedElement` 的 TextPattern、前台窗口 Document/TextPattern 子树扫描、剪贴板 fallback；在 macOS 使用 Accessibility API 读取 focused element 的 selected text，当前不启用剪贴板 fallback；`focused-context:get-selected-text` 的剪贴板读取只保留为旧兼容能力，必须尽量恢复原剪贴板。
- 普通听写和语音翻译启动前不得读取 UIA、AX 或剪贴板选区；只有自由提问需要读取选区作为上下文。
- 自由提问未来如需回答实时问题，必须在后端增加意图分类和工具路由；不要只靠 prompt 假装具备联网、天气或网页检索能力。
- 翻译录音启动时，renderer 必须从本地设置读取 `translationTargetLanguage`，并通过 WebSocket `start_audio.parameters.output_language` 传给后端；当前支持 `en` 和 `ja`，语言集合以共享翻译目标语言元数据为准。
- 后端翻译模式必须在进入大模型前显式归一化目标语言；`output_language` 缺失、为空或未知时回退 `en`，且 prompt 中必须包含目标语言字段，避免模型回答“未指定目标语言/无法翻译”。
- 录音启动必须先校验当前大模型 provider 的 API Key；未填写时直接拦截并提示，不得打开麦克风、连接 WebSocket 或等待后端 ready。API Key 已配置后，可以并行准备后端 ready、词典、WebSocket 和麦克风；模型未下载时必须返回 `voice_model_missing` 并提示先下载模型；`start_audio` 只能在 `/ready` 成功和所有启动资源准备完成后发送，ready 失败或取消时必须清理已打开的麦克风和 WebSocket。
- 长按 `Right Alt` 的判定阈值为 `350ms`；快捷键提示也通过 `floating-panel` IPC 和独立悬浮面板展示，提示优先级低于录音、转写、完成、取消和错误状态。
- 悬浮胶囊和悬浮面板不要依赖本机固定坐标，应基于当前显示器 `workArea` 计算并限制在屏幕内。
- 悬浮胶囊和悬浮面板每次唤醒或显示时都必须重新提升置顶层级；macOS 需要刷新 `alwaysOnTop` 层级状态后再 `moveTop()`，但不能调用 `focus()` 抢走当前输入焦点。
- 悬浮胶囊外层透明窗口大小应贴合 `floating-bar.html` 中文字加粒子球的可见布局，当前为 `220x224`；不要恢复大面积透明背景，否则会拦截背后应用点击。
- WebSocket 语音流固定输入来自 `16kHz`、单声道、`pcm_s16le` 二进制 chunk，并在 `start_audio.parameters.audio_format` 声明 `{ type: "pcm_s16le", sample_rate: 16000, channels: 1 }`；`/ai/voice_flow` 兼容入口可以接受上传音频，但后端也必须先转成 PCM16 再喂给 SenseVoiceSmall。
- WebSocket 协议入口必须防御非法 JSON 和非对象参数；`parameters`、`audio_context` 等输入进入业务逻辑前必须归一化为对象。
- WebSocket 单轮音频处理失败也必须清空本轮音频块，不能让下一次 `end_audio` 重复处理旧音频。
- ASR 后端只支持 `sensevoice-small`，不要恢复旧模型兼容逻辑。
- 开发态 `uvicorn reload` 必须显式由环境变量 `UVICORN_RELOAD` 开启，不要在代码里默认写死 `reload=True`。
- 录音期间静音后台声音时，保持“短按开始、再次短按结束”的交互；Windows 上按音频会话静音，结束后只恢复本轮被 SpeakMore 主动静音的会话。
- 自动学习只能围绕 SpeakMore 本轮粘贴结果短时观察当前焦点控件，不允许做无差别全局文本采集；目标应用不支持 Windows UIA 或 macOS AX focused text 读取时，本轮学习应降级为不可用。
- 自动学习候选只允许短词或短语级纠错；整句改写、问答命令、摘要结果或无上下文的大段替换不能写入候选词典。

## 前端与用户体验约束

- 用户可见品牌为 `SpeakMore`。
- 主窗口页面为：初始化、首页、历史记录、词典、设置。
- 托盘菜单只保留“打开主窗口”和“退出”；悬浮胶囊由语音状态和快捷键流程驱动，不提供“显示悬浮条”手动菜单入口。
- 主窗口四页和侧边栏的静态界面文案通过 `electron-app/renderer/src/i18n.tsx` 切换，当前支持 `zh-CN` 和 `en-US`；悬浮胶囊、悬浮面板、托盘、后端错误和用户数据内容不属于该界面语言切换范围。
- 主窗口页面的一级标题必须复用 `electron-app/renderer/src/uiTokens.ts` 中的 `pageSx` 和 `pageTitleSx`，标题左上基准以设置页为准，不要用 `mx: 'auto'` 造成页面切换时标题横向漂移。
- 词典页用于管理手动词条、自动添加词条和候选词条，应提供搜索、新增、启用/禁用、删除和候选确认入口。
- 首页“整体个性化”只展示基于累计听写时长、累计听写字数和启用正式词条数计算出的百分比；公式采用 `score(value, anchor) = min(1, max(0, value / anchor) ^ 0.55)`，锚点为 `60000` 分钟、`10000000` 字和 `2000` 个启用词条，权重为时长 `25%`、字数 `30%`、词条 `45%`；候选词和停用词不计入分数，该分数只用于首页展示，不改变 prompt 词典裁剪。
- 首页“最近结果”展示非自由提问的最近三次最终转录/最终结果文字；实时状态只在悬浮胶囊展示。
- 首页“最近结果”、历史记录条目和自由提问悬浮结果都应提供复制入口；复制动作统一走 `clipboard:write-text` IPC，空结果不能复制占位符。
- 初始化页展示 SenseVoiceSmall 下载/加载状态，并通过 `voice-model:get-status`、`voice-model:start-download` IPC 触发单模型初始化；设置页目前包含固定快捷键展示、麦克风选择、界面语言、翻译目标语言和大模型 provider/API Key/模型配置；开机启动入口暂时不展示，`permission:update-auto-launch` 不应写入系统登录项；大模型配置必须通过“修改”进入编辑态，点击“保存”后写入本地设置并触发后端配置重载；翻译目标语言当前支持英文 `en` 和日语 `ja`。
- 不要用历史阶段标签扩大范围做整套页面重构、账户体系、云同步、自动更新或复杂快捷键编辑器；需要做这些功能时先单独设计。

## 数据与配置

- 大模型配置优先由设置页写入 Electron 主进程 `settings.json`，并随语音或文本请求通过 `parameters.llm` 传给后端；后端 `server/.env` 的 DeepSeek 配置只作为兼容回退。
- 大模型配置保存后由 Electron 主进程调用后端 `POST /config/reload`，用于刷新 `.env` 回退配置和清理旧 DeepSeek fallback client；不要把这个重载做成 ASR 模型重载或 Electron 自动重启后端。
- 当前支持的网络 provider 为 `DeepSeek`、`OpenAI`、`Z.AI`、`OpenRouter`、`Anthropic`、`Groq`、`Cerebras` 和 `Custom`；`Custom` 允许编辑兼容 OpenAI 的 Base URL。
- 大模型 provider 元数据唯一来源是 `shared/llm-providers.json`；主进程 `electron-app/settings-store.js` 和 renderer `settingsStore.ts` 都必须从该共享 JSON 派生默认配置，不要重新内联 provider 列表。
- 不要把真实 API Key 写入仓库。Electron 本地 `settings.json` 是本机明文配置，不应作为同步或提交内容。
- 默认设置不得包含任何真实 API Key；未填写当前 provider API Key 时，语音链路必须在 renderer 启动阶段返回 `llm_api_key_missing`。
- `server/.env.example` 是环境变量模板，真实 `server/.env` 不提交。
- 历史记录和设置统一走 Electron 主进程 JSON 数据源，renderer 不应把这类业务数据写入 `localStorage`。
- 词典正式词条和自动学习候选统一走 Electron 主进程 JSON 数据源，renderer 不应把词典数据写入 `localStorage`。
- 词典页通过主进程 `dictionary:changed` 事件实时刷新自动学习候选和自动词条；页面只展示结果列表，不展示自动学习过程、观察失败原因或用户文本片段。
- 发给后端大模型 prompt 的词典不应整表注入；后续实现时间衰减时默认每轮最多发送 24 条，可配置范围为 8 到 40 条，硬上限 40 条。手动词条不应天然永久高优先级，排序应由动态 score 决定。
- 本地设置包含 `translationTargetLanguage`，只允许共享翻译目标语言元数据中的语言代码，由主进程和 renderer 双侧归一化。
- 本地设置包含 `modelCacheDir`，用于保存用户选择的 SenseVoiceSmall 下载目录；Electron 查询模型状态、触发下载和打包后端启动时都必须把该目录传给后端。该值是本机路径，不得写入仓库或文档示例之外的共享配置。
- 本地设置包含 `asrDeviceMode`，只允许 `default`、`mps`、`cuda` 和 `cpu`；macOS 设置页展示 `默认 / MPS / CPU`，Windows 设置页展示 `默认 / CUDA / CPU`；打包态 Electron 启动后端时把 `mps`、`cuda`、`cpu` 分别映射为 `FUNASR_DEVICE=mps`、`FUNASR_DEVICE=cuda:0`、`FUNASR_DEVICE=cpu`；`default` 不主动启用 MPS，仍由后端默认策略优先 CUDA 后 CPU；设置保存后需要重启语音后端或应用生效，不做运行中热切换。
- 听写历史保存由 `AppShell` 这类全局常驻层订阅语音会话完成事件，不要放在首页、历史页等可切换页面组件里。
- 首页累计统计来自独立 `history-stats.json`，不得从最近 200 条 `history.json` 反推；历史列表裁剪不能影响累计听写时长、累计字数、平均速度和节省时间。
- 后端 `refiner.py` 不直接读取 Electron 本地词典文件；润色所需词条由 Electron 随语音请求参数传入，且只传启用词条。
- 大模型调用失败时，听写模式可以降级返回 ASR 原文；翻译和自由提问不能把原文伪装成成功结果，必须走错误返回。
- 翻译失败的用户可见文案必须按翻译语义展示，不能沿用“润色失败，保留原文”这类听写兜底描述。

## 已知限制

- 大模型 provider 默认模型只是首次配置建议，可能随服务商策略变化；如果调用失败，优先让用户在设置页修改模型名或 API Key，不要写死单一模型假设。
- Windows CUDA 选项只适用于 NVIDIA CUDA 环境；Intel Arc 等非 NVIDIA GPU 不会因为选择 CUDA 自动获得加速，后端会回退 CPU 并通过 `/model/status.fallback_reason` 暴露原因。
- 当前 Windows 可信选区读取依赖 Windows UI Automation；目标应用不支持 UIA 选区时会按无选区处理。当前 macOS 可信选区读取依赖 Accessibility API focused element selected text；目标应用不暴露 AX selected text 时会按无选区处理。
- 当前 `ask_anything` 只调用 DeepSeek 文本模型，没有联网搜索、天气查询或工具调用链路；实时信息问题必须明确能力边界。
- 当前没有单独的选区文本翻译快捷键；`Right Alt` 固定为听写，`Right Alt + Right Shift` 固定为语音翻译粘贴。翻译目标语言当前支持 `en` 和 `ja`。
- 首页“最近结果”的真实 UI 以 `electron-app/renderer/src/pages/Dashboard.tsx` 为准，修改前先读当前实现和测试，不要只依赖历史上下文。

## 验证命令

- 前端测试：`cd electron-app/renderer; npm test`
- 前端构建：`npm run renderer:build`
- 开发启动前置检查测试：`node --test scripts/dev-prereqs.test.mjs`
- 本地开发前置检查：`npm run doctor`
- 主进程语法检查：`node --check electron-app/main.js`
- 快捷键转发测试：`node --test electron-app/right-alt-relay.test.js`
- 历史统计测试：`node --test electron-app/history-stats-store.test.mjs`
- 后端核心语音协议验证：`npm run verify:voice`
- 后端全部测试：`cd server; python -m pytest -q`
- macOS 本地打包验证：`npm run build:app:mac`
- macOS 打包内容检查：`npm run verify:app:mac`
- macOS MPS 重启生效烟测：`npm run smoke:app-mps:mac`

根据改动范围选择验证命令；涉及前端运行产物时必须构建。

## 清理规则

- 可以删除可再生成产物：`node_modules/`、`__pycache__/`、`*.log`、`.pytest_cache/`、Vite/TypeScript 缓存和构建产物。
- 不要删除、覆盖、重命名 `docs/ai/context/` 下的历史文档。
