# SpeakMore 原生 macOS 版（SwiftUI）

用 Xcode 和系统原生控件重写的完整 SpeakMore：全局快捷键、录音、自动粘贴、悬浮胶囊 / 悬浮面板、菜单栏、内置后端管理，
加上 `NavigationSplitView` 侧边栏 + 初始化 / 首页 / 历史记录 / 词典 / 设置五个页面。主窗口控件全部是 SwiftUI 自带的
（`Form` + `.grouped`、`LabeledContent`、`Picker`、`Toggle`、`Gauge`、`ContentUnavailableView`、`.searchable`、
`.confirmationDialog`、`Settings` 场景、`MenuBarExtra` 等），不依赖任何第三方 UI 库，**不依赖 Electron**。

它和 Electron 版**读写同一份本地数据**（`~/Library/Application Support/SpeakMore/local-data/` 下的 `settings.json`、`history.json`、
`history-stats.json`、`dictionary.json`、`dictionary-candidates.json`），也连同一个本地 FastAPI 后端（`http://127.0.0.1:8000`），
所以两个版本可以互换使用（同一时间只开一个，快捷键会冲突）。

## 功能

- **快捷键**（和 Electron 版 macOS 一致）：右侧 `Option` 听写；`Option + 右侧 Command` 自由提问；`Option + Shift` 翻译；
  左侧 `Option` / `Command` 不触发；短按开始、再按结束（释放边沿触发）；按住超过 350 ms 弹快捷键提示；`Escape` 取消。
- **录音**：AVAudioEngine → 多声道按能量混音 → 去直流 / 增益 → 16 kHz 单声道 PCM16 → WebSocket 流式发给后端；录音上限 30 分钟（29 分钟提醒），后端按 30 秒一段分段识别、润色，说完只等最后一段。
- **结果交付**：听写 / 翻译在有可信输入目标（辅助功能 AX）时自动粘贴并恢复原剪贴板，失败就显示在悬浮面板；
  自由提问读取 AX 选区作为上下文，结果永远显示在悬浮面板（可复制）。
- **悬浮胶囊 / 面板**：不激活的 `NSPanel`（不抢输入焦点），屏幕底部居中，粒子球随音量起伏。
- **菜单栏**：图标 + “打开主窗口 / 退出”；关闭窗口不退出，快捷键一直可用；可选登录时自动启动。
- **后端**：已经有后端在监听就复用，否则从 App 包里拉起内置后端（或开发时用 `SPEAKMORE_BACKEND_DEV_DIR`），本机有缓存模型就提前加载，退出时关掉自己起的。
- 中英文界面，可以在设置里切换（不跟系统语言走），文案和 Electron 版共用同一套（见下面“文案”）。悬浮窗口文案固定中文，和 Electron 版一致。

**还没有**（仍然只在 Electron 版里）：粘贴后的词典自动学习（观察用户改写）。

## 系统权限

三项都要用户在系统设置里授权一次（设置页有状态和“授权…”按钮）：

| 权限 | 用途 | 没授权时 |
| --- | --- | --- |
| 麦克风 | 录音 | 提示“无法访问麦克风”，不会开始录音 |
| 输入监控 | 全局监听右侧 Option / Command / Shift（CGEventTap，只听不改） | 快捷键不可用；授权后每 2 秒检查一次，自动开始监听，不用重启 |
| 辅助功能 | 读焦点 / 选区、模拟 `Cmd+V` | 不自动粘贴，结果显示在悬浮面板 |

## 目录

