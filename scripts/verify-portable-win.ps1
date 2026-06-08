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

  $llamaServer = $allFiles | Where-Object { $_.Name -eq 'llama-server.exe' } | Select-Object -First 1
  if (!$llamaServer) {
    Fail '便携包缺少本地翻译运行时 llama-server.exe'
  }

  $hyMtLlamaServer = $allFiles | Where-Object {
    $_.Name -eq 'llama-server.exe' -and $_.FullName -match '\\llama-stq\\'
  } | Select-Object -First 1
  if ($hyMtLlamaServer) {
    Write-Host "Hy-MT STQ runtime found: $($hyMtLlamaServer.FullName)"
  } else {
    Write-Host 'Hy-MT STQ runtime not bundled; stable local translation runtime will be used.'
  }

  $secretPattern = 'sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY'
  foreach ($file in $allFiles | Where-Object { $_.Length -lt 5MB }) {
    $content = Get-Content -Raw -ErrorAction SilentlyContinue $file.FullName
    if ($content -match $secretPattern) {
      Fail "便携包疑似包含密钥: $($file.FullName)"
    }
  }

  Write-Host "portable verification passed: $($zip.FullName)"
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force
}
