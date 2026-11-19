#!/usr/bin/env bash
# 检查打好的原生版 SpeakMore.app（在 Mac 上运行）：结构、Info.plist、图标、签名、内置后端和 ffmpeg 是不是可执行。
# 用法：bash macos-app/Tools/verify-app.sh path/to/SpeakMore.app
set -euo pipefail

APP="${1:?用法：verify-app.sh SpeakMore.app}"
PLIST="$APP/Contents/Info.plist"
RES="$APP/Contents/Resources"
fail() { echo "✗ $1" >&2; exit 1; }
ok() { echo "✓ $1"; }
plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2>/dev/null || true; }

[ -d "$APP" ] || fail "找不到 $APP"
[ -x "$APP/Contents/MacOS/SpeakMore" ] || fail "主程序不存在或不可执行"
ok "主程序"

[ "$(plist CFBundleIdentifier)" = "cn.yui.speakmore.native" ] || fail "CFBundleIdentifier 不对：$(plist CFBundleIdentifier)"
[ "$(plist CFBundleName)" = "SpeakMore" ] || fail "CFBundleName 不对"
[ -n "$(plist NSMicrophoneUsageDescription)" ] || fail "缺少麦克风用途说明（NSMicrophoneUsageDescription），系统会直接拒绝录音"
[ "$(plist LSMinimumSystemVersion)" = "26.0" ] || fail "LSMinimumSystemVersion 不是 26.0"
ok "Info.plist（标识、麦克风说明、最低系统 26.0）"

[ -f "$RES/AppIcon.icns" ] || [ -f "$RES/Assets.car" ] || fail "没有应用图标资源"
ok "应用图标"

[ -d "$RES/zh-Hans.lproj" ] && [ -d "$RES/en.lproj" ] || fail "缺少中英文本地化资源"
ok "中英文本地化"

if [ -x "$RES/backend/speakmore-backend" ]; then
  ok "内置后端 $(du -sh "$RES/backend" | cut -f1)"
else
  echo "! 没有内置后端（App 要依赖已运行的后端）"
fi
if [ -x "$RES/ffmpeg/bin/ffmpeg" ]; then
  "$RES/ffmpeg/bin/ffmpeg" -version >/dev/null 2>&1 || fail "内置 ffmpeg 无法运行"
  ok "内置 ffmpeg"
else
  echo "! 没有内置 ffmpeg"
fi

codesign --verify --deep --strict "$APP" 2>&1 || fail "签名校验失败"
ok "签名校验通过（$(codesign -dv "$APP" 2>&1 | grep -E '^(Signature|Authority)=' | head -1)）"

ARCHS="$(lipo -archs "$APP/Contents/MacOS/SpeakMore" 2>/dev/null || true)"
ok "架构：$ARCHS"
echo "验证通过：$APP"
