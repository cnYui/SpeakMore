# SpeakMore

SpeakMore 是一个本地 Electron 语音输入工具。它通过全局快捷键录音，把音频发送到本地 FastAPI 后端完成转写，并可调用 DeepSeek 对文本进行润色、提问或翻译。

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
│   ├── main.js                # 窗口、快捷键、IPC、后端启动逻辑
│   ├── preload.js             # renderer 可用的安全桥接 API
│   ├── right-alt-listener.ps1 # Windows Right Alt 低级键盘监听器
│   └── renderer/              # React + Vite 前端
├── server/                    # 本地 FastAPI 语音后端
│   ├── main.py                # HTTP / WebSocket 接口
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
```

`server/.env` 已被 `.gitignore` 忽略，不要提交真实密钥。

## 启动

先构建前端：

```powershell
cd electron-app\renderer
npm run build
```

回到项目根目录启动 Electron：

```powershell
cd ..\..
npm start
```

Electron 启动后会自动检查并拉起本地语音后端。也可以单独启动后端：

```powershell
npm run server
```

后端健康检查地址：

```text
http://127.0.0.1:8000/health
```

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
cd electron-app\renderer
npm run build
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
