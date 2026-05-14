# SpeakMore

SpeakMore 是一个本地 Electron 语音输入工具。它通过全局快捷键录音，把音频发送到本地 FastAPI 后端完成转写，并可调用 DeepSeek 对文本进行润色、提问或翻译。

当前架构是：

- `server/` 独立常驻运行
- Electron 只消费本地后端，不再负责自动拉起或关闭后端

## 功能

- `Right Alt`：语音转文字
- `Right Alt + Space`：提问模式
- `Right Alt + Right Shift`：翻译模式
- 识别完成后自动粘贴到当前焦点应用
- 录音胶囊条默认隐藏，只在快捷键触发时显示
- 默认语言为简体中文

## 项目结构

```text
.
├── electron-app/              # Electron 主进程、preload 和本地前端
│   ├── main.js                # 窗口、快捷键、IPC 和本地兼容层
│   ├── preload.js             # renderer 可用的安全桥接 API
│   ├── right-alt-listener.ps1 # Windows Right Alt 低级键盘监听器
│   └── renderer/              # React + Vite 前端
├── server/                    # 本地 FastAPI 语音后端
│   ├── main.py                # HTTP / WebSocket 接口与 /ready 语义
│   ├── asr.py                 # faster-whisper 转写
│   ├── refiner.py             # DeepSeek 文本处理
│   └── .env.example           # 环境变量模板
├── package.json               # Electron 启动脚本
└── AGENTS.md                  # 项目协作约束
```

## 环境要求

- Windows
- Node.js
- Python 3.10+
- 可用麦克风
- DeepSeek API Key

## 安装

安装根目录依赖：

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

## 配置

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

`server/.env` 已被 `.gitignore` 忽略，不要提交真实密钥。

### Whisper 模型

后端唯一使用 `faster-whisper base`。

模型查找顺序固定为：

1. `WHISPER_MODEL_DIR`
2. `%LOCALAPPDATA%\Typeless\models\faster-whisper`
3. `%USERPROFILE%\.cache\huggingface\hub`

如果以上位置都没有可用的 `base` 模型，首次运行会自动下载到：

```text
%LOCALAPPDATA%\Typeless\models\faster-whisper
```

## 启动

先构建前端：

```powershell
npm run renderer:build
```

再单独启动后端：

```powershell
npm run server
```

确认后端存活与就绪：

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health | Select-Object StatusCode
Invoke-WebRequest http://127.0.0.1:8000/ready | Select-Object StatusCode
```

最后启动 Electron：

```powershell
npm start
```

注意：

- Electron 不再自动拉起后端
- Electron 退出时也不会关闭后端
- `/health` 表示进程存活
- `/ready` 表示语音链路可接收请求

## 开发验证

结构测试：

```powershell
node --test electron-app\renderer\ui-structure.test.mjs
```

主进程语法检查：

```powershell
node --check electron-app\main.js
```

前端构建：

```powershell
npm run renderer:build
```

语音协议相关验证：

```powershell
npm run verify:voice
```

## Git 忽略边界

仓库不会提交以下内容：

- `node_modules/`
- `electron-app/renderer/dist/`
- `server/.env`
- 日志文件
- Python 缓存
- 逆向参考资料 `app-extracted/`
- 本地 AI 工作上下文 `docs/ai/context/`
