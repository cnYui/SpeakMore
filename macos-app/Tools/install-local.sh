#!/usr/bin/env bash
# 在这台 Mac 上安装 SpeakMore：打包 → 装到 /Applications → 登记到系统。
# 装好之后它和普通 App 一样出现在“启动台 / 应用程序”和 Spotlight 里，点图标就启动；
# 后端由 App 自己拉起（用这份仓库的 server/.venv），所以这个本机安装版依赖当前仓库检出，仓库目录不要移动或删除。
#
# 用法：bash macos-app/Tools/install-local.sh [安装目录，默认 /Applications]
# 想拉到 Dock：装好后在“应用程序”里把 SpeakMore 拖到 Dock 上即可。
set -euo pipefail

TOOLS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$TOOLS/../.." && pwd)"
DEST_DIR="${1:-/Applications}"
DEST="$DEST_DIR/SpeakMore.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

[ -w "$DEST_DIR" ] || { echo "没有写入 $DEST_DIR 的权限；换一个目录，例如 ~/Applications" >&2; exit 1; }
mkdir -p "$DEST_DIR"

echo "== 打包（本机后端）"
SPEAKMORE_LOCAL_BACKEND_DIR="$ROOT/server" bash "$TOOLS/package-app.sh"
BUILT="$ROOT/release-artifacts/macos-native/SpeakMore.app"

echo "== 关掉正在运行的 SpeakMore（如果有）"
if pgrep -f 'SpeakMore.app/Contents/MacOS/SpeakMore' >/dev/null; then
  osascript -e 'tell application id "cn.yui.speakmore.native" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 10); do
    pgrep -f 'SpeakMore.app/Contents/MacOS/SpeakMore' >/dev/null || break
    sleep 0.5
  done
fi

echo "== 安装到 $DEST"
# 只替换 SpeakMore.app 本身，不碰同目录下的别的 App（比如 Electron 版 / Typeless）。
if [ -d "$DEST" ]; then rm -r "$DEST"; fi
ditto "$BUILT" "$DEST"
"$LSREGISTER" -f "$DEST"
touch "$DEST"

echo "== 检查"
bash "$TOOLS/verify-app.sh" "$DEST" | tail -3
echo "已安装：$DEST"
echo "点“启动台 / 应用程序”里的 SpeakMore 图标，或用 Spotlight 搜 SpeakMore，或运行：open -a SpeakMore"
