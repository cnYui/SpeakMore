#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON:-}"

if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x "$ROOT/server/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT/server/.venv/bin/python"
  else
    PYTHON_BIN="$(command -v python3 || command -v python)"
  fi
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "未找到 Python，请先准备 server/.venv 或把 python3 加入 PATH" >&2
  exit 1
fi

if [[ "${SPEAKMORE_SKIP_PIP_INSTALL:-0}" != "1" ]]; then
  "$PYTHON_BIN" -m pip install -r "$ROOT/server/requirements.txt"
fi

rm -rf "$ROOT/build/pyinstaller/speakmore-backend"
rm -rf "$ROOT/release-artifacts/backend"
rm -f "$ROOT/release-artifacts/speakmore-backend"
mkdir -p "$ROOT/release-artifacts"

# spec 使用 onedir，COLLECT 名为 backend，产物落在 release-artifacts/backend/（可执行文件 + _internal/）
"$PYTHON_BIN" -m PyInstaller \
  "$ROOT/packaging/pyinstaller/speakmore-backend.spec" \
  --distpath "$ROOT/release-artifacts" \
  --workpath "$ROOT/build/pyinstaller" \
  --noconfirm \
  --clean

BACKEND="$ROOT/release-artifacts/backend/speakmore-backend"
if [[ ! -x "$BACKEND" ]]; then
  echo "后端可执行文件构建失败: $BACKEND" >&2
  exit 1
fi

echo "backend built: $BACKEND"
