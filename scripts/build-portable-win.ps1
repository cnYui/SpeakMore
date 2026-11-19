$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$assetsDir = Join-Path $root 'release-artifacts\assets'
$ffmpegDir = Join-Path $root 'release-artifacts\ffmpeg\bin'

Push-Location $root
try {
  npm run renderer:build
  npm run build:backend:win
  npm run build:helper:win

  if (Test-Path $assetsDir) {
    Remove-Item -LiteralPath $assetsDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
  Copy-Item -LiteralPath 'electron-app\assets\app-icon.png', 'electron-app\assets\tray-icon.png' -Destination $assetsDir

  if (!(Test-Path (Join-Path $ffmpegDir 'ffmpeg.exe'))) {
    throw "缺少 ffmpeg.exe，请把 ffmpeg.exe 放到 $ffmpegDir"
  }

  npx electron-builder --config packaging\electron-builder.yml --win zip --x64
} finally {
  Pop-Location
}
