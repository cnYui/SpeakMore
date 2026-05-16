# 项目协作约定

## 协作原则

- 本文件只记录长期有效的项目约束、当前真实架构和已知限制；历史迭代、临时计划和排查记录写入 `docs/ai/context/`。
- 默认使用中文沟通、写文档和写注释；用户可见文案默认中文，仅品牌名和原始按键名可保留英文，例如 `SpeakMore`、`Right Alt`、`Right Shift`、`Space`。
- 修改前先明确 design / plan，并新增 `docs/ai/context/YYYYMMDD-HHMMSS-文件名.md` 记录背景、取舍和验证方式。
- 优先复用现有 `server/`、`electron-app/` 和 `electron-app/renderer/`，不要把逆向资料当作主要开发入口。
- 代码和测试是最终事实来源；如果本文件、README、上下文文档和代码冲突，先读代码与测试，再更新文档。

## 目录职责

- `server/`：本地 FastAPI 后端，负责音频上传、WebSocket 语音流、音频转码、ASR 转写和 DeepSeek 文本处理。
- `electron-app/`：Electron 主进程、preload、本地兼容层、托盘、窗口、快捷键、自动粘贴、本地数据和 Windows 音频会话控制。
- `electron-app/renderer/`：Vite + React + MUI + TypeScript 前端，包含首页、历史记录、设置、诊断、录音状态机、悬浮胶囊和悬浮面板静态页面。
- `docs/ai/context/`：AI 上下文、设计、计划、验证和决策记录。新增内容只创建新文件，不覆盖、重命名或删除历史文件。
- `app-extracted/`：如果存在，只作为 Typeless 逆向参考资料和少量遗留资产来源；不要加载其中页面作为当前运行入口。修改图标相关逻辑前先检查 `electron-app/main.js` 是否仍引用其中资产。
- `experiments/`：如果存在，只放独立实验代码，不参与主应用运行链路。

## 当前真实架构

- 后端独立启动，Electron 只消费 `http://127.0.0.1:8000`，不负责自动拉起或关闭后端。
- 后端关键接口为 `GET /health`、`GET /ready`、`POST /ai/voice_flow` 和 `WebSocket /ws/rt_voice_flow`。
- `/health` 表示后端进程存活；`/ready` 表示 ASR 模型预热完成，语音链路可接收请求。
- `electron-app/main.js` 加载 `electron-app/renderer/dist/index.html`、`floating-bar.html` 和 `floating-panel.html`。
- 前端修改后必须在 `electron-app/renderer/` 下运行 `npm run build`，再重启 Electron 验证。
- 主窗口关闭按钮只隐藏窗口到后台，托盘“退出”或真实应用退出才结束 Electron。
- 历史、设置、统计、日志和录音相关本地数据由 Electron 主进程写入 `app.getPath('userData')/local-data/`。

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
- `Right Alt` 无选区是普通听写；`Right Alt` 有选区时进入选区转译并覆盖原选区。
- `Right Alt + Space` 是自由提问；有选区时选区作为上下文，语音作为修改或提问指令，目标仍有效时覆盖选区，否则只在悬浮结果面板展示。
- `Right Alt + Right Shift` 是显式语音翻译；不因有选区而直接翻译选区，必须录音，完成后走普通粘贴链路把翻译结果贴到当前光标位置。
- 如果同一轮键态里同时存在 `Space` 和 `RightShift`，优先按翻译意图处理，避免自由提问抢占翻译。
- `focused-context:get-selected-text` 的 Windows MVP 通过剪贴板临时复制实现，必须尽量恢复原剪贴板，并在失败时降级为空选区。
- 自由提问未来如需回答实时问题，必须在后端增加意图分类和工具路由；不要只靠 prompt 假装具备联网、天气或网页检索能力。
- 翻译录音启动时，renderer 必须从本地设置读取 `translationTargetLanguage`，并通过 WebSocket `start_audio.parameters.output_language` 传给后端；当前 MVP 固定值为 `en`。
- 长按 `Right Alt` 的快捷键提示也通过 `floating-panel` IPC 和独立悬浮面板展示；提示优先级低于录音、转写、完成、取消和错误状态。
- 悬浮胶囊和悬浮面板不要依赖本机固定坐标，应基于当前显示器 `workArea` 计算并限制在屏幕内。
- WebSocket 语音流默认输入来自 `audio/webm;codecs=opus`；后端不能把未知音频头直接当 `.wav`，非 wav 输入必须先通过 `ffmpeg` 转码再喂 ASR。
- ASR 后端唯一使用 `faster-whisper`，默认模型固定为 `base`；不要恢复 Handy `ggml`、SenseVoice 或其他旧模型兼容逻辑。
- 模型扫描顺序固定为 `WHISPER_MODEL_DIR` → `%LOCALAPPDATA%\Typeless\models\faster-whisper` → `%USERPROFILE%\.cache\huggingface\hub` → 首次下载到 `%LOCALAPPDATA%\Typeless\models\faster-whisper`。
- 开发态 `uvicorn reload` 必须显式由环境变量 `UVICORN_RELOAD` 开启，不要在代码里默认写死 `reload=True`。
- 录音期间静音后台声音时，保持“短按开始、再次短按结束”的交互；Windows 上按音频会话静音，结束后只恢复本轮被 SpeakMore 主动静音的会话。

