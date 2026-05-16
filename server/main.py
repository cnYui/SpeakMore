"""Typeless 本地后端服务 - 复现 /ai/voice_flow 和 WebSocket 接口"""

import asyncio
import json
import os
import subprocess
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from asr import preload_whisper_model, transcribe_audio
from refiner import refine_text
from runtime_config import (
    get_cors_allowed_origins,
    get_server_host,
    get_server_port,
    load_server_env,
)

load_server_env()


def should_enable_reload() -> bool:
    return os.getenv("UVICORN_RELOAD", "").strip().lower() in {"1", "true", "yes", "on"}


def detect_uploaded_audio_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".wav", ".ogg", ".webm", ".mp3", ".m4a", ".opus"}:
        return suffix
    return ".wav"


def detect_realtime_audio_suffix(audio_data: bytes) -> str:
    if audio_data[:4] == b"OggS":
        return ".ogg"
    if audio_data[:4] == b"RIFF":
        return ".wav"
    if audio_data[:4] == bytes.fromhex("1A45DFA3"):
        return ".webm"
    return ".webm"


def convert_audio_to_wav_if_needed(source_path: str, suffix: str) -> str:
    if suffix == ".wav":
        return source_path

    wav_path = source_path + ".wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", source_path, "-ar", "16000", "-ac", "1", wav_path],
        capture_output=True,
        timeout=30,
        check=True,
    )
    return wav_path


async def transcribe_audio_with_wav_conversion(source_path: str, suffix: str) -> str:
    wav_path = convert_audio_to_wav_if_needed(source_path, suffix)
    try:
        return await transcribe_audio(wav_path)
    finally:
        if wav_path != source_path and os.path.exists(wav_path):
            os.unlink(wav_path)


def create_ws_message(message_type: str, payload: dict | None = None) -> dict:
    return {"K": message_type, "V": payload or {}}


async def send_ws_message(websocket: WebSocket, message_type: str, payload: dict | None = None) -> None:
    await websocket.send_json(create_ws_message(message_type, payload))


async def send_ws_error_message(
    websocket: WebSocket,
    message_type: str,
    audio_id: str,
    detail: str,
    code: str,
) -> None:
    await send_ws_message(
        websocket,
        message_type,
        {
            "audio_id": audio_id,
            "detail": detail,
            "code": code,
        },
    )


def create_process_mode_payload(audio_id: str, mode: str, parameters: dict | None = None) -> dict:
    payload = {"audio_id": audio_id, "mode": mode}
    if parameters:
        payload["parameters"] = parameters
    return payload


def normalize_audio_context_update(payload: dict) -> dict:
    candidate = payload.get("audio_context", payload.get("context", {}))
    return candidate if isinstance(candidate, dict) else {}


def normalize_mode_update(payload: dict, current_mode: str) -> str:
    explicit_mode = payload.get("mode")
    if isinstance(explicit_mode, str) and explicit_mode:
        return explicit_mode

    mode_config = payload.get("mode_config")
    if isinstance(mode_config, dict):
        nested_mode = mode_config.get("mode")
        if isinstance(nested_mode, str) and nested_mode:
            return nested_mode

    return current_mode


def normalize_selected_text(payload: dict) -> str:
    for key in ("selected_text", "text", "value"):
        value = payload.get(key)
        if isinstance(value, str):
            return value
    return ""


def get_ws_completion_message_type(mode: str, parameters: dict) -> str:
    if parameters.get("selected_text"):
        return "refine_selected_text"
    if mode != "transcript":
        return "refine_completed"
    return "audio_processing_completed"


def get_ws_refine_error_message_type(mode: str, parameters: dict) -> str:
    if parameters.get("selected_text"):
        return "refine_selected_text_error"
    if mode != "transcript":
        return "refine_error"
    return "audio_processing_error"


def schedule_startup_failure_exit(exit_code: int = 1) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        os._exit(exit_code)
        return

    loop.call_later(0.1, os._exit, exit_code)


def set_voice_service_state(app: FastAPI, status: str, detail: str = "") -> None:
    app.state.voice_service_status = {"status": status, "detail": detail}


def get_voice_service_state(app: FastAPI) -> dict[str, str]:
    return getattr(app.state, "voice_service_status", {"status": "starting", "detail": "ASR 模型预热中"})


def is_voice_service_ready(app: FastAPI) -> bool:
    return get_voice_service_state(app)["status"] == "ready"


