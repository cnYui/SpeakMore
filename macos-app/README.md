# SpeakMore 原生 macOS 版（SwiftUI）

用 Xcode 和系统原生控件重写的 SpeakMore 主窗口：`NavigationSplitView` 侧边栏 + 初始化 / 首页 / 历史记录 / 词典 / 设置五个页面，
控件全部是 SwiftUI 自带的（`Form` + `.grouped`、`LabeledContent`、`Picker`、`Toggle`、`Gauge`、`ContentUnavailableView`、`.searchable`、
`.confirmationDialog`、`Settings` 场景等），不依赖任何第三方 UI 库。

它和 Electron 版**读写同一份本地数据**（`~/Library/Application Support/SpeakMore/local-data/` 下的 `settings.json`、`history.json`、
`history-stats.json`、`dictionary.json`、`dictionary-candidates.json`），也连同一个本地 FastAPI 后端（`http://127.0.0.1:8000`），
所以两个版本可以互换使用。

## 当前范围

已完成（界面层）：

- 五个页面：初始化（模型单独下载 / 全部下载 / 切换、API Key 状态）、首页（快捷键提示、个性化分数、累计统计、最近结果）、
  历史记录（搜索、复制、清除）、词典（手动词条、候选确认 / 忽略、启用开关、搜索与筛选）、
  设置（快捷键、辅助功能权限、麦克风、识别设备、界面 / 翻译语言、大模型 provider / Key / 模型）。
- 中英文界面，可以在设置里切换（不跟系统语言走），文案和 Electron 版共用同一套（见下面“文案”）。
- ⌘, 打开系统惯例的设置窗口（和侧边栏里的“设置”页是同一个视图）。

**还没有**（仍然只在 Electron 版里）：全局快捷键监听、录音与 WebSocket 语音流、自动粘贴、悬浮胶囊 / 悬浮面板、自动学习、
托盘、后端进程的拉起与退出、签名 / 公证 / 打包。原生版目前需要先手动启动后端（`npm run server`）。

## 目录

```text
macos-app/
├── project.yml                      # XcodeGen 工程定义（生成 SpeakMore.xcodeproj，xcodeproj 不入库）
├── SpeakMore/                       # App 目标：SwiftUI 视图、AppModel、系统交互（剪贴板 / 权限 / 麦克风 / 目录选择）
│   ├── Views/                       # 五个页面 + 窗口骨架
│   ├── Support/                     # Platform、Localizer、通用小组件、ScreenshotTour（开发者截图工具）
│   └── Resources/                   # Localizable.xcstrings（生成）、Assets.xcassets（AppIcon）
├── Packages/SpeakMoreCore/          # 不含 UI 的逻辑：数据模型、本地 JSON 存储、后端 HTTP 客户端、统计 / 词典规则
│   └── Tests/                       # `swift test`，含和 Electron 版 JS 实现逐项比对的 parity 夹具
└── Tools/                           # 生成脚本：sync-shared、generate-localizable、generate-parity-fixtures
```

## 构建、运行、测试

需要 Xcode 26+（本机验证用的是 Xcode 27.2 / Swift 6.4）、`brew install xcodegen`，系统 macOS 15 以上。

```bash
cd macos-app
xcodegen generate
xcodebuild -project SpeakMore.xcodeproj -scheme SpeakMore -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath build/DerivedData build
open build/DerivedData/Build/Products/Debug/SpeakMore.app

# 核心逻辑测试（命令行即可，不需要图形会话）
cd Packages/SpeakMoreCore && swift test
```

也可以直接用 Xcode 打开 `SpeakMore.xcodeproj`。

### 环境变量（开发 / 测试用）

| 变量 | 作用 |
| --- | --- |
| `SPEAKMORE_LOCAL_DATA_DIR` | 改用别的本地数据目录（做演示数据、避免动真实历史时用） |
| `SPEAKMORE_BACKEND_URL` | 后端地址，默认 `http://127.0.0.1:8000` |
| `SPEAKMORE_SCREENSHOT_DIR` | 设置后应用逐页渲染自己的窗口为 PNG 并退出（见 `Support/ScreenshotTour.swift`），可在 SSH 会话里使用 |
| `SPEAKMORE_SCREENSHOT_PAGES` | 配合上一项，指定页面，如 `setup,home`；默认全部 |

## 保持和 Electron 版一致的三份生成物

改了 Electron 版的下面这些东西之后，需要重新生成并提交对应文件：

| 改动 | 重新生成 |
| --- | --- |
| `shared/*.json`（模型、provider、翻译语言） | `bash macos-app/Tools/sync-shared.sh`（测试会校验两边一致） |
| `electron-app/renderer/src/i18n.tsx` 的文案 | `node macos-app/Tools/generate-localizable.mjs`；原生版专有文案写在 `Tools/native-strings.json` |
| 统计 / 词典 / 设置规范化 / 个性化分数的规则 | `cd electron-app/renderer && node --import tsx ../../macos-app/Tools/generate-parity-fixtures.mjs` |

parity 夹具由 Electron 版现有的 JS / TS 实现生成，`ParityTests` 用同样的输入跑原生实现并逐字段比对，所以两边规则不一致会直接让测试失败。

## 已知限制

- 侧边栏的行内容无法用“应用渲染自己窗口”的方式截出来（SwiftUI 侧边栏的绘制路径不走 `cacheDisplay` / `CALayer.render`），
  `ScreenshotTour` 的 `view-tree.txt` 记录了侧边栏的行数和选中行；要看侧边栏请直接运行应用。
- 麦克风选择保存的是 `AVCaptureDevice.uniqueID`，和 Electron 版保存的浏览器 `deviceId` 不通用；找不到设备时界面会保留该项并显示“已拔出”，
  不会悄悄改掉用户的选择。
- 后端没启动时，初始化页会提示先启动后端，模型相关按钮不可用。
