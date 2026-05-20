# 项目协作约定

## 协作原则

- 本文件只记录长期有效的项目约束、当前真实架构和已知限制；历史迭代、临时计划和排查记录写入 `docs/ai/context/`。
- 默认使用中文沟通、写文档和写注释；用户可见文案默认中文，仅品牌名和原始按键名可保留英文，例如 `SpeakMore`、`Right Alt`、`Right Shift`、`Space`。
- 修改前先明确 design / plan，并新增 `docs/ai/context/YYYYMMDD-HHMMSS-文件名.md` 记录背景、取舍和验证方式。
- 优先复用现有 `server/`、`electron-app/` 和 `electron-app/renderer/`，不要把逆向资料当作主要开发入口。
- 代码和测试是最终事实来源；如果本文件、README、上下文文档和代码冲突，先读代码与测试，再更新文档。

## 目录职责

- `server/`：本地 FastAPI 后端，负责音频上传、WebSocket 语音流、音频转码、ASR 转写和大模型文本处理。
- `electron-app/`：Electron 主进程、preload、本地兼容层、托盘、窗口、快捷键、自动粘贴、本地数据和 Windows 音频会话控制。
- `electron-app/renderer/`：Vite + React + MUI + TypeScript 前端，包含首页、历史记录、设置、诊断、录音状态机、悬浮胶囊和悬浮面板静态页面。
- `docs/ai/context/`：AI 上下文、设计、计划、验证和决策记录。新增内容只创建新文件，不覆盖、重命名或删除历史文件。
- `app-extracted/`：如果存在，只作为 Typeless 逆向参考资料和少量遗留资产来源；不要加载其中页面作为当前运行入口。修改图标相关逻辑前先检查 `electron-app/main.js` 是否仍引用其中资产。
- `experiments/`：如果存在，只放独立实验代码，不参与主应用运行链路。

## 当前真实架构

- 后端独立启动，Electron 只消费 `http://127.0.0.1:8000`，不负责自动拉起或关闭后端。
- 后端关键接口为 `GET /health`、`GET /ready`、`GET /models`、`POST /models/{model_id}/download`、`POST /models/{model_id}/cancel`、`DELETE /models/{model_id}`、`POST /models/{model_id}/select`、`POST /ai/voice_flow` 和 `WebSocket /ws/rt_voice_flow`。
- `/health` 表示后端进程存活；`/ready` 表示当前选择的 ASR 模型预热完成，语音链路可接收请求。
- 模型管理由后端 FastAPI 负责，Electron 只通过 `model:*` IPC 转发到后端 `/models` 接口，不直接下载、删除或选择 ASR 模型。
- 第一版模型管理只支持 `faster-whisper` 系列：`tiny`、`base`、`small`、`medium`、`large-v3`。
- 下载非当前模型不能影响当前语音链路，只有选择模型成功后才切换 ASR 单例。
- 删除当前使用的非 base ASR 模型前，后端必须先成功切换到已下载的 `base`；不能删除当前正在使用的 `base` 模型。
- 模型下载取消语义为“取消本次下载结果”：底层下载线程可能继续完成，完成后若已取消则清理该模型缓存。
- `electron-app/main.js` 加载 `electron-app/renderer/dist/index.html`、`floating-bar.html` 和 `floating-panel.html`。
- `electron-app/main.js` 是 Electron 主进程组合根，主要负责创建服务、依赖接线和生命周期注册；窗口、悬浮状态、IPC、本地数据、后端客户端、音频会话、文本观察和 Right Alt 监听逻辑应放在对应独立模块。
- 结构测试不能假设所有主进程逻辑都内联在 `main.js`，应检查 `main.js` 与拆分后的生产模块共同组成的主进程实现面。
- Windows 文本观察 helper 位于 `electron-app/windows-text-observer/`，只服务本轮粘贴后的短时自动学习，不参与基础录音链路。
- 前端修改后必须在 `electron-app/renderer/` 下运行 `npm run build`，再重启 Electron 验证。
- 主窗口关闭按钮只隐藏窗口到后台，托盘“退出”或真实应用退出才结束 Electron。
- 历史、设置、统计、日志和录音相关本地数据由 Electron 主进程写入 `app.getPath('userData')/local-data/`。
- 词典和自动学习候选也属于本地数据，由 Electron 主进程写入 `app.getPath('userData')/local-data/`，renderer 只能通过 IPC 访问。

