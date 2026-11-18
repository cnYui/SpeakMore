$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$artifactDir = Join-Path $root 'release-artifacts\backend'
$actualSpecPath = Join-Path $root 'packaging\pyinstaller\speakmore-backend.spec'

if (!(Test-Path $actualSpecPath)) {
  throw "PyInstaller spec 不存在: $actualSpecPath"
}

Push-Location $root
try {
  python -m pip install -r server\requirements.txt
  if (Test-Path 'build\pyinstaller\speakmore-backend') {
    Remove-Item -LiteralPath 'build\pyinstaller\speakmore-backend' -Recurse -Force
  }
  if (Test-Path $artifactDir) {
    Remove-Item -LiteralPath $artifactDir -Recurse -Force
  }
  if (Test-Path 'release-artifacts\speakmore-backend.exe') {
    Remove-Item -LiteralPath 'release-artifacts\speakmore-backend.exe' -Force
  }
  # spec 使用 onedir，COLLECT 名为 backend，产物落在 release-artifacts\backend\（exe + _internal\）
  python -m PyInstaller $actualSpecPath --distpath (Join-Path $root 'release-artifacts') --workpath build\pyinstaller --noconfirm
  $exePath = Join-Path $artifactDir 'speakmore-backend.exe'
  if (!(Test-Path $exePath)) {
    throw "后端 exe 构建失败: $exePath"
  }
  Write-Host "backend built: $exePath"
} finally {
  Pop-Location
}
