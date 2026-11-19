#!/usr/bin/env bash
# 把原生版打成可分发的 App / zip / dmg（在 Mac 上运行）：
#   1. xcodegen + xcodebuild 构建 Release 版 SpeakMore.app（arm64）；
#   2. 把语音后端（PyInstaller onedir）和 ffmpeg 放进 App 的 Contents/Resources：backend/speakmore-backend、ffmpeg/bin/ffmpeg；
#   3. 签名：默认 ad-hoc（只能在本机运行）；设置 SPEAKMORE_SIGN_IDENTITY="Developer ID Application: …" 用正式签名（公证另行处理）；
#   4. 检查内容（verify-app.sh），再生成 zip 和 dmg。
#
# 产物在 release-artifacts/macos-native/，不入库。
#
# 用法：bash macos-app/Tools/package-app.sh
# 环境变量：
#   SPEAKMORE_BACKEND_DIR   已构建好的后端目录（含 speakmore-backend），默认 release-artifacts/backend；
#                           不存在且 SPEAKMORE_BUILD_BACKEND=1 时先运行 scripts/build-backend-macos.sh 构建（很慢，约 1 GB）
#   FFMPEG_PATH             ffmpeg 可执行文件，默认 release-artifacts/ffmpeg/bin/ffmpeg，再退到 PATH 里的 ffmpeg
#   SPEAKMORE_SIGN_IDENTITY 签名身份，默认 "-"（ad-hoc）
#   SPEAKMORE_SKIP_BUILD=1  跳过 xcodebuild，直接用已有的 Release 构建结果重新装配
set -euo pipefail

TOOLS="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$TOOLS/.." && pwd)"
ROOT="$(cd "$APP_DIR/.." && pwd)"
OUT="$ROOT/release-artifacts/macos-native"
DERIVED="$APP_DIR/build/DerivedData"
BUILT="$DERIVED/Build/Products/Release/SpeakMore.app"
FINAL="$OUT/SpeakMore.app"
IDENTITY="${SPEAKMORE_SIGN_IDENTITY:--}"
BACKEND_DIR="${SPEAKMORE_BACKEND_DIR:-$ROOT/release-artifacts/backend}"
export PATH="/opt/homebrew/bin:$PATH"

if [ "${SPEAKMORE_SKIP_BUILD:-0}" != "1" ]; then
  echo "== 构建 Release"
  (cd "$APP_DIR" && xcodegen generate >/dev/null && xcodebuild -project SpeakMore.xcodeproj -scheme SpeakMore \
    -configuration Release -destination 'generic/platform=macOS' ARCHS=arm64 ONLY_ACTIVE_ARCH=NO \
    -derivedDataPath "$DERIVED" build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E 'error:|BUILD (SUCCEEDED|FAILED)' | sort -u)
fi
[ -d "$BUILT" ] || { echo "找不到构建结果：$BUILT" >&2; exit 1; }

echo "== 装配到 $FINAL"
mkdir -p "$OUT"
rm -rf "$FINAL"
ditto "$BUILT" "$FINAL"
RES="$FINAL/Contents/Resources"

if [ -n "${SPEAKMORE_LOCAL_BACKEND_DIR:-}" ]; then
  # 本机安装：不打 1 GB 的 PyInstaller 后端，只放一个启动脚本，转调仓库里 server/.venv 的 Python。
  # 这个 App 因此只能在这台机器上用（依赖这份仓库检出）；分发请用 PyInstaller 后端。
  SERVER="$(cd "$SPEAKMORE_LOCAL_BACKEND_DIR" && pwd)"
  [ -x "$SERVER/.venv/bin/python" ] || { echo "找不到 $SERVER/.venv/bin/python，先准备 server/.venv" >&2; exit 1; }
  mkdir -p "$RES/backend"
  cat >"$RES/backend/speakmore-backend" <<EOF
#!/bin/sh
# 本机安装用的后端启动脚本（由 package-app.sh 生成）：用仓库里的 server/.venv 运行后端。
cd "$SERVER" && exec "$SERVER/.venv/bin/python" main.py
EOF
  chmod +x "$RES/backend/speakmore-backend"
  echo "后端：本机脚本 → $SERVER"
  BACKEND_DIR=""
elif [ ! -x "$BACKEND_DIR/speakmore-backend" ] && [ "${SPEAKMORE_BUILD_BACKEND:-0}" = "1" ]; then
  echo "== 构建语音后端（PyInstaller）"
  bash "$ROOT/scripts/build-backend-macos.sh"
fi
if [ -n "$BACKEND_DIR" ] && [ -x "$BACKEND_DIR/speakmore-backend" ]; then
  mkdir -p "$RES"
  ditto "$BACKEND_DIR" "$RES/backend"
  echo "后端：$BACKEND_DIR"
elif [ -z "${SPEAKMORE_LOCAL_BACKEND_DIR:-}" ]; then
  echo "警告：没有找到语音后端（${SPEAKMORE_BACKEND_DIR:-$ROOT/release-artifacts/backend}/speakmore-backend），App 会依赖已运行的后端。设置 SPEAKMORE_BUILD_BACKEND=1 可以现场构建。" >&2
fi

FFMPEG_SOURCE="${FFMPEG_PATH:-}"
[ -n "$FFMPEG_SOURCE" ] || { [ -x "$ROOT/release-artifacts/ffmpeg/bin/ffmpeg" ] && FFMPEG_SOURCE="$ROOT/release-artifacts/ffmpeg/bin/ffmpeg"; } || true
[ -n "$FFMPEG_SOURCE" ] || FFMPEG_SOURCE="$(command -v ffmpeg || true)"
if [ -n "$FFMPEG_SOURCE" ] && [ -x "$FFMPEG_SOURCE" ]; then
  mkdir -p "$RES/ffmpeg/bin"
  cp "$FFMPEG_SOURCE" "$RES/ffmpeg/bin/ffmpeg"
  chmod +x "$RES/ffmpeg/bin/ffmpeg"
  echo "ffmpeg：$FFMPEG_SOURCE"
else
  echo "警告：没有找到 ffmpeg，后端转码会失败。设置 FFMPEG_PATH 指定。" >&2
fi

echo "== 签名（$IDENTITY）"
# 往 App 里放了文件之后必须重新签名；--deep 连同里面的后端、ffmpeg 一起签。
codesign --force --deep --sign "$IDENTITY" --timestamp=none "$FINAL"

echo "== 检查内容"
bash "$TOOLS/verify-app.sh" "$FINAL"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$FINAL/Contents/Info.plist")"
ZIP="$OUT/SpeakMore-$VERSION-arm64.zip"
DMG="$OUT/SpeakMore-$VERSION-arm64.dmg"
rm -f "$ZIP" "$DMG"

echo "== 生成 zip"
ditto -c -k --keepParent "$FINAL" "$ZIP"

echo "== 生成 dmg"
STAGING="$(mktemp -d)"
ditto "$FINAL" "$STAGING/SpeakMore.app"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "SpeakMore" -srcfolder "$STAGING" -ov -format UDZO "$DMG" >/dev/null

echo "== 完成"
du -sh "$FINAL" "$ZIP" "$DMG"
