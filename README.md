# SpeakMore

SpeakMore 是一个 Windows 本地语音输入工具。它用 Electron 提供桌面壳和全局快捷键，用本地 FastAPI 后端完成语音转写，再调用 DeepSeek 对文本进行清洗、提问或翻译。听写和翻译结果会粘贴回当前焦点应用，自由提问结果会显示在独立悬浮面板里。

当前项目是本地开发版：

- 后端需要单独启动。
- Electron 不会自动拉起或关闭后端。
- 用户数据保存在本机 Electron `userData/local-data/`。
- 用户可见语言固定为简体中文。

## 功能概览

- `Right Alt`：听写，把口述内容转成文本并清洗。
- `Right Alt + Space`：自由提问，把口述问题交给 DeepSeek 生成回答，并在悬浮面板展示。
- `Right Alt + Right Shift`：翻译模式，当前默认把口述文本翻译成英文。
- `Escape`：取消当前未完成的语音会话。
- 录音时显示悬浮胶囊栏和真实麦克风音量柱。
- 听写和翻译完成后自动粘贴到当前焦点应用。
- 自由提问录音时胶囊显示“请随意提出问题”，完成后在悬浮面板展示回答。
- 主窗口关闭后隐藏到后台，托盘“退出”才真正结束 Electron。
- 录音期间在 Windows 上尝试静音后台音频，结束后恢复本轮主动静音的会话。
- 首页展示累计统计和最近结果，历史页展示最近 200 条记录，诊断页检查后端、麦克风和 IPC。

## 项目结构

```text
.
├── server/                         # 本地 FastAPI 后端
│   ├── main.py                     # HTTP / WebSocket 接口、就绪状态、音频转码
│   ├── asr.py                      # faster-whisper base 模型加载与转写
│   ├── refiner.py                  # DeepSeek 文本清洗、提问、翻译
│   ├── runtime_config.py           # .env、HOST、PORT、CORS 配置
│   └── .env.example                # 后端环境变量模板
├── electron-app/                   # Electron 主进程和本地桌面壳
│   ├── main.js                     # 窗口、托盘、IPC、快捷键、粘贴、本地数据
│   ├── preload.js                  # Renderer 安全 IPC 桥接
│   ├── right-alt-listener.ps1      # Windows 低级键盘监听器
│   ├── audio-session-control.ps1   # Windows 后台音频会话静音/恢复
│   └── renderer/                   # Vite + React + MUI + TypeScript 前端
├── docs/ai/context/                # AI 上下文、设计、计划和决策记录
├── .github/workflows/ci.yml        # CI：renderer 测试、统计测试、构建
├── package.json                    # 根启动、构建和后端验证脚本
└── AGENTS.md                       # 项目协作约定
```

`app-extracted/` 如果存在，只是 Typeless 逆向参考资料，不是当前运行入口。

## 环境要求

- Windows 10/11。
- Node.js 24 推荐；CI 使用 Node.js 24。
- Python 3.10+。
- PowerShell。
- `ffmpeg` 已安装并在 `PATH` 中，后端需要它把 `webm/ogg/mp3/m4a/opus` 转成 `wav`。
- 可用麦克风。
- DeepSeek API Key。
- 首次自动下载 `faster-whisper base` 模型时需要可访问 Hugging Face；离线环境请提前准备模型目录并配置 `WHISPER_MODEL_DIR`。

## 安装

在项目根目录安装 Electron 依赖：

```powershell
npm install
```

安装前端依赖：

```powershell
cd electron-app\renderer
npm install
```

安装后端依赖：

```powershell
cd ..\..\server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

如果 `ffmpeg` 命令不可用，请先安装并确认：

```powershell
ffmpeg -version
```

## 后端配置

复制环境变量模板：

```powershell
copy server\.env.example server\.env
```

编辑 `server/.env`：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
WHISPER_MODEL=base
WHISPER_MODEL_DIR=
HOST=127.0.0.1
PORT=8000
CORS_ALLOWED_ORIGINS=null,http://127.0.0.1:5173,http://localhost:5173
```

注意：

- `server/.env` 已被 `.gitignore` 忽略，不要提交真实密钥。
- 当前后端只支持 `WHISPER_MODEL=base`。
- 设置页里的 `DeepSeek API Key` 输入目前只是界面入口，不会自动写入 `server/.env`；真实运行仍以 `server/.env` 为准。
- 开发态热重载需要显式设置 `UVICORN_RELOAD=true`，代码不会默认开启 reload。

### Whisper 模型位置

后端唯一使用 `faster-whisper base`。模型查找顺序为：

1. `WHISPER_MODEL_DIR`
2. `%LOCALAPPDATA%\Typeless\models\faster-whisper`
3. `%USERPROFILE%\.cache\huggingface\hub`
4. 都未命中时，首次运行自动下载到 `%LOCALAPPDATA%\Typeless\models\faster-whisper`

如果手动配置 `WHISPER_MODEL_DIR`，目录内必须包含 `model.bin` 和 `config.json`。

## 启动

先构建 Electron 要加载的前端产物：

```powershell
npm run renderer:build
```

启动后端：

```powershell
npm run server
```

