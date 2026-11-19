#!/usr/bin/env bash
# 把仓库根目录 shared/ 里的元数据复制到 Swift 包的资源目录。改了 shared/*.json 之后运行一次；
# SharedMetadataTests 会校验两边内容一致。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="$ROOT/macos-app/Packages/SpeakMoreCore/Sources/SpeakMoreCore/Resources"
mkdir -p "$DEST"
for name in llm-providers translation-target-languages asr-models; do
  cp "$ROOT/shared/$name.json" "$DEST/$name.json"
done
echo "synced shared metadata to $DEST"
