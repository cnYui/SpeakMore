# 一键启动 SpeakMore（Windows 本机开发版）：
#   1. 8000 端口没有后端就用 server\.venv 拉起一个（隐藏窗口，日志在 %LOCALAPPDATA%\SpeakMore\logs）；已经有后端就直接用；
#   2. 启动 Electron 主窗口 / 托盘 / 悬浮窗；
#   3. 等 Electron 退出后，把自己拉起的后端一起关掉（别人起的不动）。
# 桌面 / 开始菜单的 SpeakMore 图标指向这个脚本（通过 launch-speakmore-win.vbs 隐藏控制台窗口）。
# 安装图标：npm run install:shortcut:win
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $root 'server'
$python = Join-Path $serverDir '.venv\Scripts\python.exe'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$rendererIndex = Join-Path $root 'electron-app\renderer\dist\index.html'
$logDir = Join-Path $env:LOCALAPPDATA 'SpeakMore\logs'

function Show-Failure([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, 'SpeakMore', 'OK', 'Error') | Out-Null
  exit 1
}

if (-not (Test-Path $electron)) { Show-Failure "找不到 Electron：$electron`n请先在 $root 运行 npm install" }
if (-not (Test-Path $rendererIndex)) { Show-Failure "找不到前端构建产物：$rendererIndex`n请先运行 npm run renderer:build" }

# 已经有一个 SpeakMore 在运行就不再起第二个（两个会抢全局快捷键）：尝试把它的窗口带到前台后退出。
$running = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*electron-app*' -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object -First 1
if ($running) {
  try {
    Add-Type -AssemblyName Microsoft.VisualBasic
    [Microsoft.VisualBasic.Interaction]::AppActivate([int]$running.ProcessId)
  } catch { }
  exit 0
}

function Test-Backend {
  try {
    return (Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200
  } catch {
    return $false
  }
}

$backend = $null
if (-not (Test-Backend)) {
  if (-not (Test-Path $python)) { Show-Failure "找不到后端 Python：$python`n请先准备 server\.venv（见 AGENTS.md / npm run doctor）" }
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  $backend = Start-Process -FilePath $python -ArgumentList 'main.py' -WorkingDirectory $serverDir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'backend.out.log') -RedirectStandardError (Join-Path $logDir 'backend.err.log') -PassThru
}

try {
  $app = Start-Process -FilePath $electron -ArgumentList '.\electron-app' -WorkingDirectory $root -PassThru
  $app.WaitForExit()
} finally {
  # venv 的 python.exe 是个转调的启动器，真正的解释器是它的子进程，必须整棵树一起关。
  if ($backend -and -not $backend.HasExited) {
    & taskkill.exe /PID $backend.Id /T /F | Out-Null
  }
}
