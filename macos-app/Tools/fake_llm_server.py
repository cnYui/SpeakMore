#!/usr/bin/env python3
"""端到端测试用的假大模型服务：兼容 OpenAI 的 POST {base}/chat/completions，固定回一句话。

语音后端润色时会按设置里的 base_url 调大模型。端到端测试（Tools/e2e-voice.sh）把 base_url 指到这里，
这样整条链路（麦克风 → WebSocket → ASR → 润色 → 完成消息）不需要真实的 API Key 也能跑通。
每次请求的 Authorization 头和 user 消息会追加写进日志文件，测试脚本据此确认 Key、词典有没有送到。

用法：python3 fake_llm_server.py <端口> <日志文件>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

REPLY = "FAKE_REFINED"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        user = ""
        for message in body.get("messages", []):
            if message.get("role") == "user":
                user = message.get("content", "")
        with open(LOG_PATH, "a", encoding="utf-8") as log:
            log.write(json.dumps({
                "path": self.path,
                "authorization": self.headers.get("authorization", ""),
                "model": body.get("model", ""),
                "user": user,
            }, ensure_ascii=False) + "\n")
        payload = json.dumps({
            "id": "fake-1",
            "object": "chat.completion",
            "created": 0,
            "model": body.get("model", "fake"),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": REPLY}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    PORT = int(sys.argv[1])
    LOG_PATH = sys.argv[2]
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