后端启动后检查存活和就绪：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:8000/ready | Select-Object StatusCode
```

含义：

- `/health` 返回 200：后端进程存活。
- `/ready` 返回 200：ASR 模型已预热，语音链路可用。
- `/ready` 返回 503：后端还在加载模型或加载失败。

最后启动 Electron：

```powershell
npm start
```

启动后 Electron 会打开主窗口，并创建默认隐藏的悬浮胶囊栏、悬浮面板和托盘图标。

## 使用流程

1. 先确认后端 `/ready` 为 200，再启动 Electron。
2. 打开主窗口的“设置”，选择麦克风；默认使用系统默认输入设备。
3. 把光标放到要输入文字的应用里，例如编辑器、浏览器输入框或聊天窗口。
4. 短按 `Right Alt` 开始听写，悬浮胶囊显示录音状态。
5. 说完后再次短按 `Right Alt` 结束录音。
6. 等待“正在转写...”完成。听写和翻译结果会自动粘贴到当前焦点应用。
7. 如果不想提交当前录音，按 `Escape` 取消。

其他模式：

- `Right Alt + Space`：自由提问。录音时胶囊显示“请随意提出问题”，完成后在悬浮面板展示回答，不自动粘贴。
- `Right Alt + Right Shift`：翻译。当前默认翻译成英文，完成后粘贴翻译结果。
- 长按 `Right Alt` 不会开始录音，会在悬浮面板显示快捷键提示；录音中长按不显示提示，释放仍按“再次短按结束”的语义停止录音。

使用听写或翻译时保持目标输入框处于焦点状态。自动粘贴依赖剪贴板和 Windows `SendKeys`，如果焦点切走，结果可能粘贴到错误位置或粘贴失败。自由提问结果不走自动粘贴，直接在悬浮面板查看。

## 主窗口页面

- 首页：显示快捷键提示、累计听写时长、累计字数、节省时间、平均速度和最近结果；最近结果不包含自由提问回答。
- 历史记录：展示最近 200 条听写记录，支持搜索、复制和清空列表。
- 设置：选择麦克风、开机启动、查看固定快捷键和本地版版本信息。
- 诊断：检查后端 `/health`、`/ready`、麦克风、系统信息和 IPC 自动粘贴能力。

历史列表最多保留 200 条；累计统计来自独立统计文件，清空历史列表不会重置累计统计。

## 本地数据

Electron 主进程把业务数据写到：

```text
Electron userData/local-data/
```

主要文件和目录：

- `settings.json`：本地设置。
- `history.json`：最近历史列表。
- `history-stats.json`：累计统计。
- `recording.log`：诊断日志。
- `recordings/`：录音相关本地产物目录。

具体 `userData` 路径由 Electron 根据系统和应用名决定，可在诊断或日志功能里间接打开。

## 后端接口

- `GET /health`：后端进程存活检查。
- `GET /ready`：语音链路就绪检查。
- `POST /ai/voice_flow`：上传完整音频并返回处理结果。
- `WebSocket /ws/rt_voice_flow`：实时录音流接口，Electron Renderer 当前主要使用它。
- `GET /`：后端自带的简单录音测试页面。

实时音频默认来自浏览器 `MediaRecorder` 的 `audio/webm;codecs=opus`。后端会识别 `webm/ogg/wav` 头部，非 `wav` 输入先用 `ffmpeg` 转码再交给 ASR。

## 开发验证

前端测试：

```powershell
cd electron-app\renderer
npm test
```

前端构建：

```powershell
npm run renderer:build
```

主进程语法检查：

```powershell
node --check electron-app\main.js
```

快捷键转发测试：

```powershell
node --test electron-app\right-alt-relay.test.js
```

历史统计测试：

```powershell
node --test electron-app\history-stats-store.test.mjs
```

后端核心语音协议验证：

```powershell
npm run verify:voice
```

后端全部测试：

```powershell
cd server
python -m pytest -q
```

CI 当前会运行：

- 根依赖安装
- Renderer 依赖安装
- Renderer 测试
- 历史统计测试
- Renderer 构建

## 常见问题

### Electron 提示语音后端未启动

先单独运行：

```powershell
npm run server
```

再检查：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/ready | Select-Object StatusCode
```

如果 `/ready` 仍是 503，通常是模型还在加载、模型下载失败或 `WHISPER_MODEL_DIR` 配置错误。

### 首次启动很慢

第一次没有本地 `faster-whisper base` 模型时，后端会下载模型。网络慢或无法访问 Hugging Face 时，建议提前下载模型并设置 `WHISPER_MODEL_DIR`。

### 转写时报 ffmpeg 错误

确认 `ffmpeg` 在 `PATH` 中：

```powershell
ffmpeg -version
```

后端实时音频通常是 `webm/opus`，没有 `ffmpeg` 就无法稳定转成 ASR 需要的 `wav`。

### DeepSeek 没有生效

检查 `server/.env`：

```env
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

修改 `.env` 后需要重启后端。当前设置页不会自动更新后端 `.env`。

### 快捷键没反应

确认运行在 Windows，并检查 Electron 是否成功启动 `electron-app/right-alt-listener.ps1`。如果安全软件拦截 PowerShell 低级键盘监听器，`Right Alt` 事件不会送到 Renderer。

### 自动粘贴失败

自动粘贴依赖剪贴板和 Windows `System.Windows.Forms.SendKeys`。请确认目标输入框仍有焦点，且当前应用允许粘贴。

## Git 忽略边界

仓库不会提交以下内容：

- `node_modules/`
- `electron-app/renderer/dist/`
- `server/.env`
- 日志文件
- Python 缓存
- 逆向参考资料 `app-extracted/`
- 本地 AI 工作上下文 `docs/ai/context/`
