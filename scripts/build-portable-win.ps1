$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$assetsDir = Join-Path $root 'release-artifacts\assets'
$ffmpegDir = Join-Path $root 'release-artifacts\ffmpeg\bin'

Push-Location $root
try {
  npm run renderer:build
  npm run build:backend:win
  npm run build:helper:win
  npm run prepare:llama-runtime
  try {
    npm run prepare:hy-mt-runtime -- --optional
  } catch {
    Write-Warning "Hy-MT STQ runtime preparation skipped: $($_.Exception.Message)"
  }

  if (Test-Path $assetsDir) {
    Remove-Item -LiteralPath $assetsDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
  Copy-Item -LiteralPath 'electron-app\assets\tray-placeholder.png' -Destination (Join-Path $assetsDir 'tray-placeholder.png')

  if (!(Test-Path (Join-Path $ffmpegDir 'ffmpeg.exe'))) {
    throw "缺少 ffmpeg.exe，请把 ffmpeg.exe 放到 $ffmpegDir"
  }

  npx electron-builder --config packaging\electron-builder.yml --win zip --x64
} finally {
  Pop-Location
}
