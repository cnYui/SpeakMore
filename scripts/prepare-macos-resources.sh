#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$ROOT/release-artifacts/assets"
FFMPEG_DIR="$ROOT/release-artifacts/ffmpeg/bin"
HELPER_DIR="$ROOT/release-artifacts/helper"

rm -rf "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR"
cp "$ROOT/electron-app/assets/app-icon.png" "$ROOT/electron-app/assets/tray-icon.png" "$ASSETS_DIR/"
cp "$ROOT/electron-app/assets/tray-iconTemplate.png" "$ROOT/electron-app/assets/tray-iconTemplate@2x.png" "$ASSETS_DIR/"

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

mkdir -p "$HELPER_DIR"

echo "macOS resources prepared:"
echo "  assets: $ASSETS_DIR"
echo "  ffmpeg: $FFMPEG_DIR/ffmpeg"
echo "  helper: $HELPER_DIR"
