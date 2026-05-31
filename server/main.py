"""Typeless 本地后端服务 - 复现 /ai/voice_flow 和 WebSocket 接口"""

import asyncio
import json
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from asr import (
    DOWNLOAD_SOURCE,
    create_streaming_asr_session,
    preload_asr_model,
    resolve_streaming_model_source,
    transcribe_audio,
)
from model_manager import (
    SENSEVOICE_SMALL_MODEL_ID,
    SENSEVOICE_SMALL_REPO_ID,
    configure_model_cache_dir,
    find_cached_model_snapshot,
    get_managed_model_cache_root,
)
from refiner import refine_text, reload_refiner_runtime_config
from runtime_config import (
    get_cors_allowed_origins,
    get_server_host,
    get_server_port,
    load_server_env,
)

load_server_env()

MODEL_MISSING_DETAIL = "还没有下载语音模型，请先下载模型。"


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


async def transcribe_audio_with_wav_conversion(source_path: str, suffix: str) -> str:
    del suffix
    return await transcribe_audio(source_path)


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
    if parameters is not None:
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


def normalize_ws_object(value) -> dict:
    return value if isinstance(value, dict) else {}


def get_pcm_streaming_sample_rate(parameters: dict) -> int:
    audio_format = parameters.get("audio_format")
    if not isinstance(audio_format, dict):
        return 0
    if audio_format.get("type") != "pcm_s16le":
        return 0
    try:
        sample_rate = int(audio_format.get("sample_rate") or 16000)
        channels = int(audio_format.get("channels") or 1)
    except (TypeError, ValueError):
        return 0
    if channels != 1 or sample_rate <= 0:
        return 0
    return sample_rate


def normalize_ws_text_message(raw_text: str) -> tuple[dict | None, dict | None]:
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as error:
        return None, {"code": "invalid_json", "detail": str(error)}

    if not isinstance(data, dict):
        return None, {"code": "invalid_message", "detail": "WebSocket 消息必须是 JSON 对象"}

    return data, None


def normalize_json_object_field(raw_value: str | None) -> dict:
    if not raw_value:
        return {}

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return {}

    return parsed if isinstance(parsed, dict) else {}


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


def get_model_cache_dir() -> str:
    return str(get_managed_model_cache_root(SENSEVOICE_SMALL_MODEL_ID))


def apply_model_cache_dir(cache_dir: str | None) -> str:
    return str(configure_model_cache_dir(cache_dir))


async def read_model_cache_dir_from_request(request: Request) -> str:
    try:
        payload = await request.json()
    except Exception:
        return ""
    if not isinstance(payload, dict):
        return ""
    value = payload.get("cache_dir")
    return value.strip() if isinstance(value, str) else ""


def is_sensevoice_cached() -> bool:
    return find_cached_model_snapshot(SENSEVOICE_SMALL_MODEL_ID) is not None


def create_voice_service_state(status: str, detail: str = "", started_at: float | None = None) -> dict[str, str | int | bool | None]:
    now = time.time()
    return {
        "status": status,
        "detail": detail,
        "model_id": SENSEVOICE_SMALL_MODEL_ID,
        "repo_id": SENSEVOICE_SMALL_REPO_ID,
        "cache_dir": get_model_cache_dir(),
        "cached": is_sensevoice_cached(),
        "ready": status == "ready",
        "started_at": started_at,
        "updated_at": now,
        "elapsed_ms": int((now - started_at) * 1000) if started_at else 0,
    }


def set_voice_service_state(app: FastAPI, status: str, detail: str = "", started_at: float | None = None) -> None:
    current = getattr(app.state, "voice_service_status", None)
    if started_at is None and isinstance(current, dict) and status in {"downloading", "loading"}:
        current_started_at = current.get("started_at")
        started_at = current_started_at if isinstance(current_started_at, float) else time.time()
    app.state.voice_service_status = create_voice_service_state(status, detail, started_at)


