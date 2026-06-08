#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$ROOT/release-artifacts/assets"
FFMPEG_DIR="$ROOT/release-artifacts/ffmpeg/bin"
HELPER_DIR="$ROOT/release-artifacts/helper"

rm -rf "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR"
cp "$ROOT/electron-app/assets/tray-placeholder.png" "$ASSETS_DIR/tray-placeholder.png"

mkdir -p "$FFMPEG_DIR"
FFMPEG_SOURCE="${FFMPEG_PATH:-}"
if [[ -z "$FFMPEG_SOURCE" ]]; then
  FFMPEG_SOURCE="$(command -v ffmpeg || true)"
fi

if [[ -z "$FFMPEG_SOURCE" || ! -x "$FFMPEG_SOURCE" ]]; then
  echo "缺少 macOS ffmpeg，请安装 ffmpeg 或设置 FFMPEG_PATH=/path/to/ffmpeg" >&2
  exit 1
fi

rm -f "$FFMPEG_DIR/ffmpeg"
cp "$FFMPEG_SOURCE" "$FFMPEG_DIR/ffmpeg"
chmod +x "$FFMPEG_DIR/ffmpeg"

node "$ROOT/scripts/prepare-llama-runtime.mjs" --platform darwin
node "$ROOT/scripts/prepare-hy-mt-runtime.mjs" --platform darwin --optional || true

mkdir -p "$HELPER_DIR"

echo "macOS resources prepared:"
echo "  assets: $ASSETS_DIR"
echo "  ffmpeg: $FFMPEG_DIR/ffmpeg"
echo "  llama: $ROOT/release-artifacts/llama/llama-server"
echo "  llama-stq: $ROOT/release-artifacts/llama-stq/llama-server (optional)"
echo "  helper: $HELPER_DIR"
