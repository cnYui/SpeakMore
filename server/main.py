"""Typeless 本地后端服务 - 复现 /ai/voice_flow 和 WebSocket 接口"""

import asyncio
import inspect
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
    download_asr_model,
    get_asr_runtime_device_status,
    preload_asr_model,
    resolve_streaming_model_source,
    transcribe_audio,
    unload_asr_model,
)
from model_manager import (
    SENSEVOICE_SMALL_MODEL_ID,
    SUPPORTED_ASR_MODEL_IDS,
    configure_model_cache_dir,
    get_active_asr_model_id,
    get_managed_model_cache_root,
    get_model_display_metadata,
    get_model_repo_id,
    is_model_cached,
    normalize_asr_model_id,
    set_active_asr_model_id,
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
MODEL_CACHED_IDLE_DETAIL = "语音模型已下载，尚未加载，请加载模型后使用。"


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


async def read_model_request_payload(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


async def read_model_cache_dir_from_request(request: Request) -> str:
    value = (await read_model_request_payload(request)).get("cache_dir")
    return value.strip() if isinstance(value, str) else ""


def is_sensevoice_cached() -> bool:
    """当前选用的模型是否已在本机（保留旧函数名，兼容调用方）。"""
    return is_model_cached(get_active_asr_model_id())


def get_model_label(model_id: str) -> str:
    return get_model_display_metadata(model_id)["label"]


def normalize_download_progress(progress: dict | None = None) -> dict[str, int | None]:
    downloaded = progress.get("downloaded_bytes") if isinstance(progress, dict) else None
    total = progress.get("total_bytes") if isinstance(progress, dict) else None
    percent = progress.get("progress_percent") if isinstance(progress, dict) else None
    downloaded_files = progress.get("downloaded_files") if isinstance(progress, dict) else None
    total_files = progress.get("total_files") if isinstance(progress, dict) else None
    file_percent = progress.get("file_progress_percent") if isinstance(progress, dict) else None
    downloaded_bytes = max(0, int(downloaded)) if isinstance(downloaded, (int, float)) else 0
    total_bytes = max(0, int(total)) if isinstance(total, (int, float)) else 0
    progress_percent = int(percent) if isinstance(percent, (int, float)) else None
    downloaded_file_count = max(0, int(downloaded_files)) if isinstance(downloaded_files, (int, float)) else 0
    total_file_count = max(0, int(total_files)) if isinstance(total_files, (int, float)) else 0
    file_progress_percent = int(file_percent) if isinstance(file_percent, (int, float)) else None
    if progress_percent is not None:
        progress_percent = max(0, min(100, progress_percent))
    if file_progress_percent is not None:
        file_progress_percent = max(0, min(100, file_progress_percent))
    return {
        "downloaded_bytes": downloaded_bytes,
        "total_bytes": total_bytes,
        "progress_percent": progress_percent,
        "downloaded_files": downloaded_file_count,
        "total_files": total_file_count,
        "file_progress_percent": file_progress_percent,
    }


def create_voice_service_state(
    status: str,
    detail: str = "",
    started_at: float | None = None,
    download_progress: dict | None = None,
) -> dict[str, str | int | bool | None]:
    now = time.time()
    device_status = get_asr_runtime_device_status()
    cached = is_sensevoice_cached()
    normalized_detail = detail
    if status == "idle" and (not detail or detail == MODEL_MISSING_DETAIL):
        normalized_detail = MODEL_CACHED_IDLE_DETAIL if cached else MODEL_MISSING_DETAIL
    return {
        "status": status,
        "detail": normalized_detail,
        "model_id": get_active_asr_model_id(),
        "repo_id": get_model_repo_id(get_active_asr_model_id()),
        "device": device_status.get("device"),
        "requested_device": device_status.get("requested_device"),
        "device_source": device_status.get("device_source"),
        "fallback_reason": device_status.get("fallback_reason"),
        "cache_dir": get_model_cache_dir(),
        "cached": cached,
        "ready": status == "ready",
        "started_at": started_at,
        "updated_at": now,
        "elapsed_ms": int((now - started_at) * 1000) if started_at else 0,
        **normalize_download_progress(download_progress),
    }


def set_voice_service_state(app: FastAPI, status: str, detail: str = "", started_at: float | None = None) -> None:
    current = getattr(app.state, "voice_service_status", None)
    if started_at is None and isinstance(current, dict) and status in {"downloading", "loading"}:
        current_started_at = current.get("started_at")
        started_at = current_started_at if isinstance(current_started_at, float) else time.time()
    app.state.voice_service_status = create_voice_service_state(status, detail, started_at)


def update_voice_service_download_progress(app: FastAPI, progress: dict) -> None:
    current = getattr(app.state, "voice_service_status", None)
    if not isinstance(current, dict):
        return
    app.state.voice_service_status = {
        **current,
        **normalize_download_progress(progress),
        "updated_at": time.time(),
    }


def preload_model_accepts_progress_callback(preload_model) -> bool:
    try:
        signature = inspect.signature(preload_model)
    except (TypeError, ValueError):
        return True
    return any(
        parameter.kind in {
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.KEYWORD_ONLY,
            inspect.Parameter.VAR_KEYWORD,
        }
        for parameter in signature.parameters.values()
    )


def call_preload_model(preload_model, progress_callback):
    if preload_model_accepts_progress_callback(preload_model):
        return preload_model(progress_callback)
    return preload_model()


def get_voice_service_state(app: FastAPI) -> dict:
    current = getattr(app.state, "voice_service_status", None)
    if not isinstance(current, dict):
        return create_voice_service_state("idle", MODEL_MISSING_DETAIL)

    cached = is_sensevoice_cached()
    current = {
        **current,
        **get_asr_runtime_device_status(),
        "cache_dir": get_model_cache_dir(),
        "cached": cached,
        "ready": current.get("status") == "ready",
    }
    # 缓存目录或当前模型变化后，空闲状态的提示要跟着“是否已下载”更新。
    if current.get("status") == "idle" and current.get("detail") in {MODEL_MISSING_DETAIL, MODEL_CACHED_IDLE_DETAIL}:
        current["detail"] = MODEL_CACHED_IDLE_DETAIL if cached else MODEL_MISSING_DETAIL
    started_at = current.get("started_at")
    if isinstance(started_at, (float, int)):
        current = {
            **current,
            "elapsed_ms": int((time.time() - float(started_at)) * 1000),
        }
    return {
        **current,
        "model_id": get_active_asr_model_id(),
        "repo_id": get_model_repo_id(get_active_asr_model_id()),
        "active_model_id": get_active_asr_model_id(),
        "models": build_models_status(app, current),
    }


def get_model_download_states(app: FastAPI) -> dict[str, dict]:
    states = getattr(app.state, "model_download_states", None)
    if not isinstance(states, dict):
        states = {}
        app.state.model_download_states = states
    return states


def build_models_status(app: FastAPI, active_state: dict) -> list[dict]:
    """初始化页的模型列表：当前选用的模型取语音服务状态，其它模型取各自的“只下载”任务状态。"""
    active_model_id = get_active_asr_model_id()
    download_states = get_model_download_states(app)
    models = []
    for model_id in SUPPORTED_ASR_MODEL_IDS:
        cached = is_model_cached(model_id)
        download_state = download_states.get(model_id) or {}
        download_busy = download_state.get("status") == "downloading"
        if model_id == active_model_id and not download_busy:
            status = str(active_state.get("status") or "idle")
            detail = str(active_state.get("detail") or "")
            progress = normalize_download_progress(active_state)
        else:
            status = str(download_state.get("status") or "idle")
            detail = str(download_state.get("detail") or "")
            progress = normalize_download_progress(download_state)
            if status == "done":
                status = "idle"
        models.append({
            "model_id": model_id,
            "repo_id": get_model_repo_id(model_id),
            **get_model_display_metadata(model_id),
            "active": model_id == active_model_id,
            "cached": cached,
            "status": status,
            "detail": detail,
            **progress,
        })
    return models


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
        label = get_model_label(source.model_id)
        if source.kind == DOWNLOAD_SOURCE:
            set_voice_service_state(app, "downloading", f"正在下载 {label} 模型", started_at)
        else:
            set_voice_service_state(app, "loading", f"正在加载 {label} 模型", started_at)

        await asyncio.to_thread(
            call_preload_model,
            preload_model,
            lambda progress: update_voice_service_download_progress(app, progress),
        )
        set_voice_service_state(app, "ready", "ASR 模型已完成预热")
    except Exception as error:
        set_voice_service_state(app, "failed", str(error))
        if exit_on_failure:
            exit_scheduler(1)


def start_voice_model_task(app: FastAPI, preload_model, exit_scheduler, exit_on_failure: bool = False) -> None:
    if is_voice_service_ready(app) or is_voice_model_task_running(app):
        return

    set_voice_service_state(app, "loading", f"正在准备 {get_model_label(get_active_asr_model_id())} 模型", time.time())
    app.state.voice_preload_task = asyncio.create_task(
        preload_voice_service(app, preload_model, exit_scheduler, exit_on_failure=exit_on_failure),
    )


def is_model_download_running(app: FastAPI, model_id: str) -> bool:
    tasks = getattr(app.state, "model_download_tasks", None)
    task = tasks.get(model_id) if isinstance(tasks, dict) else None
    return bool(task and not task.done())


def apply_requested_model_id(app: FastAPI, requested_model_id: str | None) -> bool:
    """把 Electron 设置里选中的模型设为当前模型。正在下载/加载时不切换，返回是否已是请求的模型。"""
    model_id = normalize_asr_model_id(requested_model_id)
    if not model_id or model_id == get_active_asr_model_id():
        return True
    if is_voice_model_task_running(app) or is_model_download_running(app, model_id):
        return False
    set_active_asr_model_id(model_id)
    unload_asr_model()
    set_voice_service_state(app, "idle", MODEL_MISSING_DETAIL)
    return True


async def download_model_only(app: FastAPI, model_id: str, download_model) -> None:
    states = get_model_download_states(app)
    label = get_model_label(model_id)
    started_at = time.time()
    states[model_id] = {"status": "downloading", "detail": f"正在下载 {label} 模型", "started_at": started_at}

    def on_progress(progress: dict) -> None:
        states[model_id] = {**states.get(model_id, {}), **normalize_download_progress(progress)}

    try:
        await asyncio.to_thread(download_model, model_id, on_progress)
        states[model_id] = {"status": "done", "detail": f"{label} 已下载"}
    except Exception as error:
        states[model_id] = {"status": "failed", "detail": f"{label} 下载失败: {error}"}


def start_model_download_task(app: FastAPI, model_id: str, download_model) -> None:
    if is_model_cached(model_id) or is_model_download_running(app, model_id):
        return
    if model_id == get_active_asr_model_id() and is_voice_model_task_running(app):
        return
    tasks = getattr(app.state, "model_download_tasks", None)
    if not isinstance(tasks, dict):
        tasks = {}
        app.state.model_download_tasks = tasks
    tasks[model_id] = asyncio.create_task(download_model_only(app, model_id, download_model))


def read_bool(value, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in {"0", "false", "no", "off"}:
        return False
    if isinstance(value, str) and value.strip().lower() in {"1", "true", "yes", "on"}:
        return True
    return default


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

            # 客户端正常断开时 receive() 会给出 disconnect 消息；必须在这里结束循环，
            # 否则下一轮 receive() 会抛 RuntimeError，每次断开都在日志里留一长串 traceback。
            if message["type"] == "websocket.disconnect":
                break

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
    download_model=download_asr_model,
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
            download_tasks = getattr(app.state, "model_download_tasks", None)
            for task in (download_tasks or {}).values():
                task.cancel()

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
        apply_requested_model_id(app, request.query_params.get("model_id"))
        return get_voice_model_status(app)

    @app.post("/model/download")
    async def model_download(request: Request):
        payload = await read_model_request_payload(request)
        cache_dir = payload.get("cache_dir")
        apply_model_cache_dir(cache_dir.strip() if isinstance(cache_dir, str) else "")
        requested_model_id = normalize_asr_model_id(payload.get("model_id"))
        # load=false：只下载该模型不切换（初始化页的“下载”“全部下载”）；默认下载后加载为当前模型。
        if requested_model_id and not read_bool(payload.get("load"), True):
            start_model_download_task(app, requested_model_id, download_model)
            return get_voice_model_status(app)
        if apply_requested_model_id(app, requested_model_id):
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

    reload_enabled = should_enable_reload()
    uvicorn.run(
        "main:app" if reload_enabled else app,
        host=get_server_host(),
        port=get_server_port(),
        reload=reload_enabled,
    )