def get_voice_service_state(app: FastAPI) -> dict:
    current = getattr(app.state, "voice_service_status", None)
    if not isinstance(current, dict):
        return create_voice_service_state("idle", MODEL_MISSING_DETAIL)

    current = {
        **current,
        "cache_dir": get_model_cache_dir(),
        "cached": is_sensevoice_cached(),
        "ready": current.get("status") == "ready",
    }
    started_at = current.get("started_at")
    if isinstance(started_at, (float, int)):
        current = {
            **current,
            "elapsed_ms": int((time.time() - float(started_at)) * 1000),
        }
    return current


def is_voice_service_ready(app: FastAPI) -> bool:
    return get_voice_service_state(app)["status"] == "ready"


def require_voice_service_ready(request: Request) -> None:
    if not is_voice_service_ready(request.app):
        raise HTTPException(status_code=503, detail="语音后端尚未就绪")


def get_voice_model_status(app: FastAPI) -> dict:
    return get_voice_service_state(app)


def is_voice_model_task_running(app: FastAPI) -> bool:
    task = getattr(app.state, "voice_preload_task", None)
    return bool(task and not task.done())


async def preload_voice_service(
    app: FastAPI,
    preload_model,
    exit_scheduler,
    exit_on_failure: bool = False,
) -> None:
    started_at = time.time()
    try:
        source = resolve_streaming_model_source()
        if source.kind == DOWNLOAD_SOURCE:
            set_voice_service_state(app, "downloading", "正在下载 SenseVoiceSmall 模型", started_at)
        else:
            set_voice_service_state(app, "loading", "正在加载 SenseVoiceSmall 模型", started_at)

        await asyncio.to_thread(preload_model)
        set_voice_service_state(app, "ready", "ASR 模型已完成预热")
    except Exception as error:
        set_voice_service_state(app, "failed", str(error))
        if exit_on_failure:
            exit_scheduler(1)


def start_voice_model_task(app: FastAPI, preload_model, exit_scheduler, exit_on_failure: bool = False) -> None:
    if is_voice_service_ready(app) or is_voice_model_task_running(app):
        return

    set_voice_service_state(app, "loading", "正在准备 SenseVoiceSmall 模型", time.time())
    app.state.voice_preload_task = asyncio.create_task(
        preload_voice_service(app, preload_model, exit_scheduler, exit_on_failure=exit_on_failure),
    )


def create_flow_success_payload(refined_text: str, raw_text: str = "") -> dict:
    return {
        "status": "OK",
        "data": {
            "refine_text": refined_text,
            "delivery": "inline",
            "user_prompt": raw_text,
            "web_metadata": None,
            "external_action": None,
        },
    }