```text
macos-app/
├── project.yml                      # XcodeGen 工程定义（生成 SpeakMore.xcodeproj，xcodeproj 不入库）
├── SpeakMore/                       # App 目标
│   ├── Views/                       # 五个页面 + 窗口骨架
│   ├── Overlay/                     # 悬浮胶囊 / 面板的视图、粒子球、NSPanel 窗口
│   ├── Support/                     # VoiceCoordinator（把整条链路接起来）、Platform、Localizer、小组件、ScreenshotTour
│   └── Resources/                   # Localizable.xcstrings（生成）、Assets.xcassets（AppIcon / MenuBarGlyph）
├── Packages/SpeakMoreCore/
│   ├── Sources/SpeakMoreCore/       # 不依赖 AppKit 的逻辑：数据模型、本地 JSON、后端 HTTP / WebSocket、
│   │   ├── Voice/                   #   语音会话状态机、协议、快捷键守卫、音频整理、悬浮窗口显示逻辑
│   │   └── Services/                #   后端客户端、就绪检查、进程管理、本地数据存储
│   ├── Sources/SpeakMorePlatform/   # 必须碰系统的部分：CGEventTap 快捷键、AX 读焦点 / 选区、剪贴板、Cmd+V、权限、登录项
│   └── Tests/                       # `swift test`，含和 Electron 版 JS 实现逐项比对的 parity 夹具
└── Tools/                           # 生成脚本、端到端测试、打包脚本（见下）
```

## 构建、运行、测试

需要 Xcode 26+（本机验证用的是 Xcode 27.2 / Swift 6.4）、`brew install xcodegen`，系统 macOS 15 以上。

```bash
cd macos-app
xcodegen generate
xcodebuild -project SpeakMore.xcodeproj -scheme SpeakMore -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build/DerivedData build
open build/DerivedData/Build/Products/Debug/SpeakMore.app

# 逻辑测试（命令行即可，不需要图形会话，也不需要任何系统权限）
cd Packages/SpeakMoreCore && swift test
```

也可以直接用 Xcode 打开 `SpeakMore.xcodeproj`。开发时需要后端：在仓库根目录 `npm run server`，或设置 `SPEAKMORE_BACKEND_DEV_DIR=<仓库>/server` 让 App 自己拉起。

### 环境变量（开发 / 测试用）

| 变量 | 作用 |
| --- | --- |
| `SPEAKMORE_LOCAL_DATA_DIR` | 改用别的本地数据目录（做演示数据、避免动真实历史时用） |
| `SPEAKMORE_BACKEND_URL` | 后端地址，默认 `http://127.0.0.1:8000` |
| `SPEAKMORE_BACKEND_DEV_DIR` | 指向仓库的 `server/`，App 用它里面的 `.venv` 拉起后端（没有已运行的后端时） |
| `SPEAKMORE_VOICE_WAV` | 用这个音频文件代替麦克风（按实时节奏送出） |
| `SPEAKMORE_DEMO_DICTATION` | 设为秒数：启动 2 秒后自动开始听写，录这么久后停止（配合 `SPEAKMORE_DEMO_MODE=Dictate\|Ask\|Translate`） |
| `SPEAKMORE_OVERLAY_SNAPSHOT_DIR` | 配合上一项：把可见的悬浮窗口每 0.5 秒渲染成 PNG，写 `demo-log.txt`，结束后退出 |
| `SPEAKMORE_SCREENSHOT_DIR` | 设置后应用逐页渲染自己的窗口为 PNG 并退出（见 `Support/ScreenshotTour.swift`），可在 SSH 会话里使用 |
| `SPEAKMORE_SCREENSHOT_PAGES` | 配合上一项，指定页面，如 `setup,home`；默认全部 |

## 验证

| 命令 | 验证什么 |
| --- | --- |
| `cd Packages/SpeakMoreCore && swift test` | 数据模型 / 统计 / 词典（parity）、语音协议与状态机（假依赖）、快捷键守卫、音频整理、悬浮窗口逻辑、后端进程管理、粘贴服务（假 AX / 剪贴板） |
| `bash Tools/e2e-voice.sh` | 真实后端 + 假大模型 + `say` 生成的语音当麦克风，跑完整一轮听写和“取消后再来一轮” |
| `bash Tools/e2e-app.sh [输出目录]` | 整个 App（先构建 Debug 版）自己驱动一轮听写，悬浮窗口渲染成 PNG；`E2E_SKIP_BACKEND=1` 时验证 App 自己拉起后端，`E2E_APP_BUNDLE=…` 可以测打包好的 App |
| `bash Tools/verify-app.sh SpeakMore.app` | 打好的 App：Info.plist、图标、本地化、签名、内置后端 / ffmpeg |

两个 e2e 脚本只在 Mac 上跑，**不需要麦克风 / 辅助功能 / 输入监控权限**（用音频文件代替麦克风、自动粘贴按设计回落到悬浮面板）。
需要真实权限才能验证的部分——真实麦克风、全局快捷键、在别的应用里真正粘贴——要在授权后手动试。

