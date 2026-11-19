$ErrorActionPreference = 'Stop'

function Fail($message) {
  Write-Error $message
  exit 1
}

$zip = Get-ChildItem -Path release -Filter 'SpeakMore-*-win-x64.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$zip) {
  Fail '未找到 Windows x64 便携 zip'
}

$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('speakmore-verify-' + [Guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $zip.FullName -DestinationPath $temp

try {
  $allFiles = Get-ChildItem -Path $temp -Recurse -File
  $forbidden = $allFiles | Where-Object {
    $_.FullName -match '\\docs\\ai\\context\\' -or
    $_.FullName -match '\\app-extracted\\' -or
    $_.Name -match '^\.env($|\.)' -or
    $_.Name -match '\.(log|err|pid)$' -or
    $_.FullName -match '\\local-data\\'
  }

  if ($forbidden) {
    $forbidden | ForEach-Object { Write-Host "forbidden package file: $($_.FullName)" }
    Fail '便携包包含禁止发布的文件'
  }

  $exe = $allFiles | Where-Object { $_.Name -eq 'SpeakMore.exe' } | Select-Object -First 1
  if (!$exe) {
    Fail '便携包缺少 SpeakMore.exe'
  }

  # app.asar 只应包含主进程 JS 和 renderer 构建产物（约 2 MB）；超过 10 MB 通常是误打包了 node_modules 或源码
  $asar = $allFiles | Where-Object { $_.Name -eq 'app.asar' } | Select-Object -First 1
  if (!$asar) {
    Fail '便携包缺少 app.asar'
  }
  if ($asar.Length -gt 10MB) {
    Fail ("app.asar 体积异常：{0:N1} MB，请检查 packaging/electron-builder.yml 的 files 配置" -f ($asar.Length / 1MB))
  }

  $backend = $allFiles | Where-Object { $_.Name -eq 'speakmore-backend.exe' } | Select-Object -First 1
  if (!$backend) {
    Fail '便携包缺少 speakmore-backend.exe'
  }

  $helper = $allFiles | Where-Object { $_.Name -eq 'WindowsTextObserver.exe' } | Select-Object -First 1
  if (!$helper) {
    Fail '便携包缺少 WindowsTextObserver.exe'
  }

  $ffmpeg = $allFiles | Where-Object { $_.Name -eq 'ffmpeg.exe' } | Select-Object -First 1
  if (!$ffmpeg) {
    Fail '便携包缺少 ffmpeg.exe'
  }

  $secretPattern = 'sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY'
  # 后端 onedir 会展开成上千个第三方库文件；*.dist-info\RECORD 只是 base64 哈希清单，容易误命中，跳过。
  # 密钥前缀区分大小写，必须用 -cmatch，否则 RECORD 里的 “Sk-…”“GhP_…” 也会被当成密钥。
  $scanFiles = $allFiles | Where-Object { $_.Length -lt 5MB -and !($_.Name -eq 'RECORD' -and $_.DirectoryName -match '\.dist-info$') }
  foreach ($file in $scanFiles) {
    $content = Get-Content -Raw -ErrorAction SilentlyContinue $file.FullName
    if ($content -cmatch $secretPattern) {
      Fail "便携包疑似包含密钥: $($file.FullName)"
    }
  }

  Write-Host "portable verification passed: $($zip.FullName)"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