def create_flow_error_payload(detail: str, code: str, raw_text: str = "") -> dict:
    return {
        "status": "ERROR",
        "data": {
            "refine_text": f"错误: {detail}",
            "delivery": "inline",
            "user_prompt": raw_text,
            "detail": detail,
            "code": code,
            "important_notification": None,
        },
    }


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
        context = normalize_json_object_field(audio_context)
        params = normalize_json_object_field(parameters)
        raw_text = await transcribe_audio_with_wav_conversion(tmp_path, suffix)

        if not raw_text or not raw_text.strip():
            return create_flow_success_payload(refined_text="", raw_text="")

        refined = await refine_text(
            raw_text=raw_text,
            mode=mode,
            context=context,
            parameters=params,
        )

        return create_flow_success_payload(refined_text=refined, raw_text=raw_text)
    except Exception as error:
        return create_flow_error_payload(detail=str(error), code="voice_flow_failed")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def ws_voice_flow(websocket: WebSocket, app_instance: FastAPI | None = None):
    await websocket.accept()

    audio_id = ""
    mode = "transcript"
    context = {}
    parameters = {}
    audio_chunks: list[bytes] = []
    streaming_session = None
    streaming_chunk_index = 0

    try:
        while True:
            message = await websocket.receive()

            if message["type"] != "websocket.receive":
                continue

            if "bytes" in message and message["bytes"]:
                if streaming_session is not None:
                    try:
                        results = await asyncio.to_thread(streaming_session.append_pcm16, message["bytes"])
                    except Exception as error:
                        streaming_session = None
                        audio_chunks = []
                        await send_ws_error_message(
                            websocket,
                            "transcription_error",
                            audio_id,
                            str(error),
                            "transcription_failed",
                        )
                        continue

                    for result in results:
                        streaming_chunk_index += 1
                        if result.text:
                            await send_ws_message(
                                websocket,
                                "transcription",
                                {
                                    "text": result.text,
                                    "audio_id": audio_id,
                                    "chunk_index": streaming_chunk_index,
                                },
                            )
                else:
                    audio_chunks.append(message["bytes"])
                    await websocket.send_json({
                        "K": "received_audio_chunk_count",
                        "V": {"count": len(audio_chunks), "audio_id": audio_id},
                    })
                continue

            if "text" not in message or not message["text"]:
                continue

            data, parse_error = normalize_ws_text_message(message["text"])
            if parse_error:
                await send_ws_message(websocket, "error", parse_error)
                continue

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
                mode = data.get("mode", "transcript") if isinstance(data.get("mode"), str) else "transcript"
                context = normalize_ws_object(data.get("audio_context", {}))
                parameters = normalize_ws_object(data.get("parameters", {}))
                audio_chunks = []
                streaming_session = None
                streaming_chunk_index = 0
                sample_rate = get_pcm_streaming_sample_rate(parameters)
                if sample_rate:
                    try:
                        streaming_session = create_streaming_asr_session(sample_rate=sample_rate)
                    except RuntimeError:
                        streaming_session = None

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
                if streaming_session is not None:
                    current_streaming_session = streaming_session
                    streaming_session = None
                    try:
                        final_result = await asyncio.to_thread(current_streaming_session.finalize)
                        raw_text = final_result.text
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
                        streaming_chunk_index += 1
                        await send_ws_message(
                            websocket,
                            "transcription",
                            {"text": raw_text, "audio_id": audio_id, "chunk_index": streaming_chunk_index},
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
                    continue

                if not audio_chunks:
                    continue

                current_chunks = audio_chunks
                audio_chunks = []
                audio_data = b"".join(current_chunks)
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
                continue

            if msg_type == "replace_audio_context":
                context = normalize_audio_context_update(data)
                continue

            if msg_type == "ping":
                await send_ws_message(websocket, "pong", {})
                continue

            if msg_type == "set_mode_config":
                mode = normalize_mode_update(data, mode)
                next_parameters = normalize_ws_object(data.get("parameters", {}))
                if next_parameters:
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


def create_app(
    preload_model=preload_asr_model,
    exit_scheduler=schedule_startup_failure_exit,
    auto_preload_model: bool = False,
    exit_on_preload_failure: bool = False,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        set_voice_service_state(app, "idle", MODEL_MISSING_DETAIL)
        if auto_preload_model:
            start_voice_model_task(
                app,
                preload_model,
                exit_scheduler,
                exit_on_failure=exit_on_preload_failure,
            )
        try:
            yield
        finally:
            preload_task = getattr(app.state, "voice_preload_task", None)
            if preload_task:
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

    @app.get("/model/status")
    async def model_status(request: Request):
        apply_model_cache_dir(request.query_params.get("cache_dir"))
        return get_voice_model_status(app)

    @app.post("/model/download")
    async def model_download(request: Request):
        apply_model_cache_dir(await read_model_cache_dir_from_request(request))
        start_voice_model_task(app, preload_model, exit_scheduler, exit_on_failure=False)
        return get_voice_model_status(app)

    @app.post("/config/reload")
    async def reload_config():
        reload_refiner_runtime_config()
        return {"status": "ok", "detail": "大模型配置已重载"}

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
