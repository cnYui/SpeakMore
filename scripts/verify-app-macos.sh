#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "$1" >&2
  exit 1
}

APP_PATH="${APP_PATH:-}"
if [[ -z "$APP_PATH" ]]; then
  APP_PATH="$(find "$ROOT/release" -maxdepth 4 -type d -name 'SpeakMore.app' 2>/dev/null | sort | tail -n 1 || true)"
fi

[[ -n "$APP_PATH" && -d "$APP_PATH" ]] || fail "未找到 SpeakMore.app，请先运行 npm run build:app:mac"

RESOURCES="$APP_PATH/Contents/Resources"
BACKEND="$RESOURCES/backend/speakmore-backend"
FFMPEG="$RESOURCES/ffmpeg/bin/ffmpeg"
LLAMA_SERVER="$RESOURCES/llama/llama-server"
HYMT_LLAMA_SERVER="$RESOURCES/llama-stq/llama-server"
OPTION_LISTENER="$RESOURCES/app.asar.unpacked/electron-app/macos-option-listener.c"
PLATFORM_HELPER="$RESOURCES/app.asar.unpacked/electron-app/macos-platform-helper.m"

[[ -x "$LLAMA_SERVER" ]] || fail "打包产物缺少本地翻译稳定运行时: $LLAMA_SERVER"
if [[ -x "$HYMT_LLAMA_SERVER" ]]; then
  echo "Hy-MT STQ runtime found: $HYMT_LLAMA_SERVER"
else
  echo "Hy-MT STQ runtime not bundled; stable local translation runtime will be used."
fi

[[ -x "$BACKEND" ]] || fail "打包产物缺少后端可执行文件: $BACKEND"
[[ -x "$FFMPEG" ]] || fail "打包产物缺少 ffmpeg: $FFMPEG"
[[ -f "$OPTION_LISTENER" ]] || fail "打包产物缺少 macOS Option helper 源码: $OPTION_LISTENER"
[[ -f "$PLATFORM_HELPER" ]] || fail "打包产物缺少 macOS 平台 helper 源码: $PLATFORM_HELPER"

if find "$APP_PATH" -path '*/docs/ai/context/*' -print -quit | grep -q .; then
  fail "打包产物包含 docs/ai/context"
fi

if find "$APP_PATH" \( -name '.env' -o -name '.env.*' -o -name '*.log' -o -name '*.err' -o -name '*.pid' \) -print -quit | grep -q .; then
  fail "打包产物包含禁止发布的本机配置或日志文件"
fi

echo "macOS app verification passed: $APP_PATH"