## 前端与用户体验约束

- 用户可见品牌为 `SpeakMore`。
- 主窗口页面为：首页、历史记录、设置、诊断。
- 首页“最近结果”只展示非自由提问的最近一次最终转录/最终结果文字；实时状态只在悬浮胶囊展示。
- 首页“最近结果”、历史记录条目和自由提问悬浮结果都应提供复制入口；复制动作统一走 `clipboard:write-text` IPC，空结果不能复制占位符。
- 设置页目前包含固定快捷键展示、麦克风选择、界面语言、翻译目标语言、DeepSeek API Key 输入框、开机启动和版本信息；翻译目标语言 MVP 只支持英文 `en`。
- 诊断页应检查后端 `/health`、`/ready`、麦克风、系统信息和 IPC 自动粘贴能力。
- 不要用历史阶段标签扩大范围做整套页面重构、账户体系、云同步、自动更新或复杂快捷键编辑器；需要做这些功能时先单独设计。

## 数据与配置

- DeepSeek 配置由后端 `server/.env` 读取；不要把真实密钥写入仓库。
- `server/.env.example` 是环境变量模板，真实 `server/.env` 不提交。
- 历史记录和设置统一走 Electron 主进程 JSON 数据源，renderer 不应把这类业务数据写入 `localStorage`。
- 本地设置包含 `translationTargetLanguage`，当前只允许 `en`，由主进程和 renderer 双侧归一化。
- 听写历史保存由 `AppShell` 这类全局常驻层订阅语音会话完成事件，不要放在首页、历史页等可切换页面组件里。
- 首页累计统计来自独立 `history-stats.json`，不得从最近 200 条 `history.json` 反推；历史列表裁剪不能影响累计听写时长、累计字数、平均速度和节省时间。

## 已知限制

- 设置页的 `DeepSeek API Key` 输入框当前没有写回 `server/.env`，真实运行仍以后端环境变量为准。
- 当前选区读取 MVP 依赖剪贴板和目标应用的 `Ctrl+C` 行为；不支持复制的应用会降级为空选区，后续可用 Windows UI Automation 增强。
- 当前 `ask_anything` 只调用 DeepSeek 文本模型，没有联网搜索、天气查询或工具调用链路；实时信息问题必须明确能力边界。
- `Right Alt` 有选区当前支持选区文本转译到英文并替换选区；显式翻译快捷键 `Right Alt + Right Shift` 固定为语音翻译粘贴。尚未开放英文以外的目标语言。
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