def require_voice_service_ready(request: Request) -> None:
    if not is_voice_service_ready(request.app):
        raise HTTPException(status_code=503, detail="语音后端尚未就绪")


async def preload_voice_service(app: FastAPI, preload_model, exit_scheduler) -> None:
    try:
        await asyncio.to_thread(preload_model)
        set_voice_service_state(app, "ready", "ASR 模型已完成预热")
    except Exception as error:
        set_voice_service_state(app, "failed", str(error))
        exit_scheduler(1)


async def handle_voice_flow_request(
    audio_file: UploadFile,
    mode: str,
    audio_context: str,
    parameters: str,
) -> dict:
    suffix = detect_uploaded_audio_suffix(audio_file.filename)
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio_file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        context = json.loads(audio_context) if audio_context else {}
        params = json.loads(parameters) if parameters else {}
        raw_text = await transcribe_audio_with_wav_conversion(tmp_path, suffix)

        if not raw_text or not raw_text.strip():
            return {"status": "OK", "data": {"refine_text": "", "delivery": "inline"}}

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
                "web_metadata": None,
                "external_action": None,
            },
        }
    except Exception as error:
        return {
            "status": "ERROR",
            "data": {
                "refine_text": f"错误: {error}",
                "delivery": "inline",
                "user_prompt": "",
                "detail": str(error),
                "code": "voice_flow_failed",
                "important_notification": None,
            },
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def handle_text_flow_request(
    text: str,
    mode: str,
    context: dict | None = None,
    parameters: dict | None = None,
) -> dict:
    raw_text = text.strip() if isinstance(text, str) else ""
    safe_context = context if isinstance(context, dict) else {}
    params = parameters if isinstance(parameters, dict) else {}

    if not raw_text:
        return {"status": "OK", "data": {"refine_text": "", "delivery": "inline"}}

    try:
        refined = await refine_text(
            raw_text=raw_text,
            mode=mode,
            context=safe_context,
            parameters=params,
        )

        return {
            "status": "OK",
            "data": {
                "refine_text": refined,
                "delivery": "inline",
                "user_prompt": raw_text,
                "web_metadata": None,
                "external_action": None,
            },
        }
    except Exception as error:
        return {
            "status": "ERROR",
            "data": {
                "refine_text": f"错误: {error}",
                "delivery": "inline",
                "user_prompt": raw_text,
                "detail": str(error),
                "code": "text_flow_failed",
                "important_notification": None,
            },
        }


async def ws_voice_flow(websocket: WebSocket, app_instance: FastAPI | None = None):
    await websocket.accept()

    audio_id = ""
    mode = "transcript"
    context = {}
    parameters = {}
    audio_chunks: list[bytes] = []

    try:
        while True:
            message = await websocket.receive()

            if message["type"] != "websocket.receive":
                continue

            if "bytes" in message and message["bytes"]:
                audio_chunks.append(message["bytes"])
                await websocket.send_json({
                    "K": "received_audio_chunk_count",
                    "V": {"count": len(audio_chunks), "audio_id": audio_id},
                })
                continue

            if "text" not in message or not message["text"]:
                continue

            data = json.loads(message["text"])
            msg_type = data.get("type", "")

            if app_instance is not None and not is_voice_service_ready(app_instance) and msg_type != "ping":
                await send_ws_message(
                    websocket,
                    "error",
                    {"code": 503, "detail": "语音后端尚未就绪"},
                )
                continue

            if msg_type == "start_audio":
                audio_id = data.get("audio_id", str(uuid.uuid4()))
                mode = data.get("mode", "transcript")
                context = data.get("audio_context", {})
                parameters = data.get("parameters", {})
                audio_chunks = []

                await send_ws_message(websocket, "session_started", {"audio_id": audio_id})
                await send_ws_message(
                    websocket,
                    "process_mode",
                    create_process_mode_payload(audio_id, mode, parameters),
                )
                await send_ws_message(websocket, "audio_session_started", {"audio_id": audio_id})
                continue

            if msg_type == "end_audio":
                await send_ws_message(websocket, "audio_session_ending", {"audio_id": audio_id})
                if audio_chunks:
                    audio_data = b"".join(audio_chunks)
                    suffix = detect_realtime_audio_suffix(audio_data)
                    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                        tmp.write(audio_data)
                        tmp_path = tmp.name

                    try:
                        try:
                            raw_text = await transcribe_audio_with_wav_conversion(tmp_path, suffix)
                        except Exception as error:
                            await send_ws_error_message(
                                websocket,
                                "transcription_error",
                                audio_id,
                                str(error),
                                "transcription_failed",
                            )
                            continue

                        if raw_text:
                            await send_ws_message(
                                websocket,
                                "transcription",
                                {"text": raw_text, "audio_id": audio_id, "chunk_index": 0},
                            )
                            try:
                                refined = await refine_text(
                                    raw_text=raw_text,
                                    mode=mode,
                                    context=context,
                                    parameters=parameters,
                                )
                            except Exception as error:
                                await send_ws_error_message(
                                    websocket,
                                    get_ws_refine_error_message_type(mode, parameters),
                                    audio_id,
                                    str(error),
                                    "audio_processing_failed",
                                )
                                continue

                            await send_ws_message(
                                websocket,
                                get_ws_completion_message_type(mode, parameters),
                                {
                                    "audio_id": audio_id,
                                    "refined_text": refined,
                                    "refine_text": refined,
                                    "delivery": "inline",
                                    "user_prompt": raw_text,
                                    "web_metadata": None,
                                    "external_action": None,
                                },
                            )
                        else:
                            await send_ws_message(
                                websocket,
                                get_ws_completion_message_type(mode, parameters),
                                {
                                    "audio_id": audio_id,
                                    "refined_text": "",
                                    "refine_text": "",
                                    "delivery": "inline",
                                },
                            )
                    finally:
                        os.unlink(tmp_path)

                audio_chunks = []
                continue

            if msg_type == "replace_audio_context":
                context = normalize_audio_context_update(data)
                continue

            if msg_type == "ping":
                await send_ws_message(websocket, "pong", {})
                continue

            if msg_type == "set_mode_config":
                mode = normalize_mode_update(data, mode)
                next_parameters = data.get("parameters")
                if isinstance(next_parameters, dict):
                    parameters = {**parameters, **next_parameters}
                await send_ws_message(
                    websocket,
                    "process_mode",
                    create_process_mode_payload(audio_id, mode, parameters),
                )
                continue

            if msg_type == "set_selected_text":
                selected_text = normalize_selected_text(data)
                if selected_text:
                    parameters = {**parameters, "selected_text": selected_text}
                continue

            if msg_type == "set_audio_chunk_info":
                continue

    except WebSocketDisconnect:
        pass


def create_app(preload_model=preload_whisper_model, exit_scheduler=schedule_startup_failure_exit) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        set_voice_service_state(app, "starting", "ASR 模型预热中")
        preload_task = asyncio.create_task(preload_voice_service(app, preload_model, exit_scheduler))
        try:
            yield
        finally:
            preload_task.cancel()

    app = FastAPI(title="Typeless Local Server", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_allowed_origins(),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health():
        return {
            "status": get_voice_service_state(app)["status"],
            "service": "typeless-local",
        }

    @app.get("/ready")
    async def ready():
        payload = get_voice_service_state(app)
        if is_voice_service_ready(app):
            return payload
        return JSONResponse(status_code=503, content=payload)

    @app.post("/ai/voice_flow")
    async def voice_flow(
        request: Request,
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
        del audio_id, audio_metadata, is_retry, device_name, user_over_time, send_time
        require_voice_service_ready(request)
        return await handle_voice_flow_request(
            audio_file=audio_file,
            mode=mode,
            audio_context=audio_context,
            parameters=parameters,
        )

    @app.post("/ai/text_flow")
    async def text_flow(request: Request, payload: dict):
        require_voice_service_ready(request)
        context = payload.get("context", {})
        parameters = payload.get("parameters", {})
        return await handle_text_flow_request(
            text=payload.get("text", ""),
            mode=payload.get("mode", "transcript"),
            context=context if isinstance(context, dict) else {},
            parameters=parameters if isinstance(parameters, dict) else {},
        )

    @app.websocket("/ws/rt_voice_flow")
    async def voice_flow_websocket(
        websocket: WebSocket,
        v: str | None = None,
        t: str | None = None,
        m: str | None = None,
    ):
        del v, t, m
        await ws_voice_flow(websocket, app)

    @app.get("/")
    async def index():
        return FileResponse(Path(__file__).parent / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=get_server_host(),
        port=get_server_port(),
        reload=should_enable_reload(),
    )
