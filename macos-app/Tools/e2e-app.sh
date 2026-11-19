#!/usr/bin/env bash
# 整个原生应用的端到端验证（在 Mac 的图形会话里跑，不需要任何系统权限）：
# 应用用 `say` 生成的语音文件代替麦克风，自己驱动一轮听写（SPEAKMORE_DEMO_DICTATION），
# 连真实后端 + 假大模型；因为没有辅助功能权限，自动粘贴会按设计失败，结果回落到悬浮面板。
# 悬浮胶囊和悬浮面板每 0.5 秒渲染成 PNG 存到 $OUT，用来核对界面。
#
# E2E_SKIP_BACKEND=1 + E2E_APP_BUNDLE=打包好的 SpeakMore.app：不替应用起后端，验证 App 自己拉起内置后端并预加载模型。
# 前提：先构建过 Debug 版（xcodebuild … -derivedDataPath build/DerivedData）。
# 用法：bash macos-app/Tools/e2e-app.sh [输出目录]
set -euo pipefail
source "$(dirname "$0")/e2e-common.sh"
OUT="${1:-$WORK/shots}"
APP_BUNDLE="${E2E_APP_BUNDLE:-$APP/build/DerivedData/Build/Products/Debug/SpeakMore.app}"
[ -d "$APP_BUNDLE" ] || { echo "找不到 $APP_BUNDLE，先构建 Debug 版" >&2; exit 1; }
e2e_start_services

# 用独立的数据目录和设置，不碰用户自己的 local-data：大模型指向假服务，词典里放一个词。
DATA="$WORK/local-data"
mkdir -p "$DATA" "$OUT"
python3 - "$DATA" "http://127.0.0.1:$LLM_PORT/v1" <<'PY'
import json, sys
data, base = sys.argv[1], sys.argv[2]
provider = {"id": "custom", "label": "Fake", "baseUrl": base, "defaultModel": "fake-model", "allowBaseUrlEdit": True, "authType": "bearer"}
settings = {"asrModelId": "sensevoice-small-int8", "llm": {"providerId": "custom", "providers": [provider], "apiKeys": {"custom": "sk-e2e"}, "models": {"custom": "fake-model"}}}
open(f"{data}/settings.json", "w", encoding="utf-8").write(json.dumps(settings, ensure_ascii=False))
now = "2026-11-19T00:00:00.000Z"
entry = {"id": "dict_1", "phrase": "Claude Code", "aliases": ["cloud code"], "source": "manual", "status": "active",
         "hitCount": 0, "createdAt": now, "updatedAt": now, "lastLearnedAt": ""}
open(f"{data}/dictionary.json", "w", encoding="utf-8").write(json.dumps([entry], ensure_ascii=False))
PY

echo "== 启动应用，自动听写一轮（录 5 秒）"
pkill -f 'MacOS/SpeakMore' 2>/dev/null || true
sleep 1
open -n "$APP_BUNDLE" \
  --env SPEAKMORE_LOCAL_DATA_DIR="$DATA" \
  --env SPEAKMORE_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
  --env NO_PROXY=127.0.0.1,localhost --env no_proxy=127.0.0.1,localhost \
  --env PORT="$BACKEND_PORT" \
  ${E2E_BACKEND_DEV:+--env SPEAKMORE_BACKEND_DEV_DIR="$REPO/server"} \
  --env SPEAKMORE_VOICE_WAV="$WORK/speech.aiff" \
  --env SPEAKMORE_DEMO_DICTATION=5 \
  --env SPEAKMORE_DEMO_MODE="${E2E_DEMO_MODE:-Dictate}" \
  --env SPEAKMORE_OVERLAY_SNAPSHOT_DIR="$OUT"
for _ in $(seq 1 150); do
  sleep 1
  pgrep -f 'MacOS/SpeakMore' >/dev/null || break
done

echo "== 应用日志"
cat "$OUT/demo-log.txt" 2>/dev/null || { echo "（没有 demo-log.txt，应用可能没跑完）"; exit 1; }
echo "== 悬浮窗口截图"
ls "$OUT" | grep -E "png$" | head -40

echo "== 假大模型收到的请求"
e2e_check_llm_log
echo "历史记录："
python3 -c "import json;[print(' ',i['status'],i['mode'],repr(i['rawText']),'->',repr(i['refinedText'])) for i in json.load(open('$DATA/history.json'))]"
echo "输出目录：$OUT"