## 语音链路约束

- 快捷键由 Windows 低级键盘监听器和 `shortcutGuard.ts` 处理，录音启动/停止基于释放边沿触发，不要对每次 `global-keyboard` 键态更新直接调用 `toggleRecording`。
- 当前固定快捷键：
  - `Right Alt`：听写。
  - `Right Alt + Space`：自由提问。
  - `Right Alt + Right Shift`：翻译。
  - `Escape`：取消当前未完成语音会话，或关闭当前悬浮面板。
- `Escape` 取消语音会话时不能发送 `end_audio`，不能自动粘贴，必须忽略迟到结果。
- 录音状态源由 `recorder.ts` 管理；悬浮胶囊只消费 `voice-state`，不要在悬浮胶囊里重新实现录音状态机。
- 悬浮胶囊录音波形只在 `electron-app/renderer/public/floating-bar.html` 展示，音量来自 `recorder.ts` 基于同一份 `MediaStream` 计算出的 `inputLevel`。
- 自由提问录音时悬浮胶囊显示 `请随意提出问题`；最终结果不自动粘贴、不进入首页最近结果，而是通过 `floating-panel` IPC 进入独立悬浮面板展示。
- 自由提问 `ask_anything` 当前先按“无工具安全版”设计：有 `selected_text` 时优先围绕选区执行翻译、解释、题目解答、总结、改写等任务；没有工具结果时不得编造天气、新闻、价格、政策等实时信息。
- 快捷键层只输出意图，不直接决定最终语音任务；最终任务由快捷键意图和启动前选区快照共同解析。
- UIA 是唯一可信选区来源；剪贴板读取不能参与“是否有选区”的模式判断，只能作为诊断或旧兼容能力。
- `Right Alt` 始终是普通听写并优先自动粘贴；是否有 UIA 选区都不能改变为翻译或自由提问。
- `Right Alt + Space` 永远是自由提问；有 UIA 选区时只把选区作为 `selected_text` 上下文，结果永远展示在悬浮卡片，不自动替换。
- `Right Alt + Right Shift` 是显式语音翻译；不因有选区而直接翻译选区，必须录音，完成后走普通粘贴链路把翻译结果贴到当前光标位置。
- 三种模式只要粘贴或替换失败，都必须把最终结果展示到悬浮卡片，不能让用户丢失结果。
- 自动粘贴前必须先确认当前存在可信文本输入目标；找不到光标或输入目标时，不得静默写剪贴板和发送 `Ctrl+V`，必须直接展示悬浮卡片。
- 自动粘贴成功后必须恢复用户原剪贴板内容，不能让 SpeakMore 的结果长期占用系统剪贴板。
- 如果同一轮键态里同时存在 `Space` 和 `RightShift`，优先按翻译意图处理，避免自由提问抢占翻译。
- `focused-context:get-selection-snapshot` 使用 Windows UI Automation 读取 confirmed 选区；`focused-context:get-selected-text` 的剪贴板读取只保留为旧兼容能力，必须尽量恢复原剪贴板。
- 普通听写和语音翻译启动前不得读取 UIA 选区；只有 `Right Alt + Space` 自由提问需要读取选区作为上下文。
- 自由提问未来如需回答实时问题，必须在后端增加意图分类和工具路由；不要只靠 prompt 假装具备联网、天气或网页检索能力。
- 翻译录音启动时，renderer 必须从本地设置读取 `translationTargetLanguage`，并通过 WebSocket `start_audio.parameters.output_language` 传给后端；当前支持 `en` 和 `ja`，语言集合以共享翻译目标语言元数据为准。
- 录音启动时可以并行准备后端 ready、设置和词典、WebSocket、麦克风；但 `start_audio` 只能在 `/ready` 成功和所有启动资源准备完成后发送，ready 失败或取消时必须清理已打开的麦克风和 WebSocket。
- 长按 `Right Alt` 的快捷键提示也通过 `floating-panel` IPC 和独立悬浮面板展示；提示优先级低于录音、转写、完成、取消和错误状态。
- 悬浮胶囊和悬浮面板不要依赖本机固定坐标，应基于当前显示器 `workArea` 计算并限制在屏幕内。
- WebSocket 语音流默认输入来自 `audio/webm;codecs=opus`；后端不能把未知音频头直接当 `.wav`，非 wav 输入必须先通过 `ffmpeg` 转码再喂 ASR。
- WebSocket 协议入口必须防御非法 JSON 和非对象参数；`parameters`、`audio_context` 等输入进入业务逻辑前必须归一化为对象。
- WebSocket 单轮音频处理失败也必须清空本轮音频块，不能让下一次 `end_audio` 重复处理旧音频。
- ASR 后端唯一使用 `faster-whisper`，默认选择模型为 `base`；不要恢复 Handy `ggml`、SenseVoice 或其他旧模型兼容逻辑。
- 模型扫描顺序固定为 `WHISPER_MODEL_DIR` → `%LOCALAPPDATA%\Typeless\models\faster-whisper` → `%USERPROFILE%\.cache\huggingface\hub` → 首次下载到 `%LOCALAPPDATA%\Typeless\models\faster-whisper`。
- `WHISPER_MODEL_DIR` 设置后视为显式模型目录覆盖，模型页必须禁用模型切换和删除。
- `WHISPER_MODEL` 设置后视为显式模型 ID 覆盖，模型页当前状态必须与 ASR 运行模型一致，并禁用模型切换和删除。
- 开发态 `uvicorn reload` 必须显式由环境变量 `UVICORN_RELOAD` 开启，不要在代码里默认写死 `reload=True`。
- 录音期间静音后台声音时，保持“短按开始、再次短按结束”的交互；Windows 上按音频会话静音，结束后只恢复本轮被 SpeakMore 主动静音的会话。
- 自动学习只能围绕 SpeakMore 本轮粘贴结果短时观察当前焦点控件，不允许做无差别全局文本采集；目标应用不支持 UIA 文本读取时，本轮学习应降级为不可用。

