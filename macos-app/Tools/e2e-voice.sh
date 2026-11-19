#!/usr/bin/env bash
# 语音核心端到端测试（在 Mac 上跑，不需要麦克风 / 辅助功能权限）：
# 用 `say` 的中文语音当麦克风，真实后端 + 假大模型，跑 VoiceEndToEndTests——
# 真实 WebSocket → ASR → 润色 → 完成消息 → 写历史，以及“取消后再来一轮”。
#
# 用法：bash macos-app/Tools/e2e-voice.sh
set -euo pipefail
source "$(dirname "$0")/e2e-common.sh"
e2e_start_services

echo "== 运行 VoiceEndToEndTests"
cd "$APP/Packages/SpeakMoreCore"
set +e
SPEAKMORE_E2E_BACKEND="http://127.0.0.1:$BACKEND_PORT" \
SPEAKMORE_E2E_WAV="$WORK/speech.aiff" \
SPEAKMORE_E2E_LLM_URL="http://127.0.0.1:$LLM_PORT/v1" \
  swift test --filter VoiceEndToEndTests 2>&1 | grep -vE "^\[[0-9]+/[0-9]+\]|Compiling|Linking"
STATUS=${PIPESTATUS[0]}
set -e

echo "== 假大模型收到的请求"
e2e_check_llm_log || STATUS=1

if [ "$STATUS" -ne 0 ]; then
  echo "== 后端日志（末尾）"
  tail -n 30 "$WORK/backend.log" || true
fi
echo "工作目录：$WORK"
exit "$STATUS"
