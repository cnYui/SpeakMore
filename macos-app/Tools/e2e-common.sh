#!/usr/bin/env bash
# 端到端测试共用的环境（被 e2e-voice.sh / e2e-app.sh 用 source 引入，不要单独运行）：
#   1. 用 `say` 生成一段中文语音当“麦克风”（$WORK/speech.aiff）；
#   2. 起一个假大模型（Tools/fake_llm_server.py，默认 8791）和一个真实的语音后端（默认 8033，不碰 8000），并让后端加载模型；
#   3. 退出时关掉它们。
# 可选环境变量：E2E_BACKEND_PORT / E2E_LLM_PORT / E2E_MODEL_DIR / E2E_PYTHON / E2E_VOICE

TOOLS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$TOOLS/.." && pwd)"
REPO="$(cd "$APP/.." && pwd)"
WORK="$(mktemp -d)"
BACKEND_PORT="${E2E_BACKEND_PORT:-8033}"
LLM_PORT="${E2E_LLM_PORT:-8791}"
MODELS="${E2E_MODEL_DIR:-}"  # 留空 = 后端默认目录（~/Library/Application Support/SpeakMore/models/funasr）
PY="${E2E_PYTHON:-$REPO/server/.venv/bin/python}"
VOICE="${E2E_VOICE:-Eddy (中文（中国大陆）)}"
export PATH="/opt/homebrew/bin:$PATH"

PIDS=()
e2e_cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
}
trap e2e_cleanup EXIT

e2e_start_services() {
  echo "== 生成测试语音"
  say -v "$VOICE" -o "$WORK/speech.aiff" "今天我们来测试一下语音输入，请把这句话写到输入框里。"

  echo "== 启动假大模型 :$LLM_PORT 与语音后端 :$BACKEND_PORT"
  python3 "$TOOLS/fake_llm_server.py" "$LLM_PORT" "$WORK/llm.log" &
  PIDS+=($!)
  # 端口被别的进程占着时假大模型会起不来，请求就会打到别人的服务上，所以先确认回应的确实是它。
  for _ in $(seq 1 20); do
    curl -sf -m 2 -X POST "http://127.0.0.1:$LLM_PORT/v1/chat/completions" -d '{"messages":[]}' 2>/dev/null | grep -q FAKE_REFINED && break
    sleep 0.5
  done
  if ! curl -sf -m 2 -X POST "http://127.0.0.1:$LLM_PORT/v1/chat/completions" -d '{"messages":[]}' 2>/dev/null | grep -q FAKE_REFINED; then
    echo "假大模型没有起来：端口 $LLM_PORT 可能被占用（用 E2E_LLM_PORT 换一个）" >&2
    exit 1
  fi
  : >"$WORK/llm.log"  # 上面的探测请求不算数

  # E2E_SKIP_BACKEND=1：不替应用起后端（测试应用自己拉起内置后端）。
  if [ "${E2E_SKIP_BACKEND:-0}" != "1" ]; then
    (
      cd "$REPO/server"
      if [ -n "$MODELS" ]; then export TYPELESS_MODEL_CACHE_DIR="$MODELS"; fi
      # Mac 上开了系统代理时，httpx 会把 127.0.0.1 的请求也送去代理（返回 forbidden），所以显式排除本机地址。
      NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost \
      HOST=127.0.0.1 PORT="$BACKEND_PORT" SPEAKMORE_ASR_MODEL_ID=sensevoice-small-int8 \
        exec "$PY" main.py >"$WORK/backend.log" 2>&1
    ) &
    PIDS+=($!)

    # 后端启动后模型是 idle 状态，要有人让它加载（Electron 版由主进程做，原生版由后端管理器做）。
    echo "== 等后端起来并加载模型"
    for _ in $(seq 1 60); do
      curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null && break
      sleep 1
    done
    curl -sf -X POST "http://127.0.0.1:$BACKEND_PORT/model/download" \
      -H 'content-type: application/json' \
      -d "{\"model_id\":\"sensevoice-small-int8\"${MODELS:+,\"cache_dir\":\"$MODELS\"}}" >/dev/null
    for _ in $(seq 1 120); do
      curl -sf "http://127.0.0.1:$BACKEND_PORT/ready" >/dev/null && { echo "后端已就绪"; break; }
      sleep 1
    done
  fi
}

# 检查假大模型日志：API Key、模型名、词典都送到了润色步骤。
e2e_check_llm_log() {
  if [ ! -s "$WORK/llm.log" ]; then
    echo "（假大模型没有收到任何请求）"
    return 1
  fi
  python3 - "$WORK/llm.log" "${1:-}" <<'PY'
import json, sys
rows = [json.loads(line) for line in open(sys.argv[1], encoding="utf-8")]
first = rows[0]
print(f"共 {len(rows)} 次请求；path={first['path']} authorization={first['authorization']} model={first['model']}")
assert first["authorization"] == "Bearer sk-e2e", "API Key 没有送到后端的润色步骤"
assert first["model"] == "fake-model", "模型名没有送到"
if sys.argv[2] != "no-dictionary":
    assert "Claude Code" in first["user"], "词典没有出现在润色提示里"
print("OK：API Key、模型名" + ("" if sys.argv[2] == "no-dictionary" else "、词典") + "都随请求到达了润色步骤")
PY
}
