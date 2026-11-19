# 在桌面和开始菜单（“所有应用”里）建 SpeakMore 图标，点一下就启动（见 launch-speakmore-win.ps1）。
#   安装：npm run install:shortcut:win
#   卸载：powershell -ExecutionPolicy Bypass -File scripts\install-shortcut-win.ps1 -Uninstall
# 图标指向当前这份仓库检出，仓库目录移动后需要重新运行本脚本。
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch-speakmore-win.vbs'
$icon = Join-Path $root 'packaging\icons\icon.ico'
$folders = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

$shell = New-Object -ComObject WScript.Shell
foreach ($folder in $folders) {
  $path = Join-Path $folder 'SpeakMore.lnk'
  if ($Uninstall) {
    if (Test-Path $path) { Remove-Item $path -Force; Write-Host "已删除 $path" }
    continue
  }
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $shortcut.Arguments = "//nologo `"$launcher`""
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = "$icon,0"
  $shortcut.Description = 'SpeakMore 语音输入'
  $shortcut.Save()
  Write-Host "已创建 $path"
}
if (-not $Uninstall) { Write-Host '完成：在开始菜单搜索 SpeakMore，或双击桌面图标即可启动。' }