## 前端与用户体验约束

- 用户可见品牌为 `SpeakMore`。
- 主窗口页面为：首页、历史记录、词典、模型、设置、诊断。
- 主窗口 6 个页面的一级标题必须复用 `electron-app/renderer/src/uiTokens.ts` 中的 `pageSx` 和 `pageTitleSx`，标题左上基准以设置页为准，不要用 `mx: 'auto'` 造成页面切换时标题横向漂移。
- 词典页用于管理手动词条、自动添加词条和候选词条，应提供搜索、新增、启用/禁用、删除和候选确认入口。
- 首页“最近结果”展示非自由提问的最近三次最终转录/最终结果文字；实时状态只在悬浮胶囊展示。
- 首页“最近结果”、历史记录条目和自由提问悬浮结果都应提供复制入口；复制动作统一走 `clipboard:write-text` IPC，空结果不能复制占位符。
- 设置页目前包含固定快捷键展示、麦克风选择、界面语言、翻译目标语言、大模型 provider/API Key/模型配置、开机启动和版本信息；大模型配置必须通过“修改”进入编辑态，点击“保存”后写入本地设置并触发后端配置重载；翻译目标语言当前支持英文 `en` 和日语 `ja`。
- 诊断页应检查后端 `/health`、`/ready`、麦克风、系统信息和 IPC 自动粘贴能力。
- 不要用历史阶段标签扩大范围做整套页面重构、账户体系、云同步、自动更新或复杂快捷键编辑器；需要做这些功能时先单独设计。

