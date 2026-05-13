"""Typeless 本地后端服务 - 复现 /ai/voice_flow 和 WebSocket 接口"""

import os
import json
import uuid
import tempfile
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from asr import transcribe_audio
from refiner import refine_text

load_dotenv()

app = FastAPI(title="Typeless Local Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/ai/voice_flow")
async def voice_flow(
    audio_file: UploadFile = File(...),
    audio_id: str = Form(""),
    mode: str = Form("transcript"),
    audio_context: str = Form("{}"),
    audio_metadata: str = Form("{}"),
    parameters: str = Form("{}"),
    is_retry: str = Form("false"),
    device_name: str = Form(""),
    user_over_time: str = Form(""),
    send_time: str = Form(""),
):
    """复现 Typeless 的 /ai/voice_flow 接口
    
    流程：音频文件 → ASR 转写 → DeepSeek refine → 返回结果
    """
    # 保存上传的音频到临时文件
    suffix = ".ogg" if audio_file.filename and audio_file.filename.endswith(".ogg") else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio_file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # 解析上下文
        context = json.loads(audio_context) if audio_context else {}
        params = json.loads(parameters) if parameters else {}

        # 如果是 webm/ogg 格式，用 ffmpeg 转为 wav
        wav_path = tmp_path
        if suffix != ".wav":
            wav_path = tmp_path + ".wav"
            import subprocess
            subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", wav_path],
                capture_output=True, timeout=30,
            )

        # ASR 转写
        raw_text = await transcribe_audio(wav_path)

        if wav_path != tmp_path:
            os.unlink(wav_path)

        if not raw_text or not raw_text.strip():
            return {"status": "OK", "data": {"refine_text": "", "delivery": "inline"}}

        # DeepSeek refine 润色
        refined = await refine_text(
            raw_text=raw_text,
            mode=mode,
            context=context,
            parameters=params,
        )

        return {
            "status": "OK",
            "data": {
                "refine_text": refined,
                "delivery": "inline",
                "user_prompt": raw_text,
            },
        }
    except Exception as e:
        return {"status": "ERROR", "data": {"refine_text": f"错误: {e}", "delivery": "inline", "user_prompt": ""}}
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.websocket("/ws/rt_voice_flow")
async def ws_voice_flow(websocket: WebSocket):
    """复现 Typeless 的 WebSocket 实时语音流接口
    
    协议：
    - 客户端发送 JSON: {type: "start_audio", audio_id, mode, audio_context, ...}
    - 客户端发送 binary: 音频 chunks
    - 客户端发送 JSON: {type: "end_audio", audio_id, ...}
    - 服务端返回 JSON: {K: "transcription", V: {text, audio_id}}
    - 服务端返回 JSON: {K: "audio_processing_completed", V: {audio_id, refined_text, delivery}}
    """
    await websocket.accept()

    audio_id = ""
    mode = "transcript"
    context = {}
    parameters = {}
    audio_chunks: list[bytes] = []

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.receive":
                if "bytes" in message and message["bytes"]:
                    # 二进制音频 chunk
                    audio_chunks.append(message["bytes"])
                    # 确认收到
                    await websocket.send_json({
                        "K": "received_audio_chunk_count",
                        "V": {"count": len(audio_chunks), "audio_id": audio_id},
                    })

                elif "text" in message and message["text"]:
                    data = json.loads(message["text"])
                    msg_type = data.get("type", "")

                    if msg_type == "start_audio":
                        audio_id = data.get("audio_id", str(uuid.uuid4()))
                        mode = data.get("mode", "transcript")
                        context = data.get("audio_context", {})
                        parameters = data.get("parameters", {})
                        audio_chunks = []

                        await websocket.send_json({
                            "K": "audio_session_started",
                            "V": {"audio_id": audio_id},
                        })

                    elif msg_type == "end_audio":
                        # 合并音频 chunks，转写并 refine
                        if audio_chunks:
                            audio_data = b"".join(audio_chunks)
                            suffix = ".ogg" if audio_data[:4] == b"OggS" else ".wav"
                            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                                tmp.write(audio_data)
                                tmp_path = tmp.name

                            try:
                                raw_text = await transcribe_audio(tmp_path)

                                # 发送转写中间结果
                                if raw_text:
                                    await websocket.send_json({
                                        "K": "transcription",
                                        "V": {"text": raw_text, "audio_id": audio_id, "chunk_index": 0},
                                    })

                                    # refine
                                    refined = await refine_text(
                                        raw_text=raw_text,
                                        mode=mode,
                                        context=context,
                                        parameters=parameters,
                                    )

                                    await websocket.send_json({
                                        "K": "audio_processing_completed",
                                        "V": {
                                            "audio_id": audio_id,
                                            "refined_text": refined,
                                            "refine_text": refined,
                                            "delivery": "inline",
                                            "user_prompt": raw_text,
                                        },
                                    })
                                else:
                                    await websocket.send_json({
                                        "K": "audio_processing_completed",
                                        "V": {
                                            "audio_id": audio_id,
                                            "refined_text": "",
                                            "refine_text": "",
                                            "delivery": "inline",
                                        },
                                    })
                            finally:
                                os.unlink(tmp_path)

                        audio_chunks = []

                    elif msg_type == "ping":
                        await websocket.send_json({"K": "pong", "V": {}})

                    elif msg_type == "set_audio_chunk_info":
                        pass  # 忽略 chunk info 消息

    except WebSocketDisconnect:
        pass


@app.get("/health")
async def health():
    return {"status": "ok", "service": "typeless-local"}


from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

@app.get("/")
async def index():
    return FileResponse(Path(__file__).parent / "index.html")


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