## 打包

```bash
bash macos-app/Tools/package-app.sh
```

构建 Release（arm64）→ 把后端（PyInstaller onedir）和 ffmpeg 放进 `Contents/Resources/backend`、`ffmpeg/bin` → 签名 → 检查 → 生成 zip 和 dmg，
产物在 `release-artifacts/macos-native/`（不入库）。后端用 `SPEAKMORE_BACKEND_DIR` 指向已构建好的目录（默认 `release-artifacts/backend`，
即 `scripts/build-backend-macos.sh` 的产物），或设 `SPEAKMORE_BUILD_BACKEND=1` 现场构建（很慢，约 1 GB）。
默认 ad-hoc 签名，只能在本机运行；正式分发要设 `SPEAKMORE_SIGN_IDENTITY="Developer ID Application: …"` 并另行公证。

### 本机安装（点图标启动）

```bash
bash macos-app/Tools/install-local.sh          # 默认装到 /Applications
```

打包 → 装到 `/Applications/SpeakMore.app` → 登记到系统。装好后它和普通 App 一样出现在“启动台 / 应用程序”和 Spotlight 里，点图标就启动，
可以拖到 Dock；开了“登录时自动启动”还会随登录自动运行在菜单栏。后端由 App 自己拉起（已有后端在监听就复用）。
本机安装版不打 PyInstaller 后端，只放一个转调仓库 `server/.venv` 的启动脚本（`SPEAKMORE_LOCAL_BACKEND_DIR`），所以**依赖这份仓库检出，不要移动或删除仓库目录**；
要分发给别人请用上面的 PyInstaller 后端。只替换 `SpeakMore.app` 本身，不碰同目录下的别的 App。

## 保持和 Electron 版一致的生成物

改了 Electron 版的下面这些东西之后，需要重新生成并提交对应文件：

| 改动 | 重新生成 |
| --- | --- |
| `shared/*.json`（模型、provider、翻译语言） | `bash macos-app/Tools/sync-shared.sh`（测试会校验两边一致） |
| `electron-app/renderer/src/i18n.tsx` 的文案 | `node macos-app/Tools/generate-localizable.mjs`；原生版专有文案写在 `Tools/native-strings.json` |
| 统计 / 词典 / 设置规范化 / 个性化分数 / 语音协议 / 快捷键 / 音频整理的规则 | `cd electron-app/renderer && node --import tsx ../../macos-app/Tools/generate-parity-fixtures.mjs` |

parity 夹具由 Electron 版现有的 JS / TS 实现生成（快捷键用真实的 `right-alt-relay.js` + `shortcutGuard.ts` 回放），
`ParityTests` / `VoiceParityTests` 用同样的输入跑原生实现并逐字段比对，所以两边规则不一致会直接让测试失败。
全局键盘事件的翻译（`MacKeyInterpreter`）对照的是 Electron 版 `macos-option-listener.c` 在 Mac 上回放同一组事件的输出。

## 已知限制

- 侧边栏的行内容无法用“应用渲染自己窗口”的方式截出来（SwiftUI 侧边栏的绘制路径不走 `cacheDisplay` / `CALayer.render`），
  `ScreenshotTour` 的 `view-tree.txt` 记录了侧边栏的行数和选中行；要看侧边栏请直接运行应用。
- 麦克风选择保存的是 `AVCaptureDevice.uniqueID`，和 Electron 版保存的浏览器 `deviceId` 不通用；找不到设备时界面会保留该项并显示“已拔出”，
  不会悄悄改掉用户的选择。
- 找不到后端（没有内置后端、没有已运行的后端、没设开发目录）时，初始化页会提示，录音会报“语音后端未就绪”。
- macOS 不做“录音期间静音其它应用”（Electron 版也只在 Windows 实现）。
- 自动粘贴成功后，macOS 在 180 ms 后恢复剪贴板；等待期间用户自己改了剪贴板就不再覆盖。
- 登录项（`SMAppService`）需要 App 位于固定位置（如 `/Applications`）并可能要求用户在系统设置里允许。