## 数据与配置

- 大模型配置优先由设置页写入 Electron 主进程 `settings.json`，并随语音或文本请求通过 `parameters.llm` 传给后端；后端 `server/.env` 的 DeepSeek 配置只作为兼容回退。
- 大模型配置保存后由 Electron 主进程调用后端 `POST /config/reload`，用于刷新 `.env` 回退配置和清理旧 DeepSeek fallback client；不要把这个重载做成 ASR 模型重载或 Electron 自动重启后端。
- 当前支持的网络 provider 为 `DeepSeek`、`OpenAI`、`Z.AI`、`OpenRouter`、`Anthropic`、`Groq`、`Cerebras` 和 `Custom`；`Custom` 允许编辑兼容 OpenAI 的 Base URL。
- 不要把真实 API Key 写入仓库。Electron 本地 `settings.json` 是本机明文配置，不应作为同步或提交内容。
- `server/.env.example` 是环境变量模板，真实 `server/.env` 不提交。
- 历史记录和设置统一走 Electron 主进程 JSON 数据源，renderer 不应把这类业务数据写入 `localStorage`。
- 词典正式词条和自动学习候选统一走 Electron 主进程 JSON 数据源，renderer 不应把词典数据写入 `localStorage`。
- 本地设置包含 `translationTargetLanguage`，只允许共享翻译目标语言元数据中的语言代码，由主进程和 renderer 双侧归一化。
- 听写历史保存由 `AppShell` 这类全局常驻层订阅语音会话完成事件，不要放在首页、历史页等可切换页面组件里。
- 首页累计统计来自独立 `history-stats.json`，不得从最近 200 条 `history.json` 反推；历史列表裁剪不能影响累计听写时长、累计字数、平均速度和节省时间。
- 后端 `refiner.py` 不直接读取 Electron 本地词典文件；润色所需词条由 Electron 随语音请求参数传入，且只传启用词条。
- 大模型调用失败时，听写模式可以降级返回 ASR 原文；翻译和自由提问不能把原文伪装成成功结果，必须走错误返回。

## 已知限制

- 大模型 provider 默认模型只是首次配置建议，可能随服务商策略变化；如果调用失败，优先让用户在设置页修改模型名或 API Key，不要写死单一模型假设。
- 当前可信选区读取依赖 Windows UI Automation；目标应用不支持 UIA 选区时会按无选区处理。剪贴板读取不参与模式判断。
- 当前 `ask_anything` 只调用 DeepSeek 文本模型，没有联网搜索、天气查询或工具调用链路；实时信息问题必须明确能力边界。
- 当前没有单独的选区文本翻译快捷键；`Right Alt` 固定为听写，`Right Alt + Right Shift` 固定为语音翻译粘贴。翻译目标语言当前支持 `en` 和 `ja`。
- 首页“最近结果”的真实 UI 以 `electron-app/renderer/src/pages/Dashboard.tsx` 为准，修改前先读当前实现和测试，不要只依赖历史上下文。

## 验证命令

- 前端测试：`cd electron-app/renderer; npm test`
- 前端构建：`npm run renderer:build`
- 主进程语法检查：`node --check electron-app/main.js`
- 快捷键转发测试：`node --test electron-app/right-alt-relay.test.js`
- 历史统计测试：`node --test electron-app/history-stats-store.test.mjs`
- 后端核心语音协议验证：`npm run verify:voice`
- 后端全部测试：`cd server; python -m pytest -q`

根据改动范围选择验证命令；涉及前端运行产物时必须构建。

## 清理规则

- 可以删除可再生成产物：`node_modules/`、`__pycache__/`、`*.log`、`.pytest_cache/`、Vite/TypeScript 缓存和构建产物。
- 不要删除 `app-extracted/dist/`、`app-extracted/build/`、`app-extracted/lib/`、`app-extracted/drizzle/`，除非明确确认不再需要逆向参考或遗留资产。
- 不要删除、覆盖、重命名 `docs/ai/context/` 下的历史文档。
