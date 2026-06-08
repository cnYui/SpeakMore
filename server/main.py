"""Typeless 本地后端服务 - 复现 /ai/voice_flow 和 WebSocket 接口"""

import asyncio
import inspect
import json
import os
import re
import tempfile
import time
import unicodedata
import uuid
from contextlib import asynccontextmanager, suppress
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from asr import (
    DOWNLOAD_SOURCE,
    MeetingRealtimePipeline,
    create_streaming_asr_session,
    get_asr_runtime_device_status,
    join_asr_text,
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
from local_translation_model import (
    SELF_TEST_FAILED_DETAIL_CODE,
    build_translation_model_download_failure_detail,
    configure_translation_model_cache_dir,
    download_translation_model,
    get_translation_model_cache_root,
    get_translation_model_status,
    is_translation_model_ready,
    load_translation_model,
    translate_with_local_model,
    unload_translation_model,
)
from refiner import (
    detect_meeting_note_scenarios,
    format_target_language_for_prompt,
    refine_text,
    reload_refiner_runtime_config,
    resolve_translation_target_language_id,
)
from runtime_config import (
    get_cors_allowed_origins,
    get_server_host,
    get_server_port,
    load_server_env,
)

load_server_env()

MAX_UPLOAD_AUDIO_BYTES = 1024 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024
SUPPORTED_UPLOAD_AUDIO_SUFFIXES = {
    ".m4a",
    ".mp3",
    ".mp4",
    ".wav",
    ".ogg",
    ".flac",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".opus",
}

MODEL_MISSING_DETAIL = "还没有下载语音模型，请先下载模型。"
MODEL_CACHED_IDLE_DETAIL = "语音模型已下载，尚未加载，请加载模型后使用。"


def should_enable_reload() -> bool:
    return os.getenv("UVICORN_RELOAD", "").strip().lower() in {"1", "true", "yes", "on"}


def detect_uploaded_audio_suffix(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if not suffix:
        return ".wav"
    if suffix in SUPPORTED_UPLOAD_AUDIO_SUFFIXES:
        return suffix
    return ""


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


async def save_upload_to_temp_file(audio_file: UploadFile, suffix: str) -> str:
    if not suffix:
        raise HTTPException(status_code=415, detail="Unsupported media file format")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp_path = tmp.name
    total_bytes = 0

    try:
        while True:
            chunk = await audio_file.read(UPLOAD_CHUNK_BYTES)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="Uploaded media file exceeds 1 GB")
            tmp.write(chunk)
        return tmp_path
    except Exception:
        tmp.close()
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
    finally:
        tmp.close()


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


def merge_ws_end_audio_parameters(current_parameters: dict, payload: dict) -> dict:
    next_parameters = normalize_ws_object(payload.get("parameters", {}))
    if not next_parameters:
        return current_parameters
    return {**current_parameters, **next_parameters}


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


def apply_translation_model_cache_dir(cache_dir: str | None) -> str:
    return str(configure_translation_model_cache_dir(cache_dir))


async def read_model_cache_dir_from_request(request: Request) -> str:
    try:
        payload = await request.json()
    except Exception:
        return ""
    if not isinstance(payload, dict):
        return ""
    value = payload.get("cache_dir")
    return value.strip() if isinstance(value, str) else ""


async def read_translation_model_cache_dir_from_request(request: Request) -> str:
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
        "model_id": SENSEVOICE_SMALL_MODEL_ID,
        "repo_id": SENSEVOICE_SMALL_REPO_ID,
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

    current = {
        **current,
        **get_asr_runtime_device_status(),
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


def is_translation_model_task_running(app: FastAPI) -> bool:
    task = getattr(app.state, "translation_model_task", None)
    return bool(task and not task.done())


def should_auto_preload_translation_model() -> bool:
    value = os.getenv("SPEAKMORE_AUTO_PRELOAD_TRANSLATION_MODEL", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def can_auto_preload_translation_model() -> bool:
    if is_translation_model_ready():
        return False
    status = get_translation_model_status()
    return bool(status.get("cached") and status.get("runtime_available"))


async def run_translation_model_download_task(app: FastAPI) -> None:
    set_translation_model_task_state("downloading", "Downloading local Hy-MT2 translation model", time.time())
    try:
        await asyncio.to_thread(download_translation_model, update_translation_model_task_progress)
        if can_auto_preload_translation_model():
            await run_translation_model_load_task(app)
        else:
            set_translation_model_task_state("idle", "Local translation model downloaded")
    except Exception as error:
        set_translation_model_task_state("failed", build_translation_model_download_failure_detail(error))


async def run_translation_model_load_task(app: FastAPI) -> None:
    del app
    set_translation_model_task_state("loading", "Loading local translation model", time.time())
    try:
        await asyncio.to_thread(load_translation_model)
    except Exception as error:
        if SELF_TEST_FAILED_DETAIL_CODE in str(error):
            set_translation_model_task_state("failed_self_test", str(error))
            return
        set_translation_model_task_state("failed", str(error))


def set_translation_model_task_state(status: str, detail: str = "", started_at: float | None = None) -> None:
    from local_translation_model import set_translation_model_state

    set_translation_model_state(status, detail, started_at)


def update_translation_model_task_progress(progress: dict) -> None:
    from local_translation_model import update_translation_model_progress

    update_translation_model_progress(progress)


def start_translation_model_download_task(app: FastAPI) -> None:
    if is_translation_model_task_running(app):
        return
    app.state.translation_model_task = asyncio.create_task(run_translation_model_download_task(app))


def start_translation_model_load_task(app: FastAPI) -> None:
    if is_translation_model_ready() or is_translation_model_task_running(app):
        return
    app.state.translation_model_task = asyncio.create_task(run_translation_model_load_task(app))


def start_translation_model_auto_preload_task(app: FastAPI) -> None:
    if not should_auto_preload_translation_model():
        return
    if not can_auto_preload_translation_model():
        return
    start_translation_model_load_task(app)


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

    set_voice_service_state(app, "loading", "正在准备 SenseVoiceSmall 模型", time.time())
    app.state.voice_preload_task = asyncio.create_task(
        preload_voice_service(app, preload_model, exit_scheduler, exit_on_failure=exit_on_failure),
    )


def create_flow_success_payload(refined_text: str, raw_text: str = "", extra_data: dict | None = None) -> dict:
    data = {
        "refine_text": refined_text,
        "delivery": "inline",
        "user_prompt": raw_text,
        "web_metadata": None,
        "external_action": None,
    }
    if isinstance(extra_data, dict):
        data.update(extra_data)
    return {
        "status": "OK",
        "data": data,
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


def create_meeting_notes_fallback_summary(raw_text: str, detail: str = "") -> str:
    if not str(raw_text or "").strip():
        return ""
    reason = "会议总结生成失败，可先查看逐字稿。"
    if detail:
        reason = f"{reason}\n\n失败原因：{detail}"
    return (
        "AI 智能总结\n\n"
        "当前无法生成完整会议纪要，但已保留原始逐字稿。\n\n"
        "可用内容\n"
        "- 请在“转录”中查看完整逐字稿。\n"
        "- 如果转录内容较少、主题过于碎片化或噪声较大，建议重新录制或导入更完整的会议音频。\n\n"
        f"{reason}"
    )


def get_meeting_translation_target(parameters: dict | None) -> str:
    if not isinstance(parameters, dict):
        return ""
    candidate = (
        parameters.get("meeting_translation_target_language")
        or parameters.get("target_language")
        or parameters.get("output_language")
        or ""
    )
    normalized = str(candidate or "").strip().lower()
    if normalized in ("", "off", "none", "null", "false", "关闭"):
        return ""
    return resolve_translation_target_language_id(candidate)


MEETING_REALTIME_TRANSLATION_MIN_CJK_CHARS = 10
MEETING_REALTIME_TRANSLATION_MIN_OTHER_CHARS = 22
MEETING_REALTIME_TRANSLATION_SHORT_CJK_CHARS = 5
MEETING_REALTIME_TRANSLATION_SHORT_OTHER_CHARS = 12
MEETING_REALTIME_TRANSLATION_IMMEDIATE_CJK_CHARS = 6
MEETING_REALTIME_TRANSLATION_IMMEDIATE_OTHER_CHARS = 16
MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS = 0.9
MEETING_REALTIME_TRANSLATION_SHORT_WAIT_SECONDS = 0.65
MEETING_REALTIME_TRANSLATION_MAX_CONCURRENCY = 2
MEETING_REALTIME_TRANSLATION_MAX_QUEUE = 6
MEETING_REALTIME_TRANSLATION_COMPLETE_CJK_CHARS = 6
MEETING_REALTIME_TRANSLATION_COMPLETE_OTHER_WORDS = 3
MEETING_REALTIME_TRANSLATION_FAST_CJK_CHARS = 14
MEETING_REALTIME_TRANSLATION_FAST_OTHER_WORDS = 8
MEETING_REALTIME_STABLE_COMMIT_OBSERVATIONS = 2
MEETING_REALTIME_STABLE_FAST_COMMIT_SECONDS = 0.05
MEETING_REALTIME_SENTENCE_GRACE_SECONDS = 0.34
MEETING_REALTIME_LOCAL_TRANSLATION_TIMEOUT_SECONDS = 2.2
MEETING_REALTIME_PREVIEW_TRANSLATION_TIMEOUT_SECONDS = 0.9
MEETING_REALTIME_PREVIEW_DEBOUNCE_SECONDS = 0.12
MEETING_REALTIME_PREVIEW_MIN_INTERVAL_SECONDS = 0.38
MEETING_REALTIME_TRANSLATION_ENDINGS = tuple(".!?\n\u3002\uff01\uff1f\u061f\u06d4\u0964")
MEETING_REALTIME_LEADING_SEPARATOR_RE = re.compile(r"^[\s,，、،。.!?！？\u061f\u06d4\u0964;；؛:：]+")
MEETING_REALTIME_CONNECTOR_PREFIX_RE = re.compile(
    r"^\s*(但|但是|然后|接下来|所以|另外|还有|同时|并且|以及|不过|其次|第二点|第三点|第四点|最后|再一个|还有一个|"
    r"そして|それで|でも|しかし|次に|また|그리고|하지만|그래서|다음|"
    r"then\b|and\b|but\b|so\b|also\b|next\b|second\b|third\b|finally\b|"
    r"y\b|pero\b|entonces\b|adem[aá]s\b|luego\b|tamb[ií]en\b|porque\b|"
    r"et\b|mais\b|donc\b|ensuite\b|aussi\b|parce\s+que\b|"
    r"und\b|aber\b|also\b|dann\b|au[ßs]erdem\b|weil\b|"
    r"e\b|ma\b|quindi\b|poi\b|anche\b|mas\b|ent[aã]o\b|tamb[eé]m\b|"
    r"и\b|но\b|поэтому\b|затем\b|также\b|"
    r"و|لكن|ثم|لذلك|אבל|ואז|וגם|"
    r"और|लेकिन|फिर|और\s+फिर|"
    r"และ|แต่|ดังนั้น|แล้ว|"
    r"v[aà]\b|nhưng\b|n[eê]n\b|ti[eế]p\s+theo\b|"
    r"dan\b|tapi\b|tetapi\b|lalu\b|kemudian\b|ve\b|ama\b|fakat\b|sonra\b)",
    re.IGNORECASE,
)
MEETING_REALTIME_UNFINISHED_SUFFIX_RE = re.compile(
    r"(然后|但是|因为|所以|接下来|另外|还有|以及|并且|如果|假如|关于|针对|先|再|要|需要|会|将|把|让|这个|那个|就是|"
    r"そして|でも|しかし|그리고|하지만|그래서|"
    r"the|and|but|because|so|if|to|of|for|with|from|"
    r"y|pero|porque|para|de|que|et|mais|parce que|und|aber|weil|"
    r"e|ma|perch[eé]|mas|porque|и|но|و|لكن|אבל|और|लेकिन|และ|แต่|dan|tapi|ve|ama)$",
    re.IGNORECASE,
)
MEETING_REALTIME_COMPLETE_SIGNAL_RE = re.compile(
    r"(开始|讨论|确认|决定|安排|需要|可以|完成|发送|更新|负责|处理|推进|预算|排期|会议|项目|客户|同意|认为|计划|待办|总结|明天|今天|接下来|什么|谁|哪里|哪|怎么|是否|吗|名字|时间|地点|start|discuss|confirm|decide|arrange|need|should|will|can|send|update|finish|plan|budget|schedule|meeting|project|client|what|who|where|when|how|whether)",
    re.IGNORECASE,
)
MEETING_REALTIME_FILLER_ONLY = {
    "\u55ef",
    "\u5443",
    "\u554a",
    "\u54e6",
    "\u989d",
    "\u5450",
    "um",
    "uh",
    "er",
    "ah",
    "oh",
    "hmm",
}


def is_meeting_realtime_emoji_char(char: str) -> bool:
    code = ord(char)
    if 0xFE00 <= code <= 0xFE0F:
        return True
    if 0x1F000 <= code <= 0x1FAFF:
        return True
    if 0x2600 <= code <= 0x27BF:
        return True
    if 0x2300 <= code <= 0x23FF:
        return True
    if 0x2B00 <= code <= 0x2BFF:
        return True
    return False


def count_cjk_chars(value: str) -> int:
    return sum(1 for char in value if "\u4e00" <= char <= "\u9fff")


def count_chars_in_ranges(value: str, ranges: tuple[tuple[int, int], ...]) -> int:
    total = 0
    for char in value:
        code = ord(char)
        if any(start <= code <= end for start, end in ranges):
            total += 1
    return total


MEETING_REALTIME_SCRIPT_RANGES = {
    "japanese": ((0x3040, 0x30FF),),
    "korean": ((0xAC00, 0xD7AF), (0x1100, 0x11FF), (0x3130, 0x318F)),
    "cjk": ((0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xF900, 0xFAFF)),
    "thai": ((0x0E00, 0x0E7F),),
    "lao": ((0x0E80, 0x0EFF),),
    "khmer": ((0x1780, 0x17FF),),
    "myanmar": ((0x1000, 0x109F),),
    "indic": (
        (0x0900, 0x097F),
        (0x0980, 0x09FF),
        (0x0A00, 0x0A7F),
        (0x0A80, 0x0AFF),
        (0x0B00, 0x0B7F),
        (0x0B80, 0x0BFF),
        (0x0C00, 0x0C7F),
        (0x0C80, 0x0CFF),
        (0x0D00, 0x0D7F),
    ),
    "arabic": ((0x0600, 0x06FF), (0x0750, 0x077F), (0x08A0, 0x08FF)),
    "hebrew": ((0x0590, 0x05FF),),
    "cyrillic": ((0x0400, 0x052F),),
    "greek": ((0x0370, 0x03FF),),
    "latin": ((0x0041, 0x005A), (0x0061, 0x007A), (0x00C0, 0x024F), (0x1E00, 0x1EFF)),
}
MEETING_REALTIME_COMPACT_SCRIPT_PROFILES = {"cjk", "japanese", "korean", "thai", "lao", "khmer", "myanmar"}
MEETING_REALTIME_WORD_SCRIPT_PROFILES = {"latin", "cyrillic", "greek", "arabic", "hebrew", "indic", "mixed", "unknown"}
MEETING_REALTIME_SCRIPT_THRESHOLDS = {
    "cjk": {"short": 5, "immediate": 9, "pause": 11, "fast": 18, "force": 4, "wait": 0.82},
    "japanese": {"short": 6, "immediate": 10, "pause": 12, "fast": 18, "force": 5, "wait": 0.86},
    "korean": {"short": 5, "immediate": 9, "pause": 11, "fast": 17, "force": 4, "wait": 0.86},
    "thai": {"short": 8, "immediate": 14, "pause": 18, "fast": 26, "force": 7, "wait": 1.0},
    "lao": {"short": 8, "immediate": 14, "pause": 18, "fast": 26, "force": 7, "wait": 1.0},
    "khmer": {"short": 8, "immediate": 14, "pause": 18, "fast": 26, "force": 7, "wait": 1.0},
    "myanmar": {"short": 8, "immediate": 14, "pause": 18, "fast": 26, "force": 7, "wait": 1.0},
    "latin": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.95},
    "cyrillic": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.95},
    "greek": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.95},
    "arabic": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.98},
    "hebrew": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.98},
    "indic": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 1.0},
    "mixed": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.95},
    "unknown": {"short": 3, "immediate": 5, "pause": 6, "fast": 10, "force": 2, "wait": 0.95},
}


def detect_meeting_realtime_source_profile(value: str) -> str:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return "unknown"
    counts = {
        name: count_chars_in_ranges(text, ranges)
        for name, ranges in MEETING_REALTIME_SCRIPT_RANGES.items()
    }
    if counts["japanese"] > 0:
        return "japanese"
    if counts["korean"] > 0:
        return "korean"
    if counts["cjk"] > 0:
        return "cjk"
    compact_profile = max(("thai", "lao", "khmer", "myanmar"), key=lambda name: counts[name])
    if counts[compact_profile] > 0:
        return compact_profile
    word_profile = max(("latin", "cyrillic", "greek", "arabic", "hebrew", "indic"), key=lambda name: counts[name])
    if counts[word_profile] > 0:
        non_zero = sum(1 for name in ("latin", "cyrillic", "greek", "arabic", "hebrew", "indic") if counts[name] > 0)
        return "mixed" if non_zero > 1 and counts[word_profile] < sum(counts.values()) * 0.7 else word_profile
    return "unknown"


def get_meeting_realtime_words(value: str) -> list[str]:
    text = normalize_meeting_realtime_source(value)
    return re.findall(r"[^\W_]+(?:['’.-][^\W_]+)*", text, flags=re.UNICODE)


def count_meeting_realtime_significant_chars(value: str) -> int:
    text = normalize_meeting_realtime_source(value)
    return sum(1 for char in text if char.isalnum())


def get_meeting_realtime_commit_metrics(value: str) -> dict[str, int | str | bool]:
    profile = detect_meeting_realtime_source_profile(value)
    compact = profile in MEETING_REALTIME_COMPACT_SCRIPT_PROFILES
    words = get_meeting_realtime_words(value)
    return {
        "profile": profile,
        "compact": compact,
        "units": count_meeting_realtime_significant_chars(value) if compact else len(words),
        "words": len(words),
        "compare_length": len(normalize_meeting_realtime_compare(value)),
        "cjk_count": count_cjk_chars(value),
    }


def get_meeting_realtime_thresholds(value: str) -> dict[str, float]:
    profile = str(get_meeting_realtime_commit_metrics(value)["profile"])
    return MEETING_REALTIME_SCRIPT_THRESHOLDS.get(profile, MEETING_REALTIME_SCRIPT_THRESHOLDS["unknown"])


def normalize_meeting_realtime_source(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    chars = []
    for char in text:
        category = unicodedata.category(char)
        if category in {"Cc", "Cf", "Cs"}:
            continue
        if category == "So" or is_meeting_realtime_emoji_char(char):
            continue
        chars.append(char)
    text = "".join(chars)
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    text = re.sub(r"([.!?\u3002\uff01\uff1f\u061f\u06d4\u0964,，、،]){2,}", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([.!?\u3002\uff01\uff1f\u061f\u06d4\u0964,，、،;；؛:：])", r"\1", text)
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    return text


def normalize_meeting_realtime_compare(value: str) -> str:
    text = normalize_meeting_realtime_source(value).lower()
    return "".join(char for char in text if char.isalnum())


def meeting_realtime_similarity(left: str, right: str) -> float:
    left_key = normalize_meeting_realtime_compare(left)
    right_key = normalize_meeting_realtime_compare(right)
    if not left_key or not right_key:
        return 0.0
    if left_key == right_key:
        return 1.0
    return SequenceMatcher(None, left_key, right_key).ratio()


def build_meeting_realtime_compare_map(value: str) -> tuple[str, list[int]]:
    compare_chars = []
    positions = []
    for index, char in enumerate(normalize_meeting_realtime_source(value).lower()):
        if char.isalnum():
            compare_chars.append(char)
            positions.append(index)
    return "".join(compare_chars), positions


def strip_meeting_realtime_leading_separators(value: str) -> str:
    return MEETING_REALTIME_LEADING_SEPARATOR_RE.sub("", value or "").strip()


def split_meeting_realtime_sentences(value: str) -> tuple[list[str], str]:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return [], ""

    completed: list[str] = []
    start = 0
    for index, char in enumerate(text):
        if char not in MEETING_REALTIME_TRANSLATION_ENDINGS:
            continue
        sentence = strip_meeting_realtime_leading_separators(text[start : index + 1])
        if sentence:
            completed.append(sentence)
        start = index + 1

    tail = strip_meeting_realtime_leading_separators(text[start:])
    return completed, tail


def starts_with_meeting_realtime_connector(value: str) -> bool:
    return bool(MEETING_REALTIME_CONNECTOR_PREFIX_RE.match(normalize_meeting_realtime_source(value)))


def ends_with_meeting_realtime_unfinished_suffix(value: str) -> bool:
    return bool(MEETING_REALTIME_UNFINISHED_SUFFIX_RE.search(normalize_meeting_realtime_source(value)))


def join_meeting_realtime_parts(parts: list[str]) -> str:
    text = ""
    for part in parts:
        normalized_part = normalize_meeting_realtime_source(part)
        if not normalized_part:
            continue
        text = join_asr_text(text, normalized_part)
    return normalize_meeting_realtime_source(text)


def get_meeting_realtime_lengths(value: str) -> tuple[int, int]:
    text = normalize_meeting_realtime_source(value)
    return count_cjk_chars(text), len(normalize_meeting_realtime_compare(text))


def is_tiny_meeting_realtime_fragment(value: str) -> bool:
    metrics = get_meeting_realtime_commit_metrics(value)
    if bool(metrics["compact"]):
        return int(metrics["units"]) <= 1
    return int(metrics["units"]) <= 1 and int(metrics["compare_length"]) <= 3


def is_natural_meeting_realtime_sentence(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    if not text or not has_meeting_realtime_sentence_ending(text):
        return False
    if is_tiny_meeting_realtime_fragment(text):
        return False
    metrics = get_meeting_realtime_commit_metrics(text)
    thresholds = get_meeting_realtime_thresholds(text)
    return int(metrics["units"]) >= int(thresholds["immediate"]) or int(metrics["compare_length"]) >= 18


def is_likely_complete_meeting_realtime_clause(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    if not text or has_meeting_realtime_sentence_ending(text):
        return False
    if starts_with_meeting_realtime_connector(text) or ends_with_meeting_realtime_unfinished_suffix(text):
        return False
    metrics = get_meeting_realtime_commit_metrics(text)
    thresholds = get_meeting_realtime_thresholds(text)
    if bool(MEETING_REALTIME_COMPLETE_SIGNAL_RE.search(text)):
        return int(metrics["units"]) >= max(3, int(thresholds["short"]))
    return int(metrics["units"]) >= int(thresholds["pause"]) and int(metrics["compare_length"]) >= 18


def has_meeting_realtime_pause_commit_length(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return False
    if is_tiny_meeting_realtime_fragment(text):
        return False
    if ends_with_meeting_realtime_unfinished_suffix(text):
        return False
    metrics = get_meeting_realtime_commit_metrics(text)
    thresholds = get_meeting_realtime_thresholds(text)
    if has_meeting_realtime_sentence_ending(text):
        return int(metrics["units"]) >= int(thresholds["short"]) or int(metrics["compare_length"]) >= 12
    if is_likely_complete_meeting_realtime_clause(text):
        return True
    return int(metrics["units"]) >= int(thresholds["pause"]) and int(metrics["compare_length"]) >= 18


def is_force_committable_meeting_realtime_tail(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return False
    if is_tiny_meeting_realtime_fragment(text) or is_meaningless_meeting_realtime_segment(text):
        return False
    if ends_with_meeting_realtime_unfinished_suffix(text):
        return False
    if has_meeting_realtime_pause_commit_length(text):
        return True
    metrics = get_meeting_realtime_commit_metrics(text)
    thresholds = get_meeting_realtime_thresholds(text)
    if has_meeting_realtime_sentence_ending(text):
        return int(metrics["units"]) >= max(1, int(thresholds["force"])) or int(metrics["compare_length"]) >= 4
    if bool(metrics["compact"]):
        return int(metrics["units"]) >= int(thresholds["force"])
    return int(metrics["units"]) >= int(thresholds["force"]) and int(metrics["compare_length"]) >= 8


def get_meeting_realtime_pause_wait_seconds(value: str) -> float:
    text = normalize_meeting_realtime_source(value)
    if not has_meeting_realtime_pause_commit_length(text):
        return 0.0
    metrics = get_meeting_realtime_commit_metrics(text)
    thresholds = get_meeting_realtime_thresholds(text)
    if has_meeting_realtime_sentence_ending(text):
        return MEETING_REALTIME_SENTENCE_GRACE_SECONDS
    if int(metrics["units"]) >= int(thresholds["fast"]):
        return 0.55
    if is_likely_complete_meeting_realtime_clause(text):
        return 0.72
    return float(thresholds["wait"])


def find_meeting_realtime_boundary_after_committed(text: str, committed_compare_key: str) -> int | None:
    committed_key = str(committed_compare_key or "")
    if not committed_key:
        return 0

    compare_text, positions = build_meeting_realtime_compare_map(text)
    if not compare_text or not positions:
        return None

    if compare_text.startswith(committed_key):
        compare_boundary = len(committed_key)
    else:
        matcher = SequenceMatcher(None, committed_key, compare_text)
        matching_blocks = [block for block in matcher.get_matching_blocks() if block.size]
        matched_count = sum(block.size for block in matching_blocks)
        required_count = min(len(committed_key), max(3, int(len(committed_key) * 0.6)))
        first_block_start = matching_blocks[0].b if matching_blocks else len(compare_text)
        if matched_count < required_count or first_block_start > max(2, len(compare_text) // 4):
            return None
        compare_boundary = max(block.b + block.size for block in matching_blocks)

    if compare_boundary <= 0:
        return 0
    if compare_boundary > len(positions):
        return len(text)
    return min(len(text), positions[compare_boundary - 1] + 1)


def normalize_meeting_realtime_translation_output(value: str) -> str:
    return normalize_meeting_realtime_source(value)


def normalize_meeting_transcription_text(value: str, mode: str) -> str:
    if mode != "meeting_notes":
        return str(value or "").strip()
    return normalize_meeting_realtime_source(value)


MEETING_STRUCTURED_SCHEMA_VERSION = 1
MEETING_STRUCTURED_MAX_ITEMS = 12
MEETING_TRANSCRIPT_SEGMENT_TARGET_CHARS = 220
MEETING_TOPIC_SEGMENT_TARGET_CHARS = 700
MEETING_IMPORT_CHUNK_TRIGGER_CHARS = 9000
MEETING_IMPORT_CHUNK_TARGET_CHARS = 4200
MEETING_SIGNAL_ACTION_RE = re.compile(
    r"(待办|行动项|跟进|负责|负责人|处理|推进|完成|发送|更新|确认|不要忘|安排|落实|截止|deadline|action|todo|follow[- ]?up|owner|responsible|send|update|finish|confirm)",
    re.IGNORECASE,
)
MEETING_SIGNAL_DECISION_RE = re.compile(
    r"(决定|确认|同意|结论|定下来|拍板|通过|不通过|选择|采用|decision|decide|agreed|confirmed|conclusion|approved)",
    re.IGNORECASE,
)
MEETING_SIGNAL_SCHEDULE_RE = re.compile(
    r"(今天|明天|后天|下周|周一|周二|周三|周四|周五|上午|下午|晚上|\d{1,2}\s*点|日程|行程|会议|见面|拜访|安排|排期|deadline|schedule|tomorrow|today|next week|meeting)",
    re.IGNORECASE,
)
MEETING_SIGNAL_RISK_RE = re.compile(
    r"(风险|问题|阻塞|卡住|延期|依赖|缺少|担心|不确定|报错|失败|risk|issue|blocker|blocked|delay|dependency|concern|failed)",
    re.IGNORECASE,
)
MEETING_SIGNAL_QUESTION_RE = re.compile(
    r"(问题|疑问|待确认|是否|为什么|怎么|谁|哪里|什么时候|能不能|可不可以|\?|？|question|open question|whether|why|how|who|where|when)",
    re.IGNORECASE,
)
MEETING_SIGNAL_FOLLOW_UP_RE = re.compile(
    r"(后续|下一步|接下来|跟进|同步|复盘|回访|再确认|再沟通|follow[- ]?up|next step|sync|review|check back)",
    re.IGNORECASE,
)


def get_meeting_text_weight(value: str) -> int:
    text = normalize_meeting_realtime_source(value)
    return count_cjk_chars(text) + len(re.findall(r"[A-Za-z0-9']+", text))


def get_meeting_content_level(value: str) -> str:
    weight = get_meeting_text_weight(value)
    if weight < 20:
        return "limited"
    if weight < 120:
        return "short"
    if weight < 700:
        return "medium"
    return "long"


def split_meeting_text_units(value: str) -> list[str]:
    text = normalize_meeting_realtime_source(value)
    if not text:
        return []

    units: list[str] = []
    current: list[str] = []
    for char in text:
        current.append(char)
        if char in MEETING_REALTIME_TRANSLATION_ENDINGS or char in "；;":
            sentence = normalize_meeting_realtime_source("".join(current))
            if sentence:
                units.append(sentence)
            current = []
    tail = normalize_meeting_realtime_source("".join(current))
    if tail:
        units.append(tail)

    normalized_units: list[str] = []
    for unit in units:
        if len(unit) <= MEETING_TRANSCRIPT_SEGMENT_TARGET_CHARS * 2:
            normalized_units.append(unit)
            continue
        for start in range(0, len(unit), MEETING_TRANSCRIPT_SEGMENT_TARGET_CHARS):
            part = normalize_meeting_realtime_source(unit[start : start + MEETING_TRANSCRIPT_SEGMENT_TARGET_CHARS])
            if part:
                normalized_units.append(part)
    return normalized_units


def group_meeting_text_segments(units: list[str], target_chars: int) -> list[str]:
    segments: list[str] = []
    current: list[str] = []
    current_length = 0
    for unit in units:
        unit_length = len(unit)
        if current and current_length + unit_length > target_chars:
            segment = normalize_meeting_realtime_source(" ".join(current))
            if segment:
                segments.append(segment)
            current = []
            current_length = 0
        current.append(unit)
        current_length += unit_length

    if current:
        segment = normalize_meeting_realtime_source(" ".join(current))
        if segment:
            segments.append(segment)
    return segments


def build_meeting_transcript_segments(raw_text: str) -> list[dict]:
    segments = split_meeting_text_units(raw_text)
    return [
        {
            "index": index + 1,
            "text": text,
            "contentLevel": get_meeting_content_level(text),
        }
        for index, text in enumerate(segments)
    ]


def build_meeting_topic_segments(raw_text: str) -> list[dict]:
    units = split_meeting_text_units(raw_text)
    topic_texts = group_meeting_text_segments(units, MEETING_TOPIC_SEGMENT_TARGET_CHARS)
    topics = []
    for index, text in enumerate(topic_texts):
        title = text[:36].strip()
        if len(text) > 36:
            title = f"{title}..."
        topics.append({
            "id": f"topic-{index + 1}",
            "title": title or f"Topic {index + 1}",
            "summary": text,
            "segmentIndexes": [index + 1],
        })
    return topics


def normalize_meeting_item_compare(value: str) -> str:
    return re.sub(r"\W+", "", normalize_meeting_realtime_source(value).lower(), flags=re.UNICODE)


def extract_meeting_signal_items(units: list[str], pattern: re.Pattern, source: str) -> list[dict]:
    items: list[dict] = []
    seen: set[str] = set()
    for unit in units:
        text = normalize_meeting_realtime_source(unit)
        if not text or not pattern.search(text):
            continue
        key = normalize_meeting_item_compare(text)
        if not key or key in seen:
            continue
        seen.add(key)
        items.append({
            "id": f"{source}-{len(items) + 1}",
            "text": text,
            "source": source,
        })
        if len(items) >= MEETING_STRUCTURED_MAX_ITEMS:
            break
    return items


def infer_meeting_structured_source(parameters: dict | None, context: dict | None) -> str:
    values = []
    if isinstance(parameters, dict):
        values.extend([
            parameters.get("import_source"),
            parameters.get("meeting_module"),
            parameters.get("meeting_capture_profile"),
        ])
    if isinstance(context, dict):
        values.extend([
            context.get("import_source"),
            context.get("meeting_module"),
            context.get("meeting_capture_profile"),
        ])
    joined = " ".join(str(value or "") for value in values).lower()
    if "import" in joined or "imported_media" in joined:
        return "import"
    if "meeting" in joined or "new_note" in joined or "live_translation" in joined:
        return "recording"
    return "unknown"


def build_meeting_structured_result(
    raw_text: str,
    summary: str = "",
    parameters: dict | None = None,
    context: dict | None = None,
    partial_success: bool = False,
    summary_error: str = "",
) -> dict:
    transcript = normalize_meeting_transcription_text(raw_text, "meeting_notes")
    summary_text = str(summary or "").strip()
    transcript_units = split_meeting_text_units(transcript)
    summary_units = [
        normalize_meeting_realtime_source(line)
        for line in str(summary_text or "").splitlines()
        if normalize_meeting_realtime_source(line)
    ]
    extraction_units = [*summary_units, *transcript_units]
    scenarios = detect_meeting_note_scenarios(transcript) or ["general_meeting_or_voice_note"]
    return {
        "version": MEETING_STRUCTURED_SCHEMA_VERSION,
        "scenario": scenarios[0],
        "scenarios": scenarios,
        "contentLevel": get_meeting_content_level(transcript),
        "summary": summary_text,
        "topics": build_meeting_topic_segments(transcript),
        "decisions": extract_meeting_signal_items(extraction_units, MEETING_SIGNAL_DECISION_RE, "decision"),
        "actionItems": extract_meeting_signal_items(extraction_units, MEETING_SIGNAL_ACTION_RE, "action"),
        "scheduleItems": extract_meeting_signal_items(extraction_units, MEETING_SIGNAL_SCHEDULE_RE, "schedule"),
        "risks": extract_meeting_signal_items(extraction_units, MEETING_SIGNAL_RISK_RE, "risk"),
        "questions": extract_meeting_signal_items(extraction_units, MEETING_SIGNAL_QUESTION_RE, "question"),
        "followUps": extract_meeting_signal_items(extraction_units, MEETING_SIGNAL_FOLLOW_UP_RE, "follow_up"),
        "transcriptSegments": build_meeting_transcript_segments(transcript),
        "source": infer_meeting_structured_source(parameters, context),
        "partialSuccess": bool(partial_success),
        "summaryError": str(summary_error or ""),
    }


def should_chunk_meeting_import(raw_text: str, parameters: dict | None, context: dict | None) -> bool:
    normalized_text = normalize_meeting_transcription_text(raw_text, "meeting_notes")
    if len(normalized_text) < MEETING_IMPORT_CHUNK_TRIGGER_CHARS:
        return False

    import_markers = []
    if isinstance(parameters, dict):
        import_markers.extend([
            parameters.get("import_source"),
            parameters.get("import_processing_profile"),
            parameters.get("meeting_capture_profile"),
            parameters.get("meeting_module"),
        ])
    if isinstance(context, dict):
        import_markers.extend([
            context.get("import_source"),
            context.get("meeting_capture_profile"),
            context.get("meeting_module"),
        ])
    marker_text = " ".join(str(item or "") for item in import_markers).lower()
    return (
        "frontier_import" in marker_text
        or "meeting_media" in marker_text
        or "imported_media" in marker_text
        or "import_file" in marker_text
    )


def split_meeting_import_chunks(raw_text: str, target_chars: int = MEETING_IMPORT_CHUNK_TARGET_CHARS) -> list[str]:
    units = split_meeting_text_units(raw_text)
    chunks = group_meeting_text_segments(units, target_chars)
    if chunks:
        return chunks
    text = normalize_meeting_transcription_text(raw_text, "meeting_notes")
    return [text[index : index + target_chars] for index in range(0, len(text), target_chars) if text[index : index + target_chars]]


async def refine_meeting_notes_summary(
    raw_text: str,
    context: dict | None,
    parameters: dict | None,
) -> tuple[str, dict]:
    params = parameters if isinstance(parameters, dict) else {}
    if not should_chunk_meeting_import(raw_text, params, context):
        summary = await refine_text(raw_text=raw_text, mode="meeting_notes", context=context, parameters=params)
        return summary, {}

    chunks = split_meeting_import_chunks(raw_text)
    if len(chunks) <= 1:
        summary = await refine_text(raw_text=raw_text, mode="meeting_notes", context=context, parameters=params)
        return summary, {}

    chunk_summaries: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        chunk_parameters = {
            **params,
            "meeting_chunk_summary": True,
            "meeting_chunk_index": index,
            "meeting_chunk_count": len(chunks),
        }
        chunk_summary = await refine_text(
            raw_text=chunk,
            mode="meeting_notes",
            context=context,
            parameters=chunk_parameters,
        )
        if str(chunk_summary or "").strip():
            chunk_summaries.append(f"Chunk {index}:\n{chunk_summary}")

    merged_input = "\n\n".join(chunk_summaries).strip()
    if not merged_input:
        raise RuntimeError("meeting import chunk summaries are empty")

    merge_parameters = {
        **params,
        "meeting_chunk_merge": True,
        "meeting_chunk_count": len(chunks),
        "meeting_original_transcript_excerpt": normalize_meeting_transcription_text(raw_text, "meeting_notes")[:3000],
    }
    merge_context = {
        **(context if isinstance(context, dict) else {}),
        "chunked_import": True,
    }
    summary = await refine_text(
        raw_text=merged_input,
        mode="meeting_notes",
        context=merge_context,
        parameters=merge_parameters,
    )
    return summary, {
        "meeting_import_chunked": True,
        "meeting_import_chunk_count": len(chunks),
    }


def is_meaningless_meeting_realtime_segment(value: str) -> bool:
    text = normalize_meeting_realtime_source(value)
    compare = normalize_meeting_realtime_compare(text)
    if not compare:
        return True
    if compare in MEETING_REALTIME_FILLER_ONLY:
        return True
    if len(compare) <= 2 and all(char in MEETING_REALTIME_FILLER_ONLY for char in compare):
        return True
    return False


def is_meeting_realtime_revision(candidate: str, previous: str) -> bool:
    candidate_key = normalize_meeting_realtime_compare(candidate)
    previous_key = normalize_meeting_realtime_compare(previous)
    if not candidate_key or not previous_key:
        return False
    if candidate_key.startswith(previous_key) or previous_key.startswith(candidate_key):
        return True
    shorter = min(len(candidate_key), len(previous_key))
    if shorter <= 4:
        return meeting_realtime_similarity(candidate_key, previous_key) >= 0.78
    return meeting_realtime_similarity(candidate_key, previous_key) >= 0.86


def has_meeting_realtime_sentence_ending(value: str) -> bool:
    return normalize_meeting_realtime_source(value).endswith(MEETING_REALTIME_TRANSLATION_ENDINGS)


def should_flush_meeting_translation_segment(segment: str, last_flush_at: float, now_value: float) -> bool:
    text = str(segment or "").strip()
    if not text:
        return False
    if text.endswith(MEETING_REALTIME_TRANSLATION_ENDINGS):
        return True
    cjk_count = count_cjk_chars(text)
    if cjk_count >= MEETING_REALTIME_TRANSLATION_MIN_CJK_CHARS:
        return True
    if cjk_count == 0 and len(text) >= MEETING_REALTIME_TRANSLATION_MIN_OTHER_CHARS:
        return True
    return now_value - last_flush_at >= MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS


def get_realtime_translation_token_budget(value: str) -> int:
    text = normalize_meeting_realtime_source(value)
    cjk_count, compare_length = get_meeting_realtime_lengths(text)
    estimated_units = max(cjk_count, compare_length // 4)
    if estimated_units <= 12:
        return 96
    if estimated_units <= 28:
        return 144
    return 220


def get_translation_engine_preference(parameters: dict | None) -> str:
    if not isinstance(parameters, dict):
        return "auto"
    preference = str(parameters.get("translation_engine_preference") or "auto").strip().lower()
    return preference if preference in {"auto", "local", "llm"} else "auto"


def is_local_translation_model_enabled(parameters: dict | None) -> bool:
    if not isinstance(parameters, dict):
        return True
    return parameters.get("local_translation_model_enabled") is not False


async def translate_text_with_engine(
    raw_text: str,
    target_language: str,
    context: dict,
    parameters: dict,
    previous_sentences: list[str] | None = None,
    previous_context_pairs: list[dict] | None = None,
    realtime: bool = False,
) -> dict:
    target_language_id = resolve_translation_target_language_id(target_language) or str(target_language or "").strip()
    target_language_name = format_target_language_for_prompt(target_language_id)
    preference = get_translation_engine_preference(parameters)
    local_enabled = is_local_translation_model_enabled(parameters)
    local_status = get_translation_model_status()
    should_try_local = local_enabled and preference != "llm"
    started_at = time.monotonic()

    if should_try_local and local_status.get("ready"):
        try:
            local_previous_sentences = (previous_sentences or [])[-1:] if realtime else previous_sentences
            local_previous_context_pairs = (previous_context_pairs or [])[-1:] if realtime else previous_context_pairs
            translated = await translate_with_local_model(
                raw_text=raw_text,
                target_language_id=target_language_id,
                target_language_name=target_language_name,
                previous_sentences=local_previous_sentences,
                previous_context_pairs=local_previous_context_pairs,
                max_tokens=min(160, get_realtime_translation_token_budget(raw_text)) if realtime else 256,
                timeout_seconds=MEETING_REALTIME_LOCAL_TRANSLATION_TIMEOUT_SECONDS if realtime else 8.0,
            )
            if translated:
                return {
                    "text": normalize_meeting_realtime_translation_output(translated),
                    "translation_engine": "local_hy_mt",
                    "translation_latency_ms": int((time.monotonic() - started_at) * 1000),
                    "local_model_status": "ready",
                }
        except Exception as error:
            if preference == "local":
                raise
            local_status = {
                **local_status,
                "status": "failed",
                "detail": str(error),
            }
    elif preference == "local":
        raise RuntimeError(str(local_status.get("detail") or local_status.get("status") or "local translation model is not ready"))

    llm_parameters = {
        **parameters,
        "output_language": target_language_id,
    }
    if realtime:
        llm_parameters.update({
            "realtime_sentence_translation": True,
            "realtime_context_sentences": (previous_sentences or [])[-2:],
            "realtime_context_pairs": (previous_context_pairs or [])[-2:],
            "realtime_max_tokens": get_realtime_translation_token_budget(raw_text),
        })
    translated = await refine_text(
        raw_text=raw_text,
        mode="translation",
        context=context,
        parameters=llm_parameters,
    )
    return {
        "text": normalize_meeting_realtime_translation_output(translated),
        "translation_engine": "llm",
        "translation_latency_ms": int((time.monotonic() - started_at) * 1000),
        "local_model_status": str(local_status.get("status") or "missing"),
    }


async def translate_realtime_sentence(
    raw_text: str,
    target_language: str,
    context: dict,
    parameters: dict,
    previous_sentences: list[str],
    previous_context_pairs: list[dict] | None = None,
) -> dict:
    return await translate_text_with_engine(
        raw_text=raw_text,
        target_language=target_language,
        context=context,
        parameters=parameters,
        previous_sentences=previous_sentences,
        previous_context_pairs=previous_context_pairs if isinstance(previous_context_pairs, list) else [],
        realtime=True,
    )


async def translate_realtime_preview(
    raw_text: str,
    target_language: str,
    previous_sentences: list[str],
    previous_context_pairs: list[dict] | None = None,
) -> dict:
    target_language_id = resolve_translation_target_language_id(target_language) or str(target_language or "").strip()
    if not target_language_id:
        return {"text": "", "translation_engine": "local_hy_mt", "local_model_status": "target_missing"}
    local_status = get_translation_model_status()
    if not local_status.get("ready"):
        return {
            "text": "",
            "translation_engine": "local_hy_mt",
            "local_model_status": str(local_status.get("status") or "missing"),
        }
    started_at = time.monotonic()
    try:
        translated = await translate_with_local_model(
            raw_text=raw_text,
            target_language_id=target_language_id,
            target_language_name=format_target_language_for_prompt(target_language_id),
            previous_sentences=[],
            previous_context_pairs=[],
            max_tokens=min(48, get_realtime_translation_token_budget(raw_text)),
            timeout_seconds=MEETING_REALTIME_PREVIEW_TRANSLATION_TIMEOUT_SECONDS,
        )
    except Exception:
        return {
            "text": "",
            "translation_engine": "local_hy_mt",
            "local_model_status": str(local_status.get("status") or "failed"),
        }
    return {
        "text": normalize_meeting_realtime_translation_output(translated),
        "translation_engine": "local_hy_mt",
        "translation_latency_ms": int((time.monotonic() - started_at) * 1000),
        "local_model_status": "ready",
    }


class MeetingRealtimeTranslator:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.audio_id = ""
        self.mode = "transcript"
        self.context: dict = {}
        self.parameters: dict = {}
        self.committed_compare_key = ""
        self.committed_sentences: list[str] = []
        self.committed_sentence_keys: list[str] = []
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_observed_at = 0.0
        self.pending_tail_wait_seconds = 0.0
        self.pending_tail_stable_count = 0
        self.pending_sentence_index = 0
        self.pending_sentence_id = ""
        self.pending_source_fingerprint = ""
        self.next_sentence_index = 1
        self.translation_queue: list[dict] = []
        self.translation_cache: dict[tuple[str, str], str] = {}
        self.translated_context_pairs: list[dict] = []
        self.active_tasks: set[asyncio.Task] = set()
        self.preview_task: asyncio.Task | None = None
        self.preview_generation = 0
        self.last_preview_started_at = 0.0
        self.last_preview_compare_key = ""
        self.flush_timer_task: asyncio.Task | None = None
        self.closed = False

    def reset(self, audio_id: str, mode: str, context: dict, parameters: dict) -> None:
        self.cancel()
        self.audio_id = audio_id
        self.mode = mode
        self.context = context if isinstance(context, dict) else {}
        self.parameters = parameters if isinstance(parameters, dict) else {}
        self.committed_compare_key = ""
        self.committed_sentences = []
        self.committed_sentence_keys = []
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_observed_at = 0.0
        self.pending_tail_wait_seconds = 0.0
        self.pending_tail_stable_count = 0
        self.pending_sentence_index = 0
        self.pending_sentence_id = ""
        self.pending_source_fingerprint = ""
        self.next_sentence_index = 1
        self.translation_queue = []
        self.translation_cache = {}
        self.translated_context_pairs = []
        self.active_tasks = set()
        self.preview_task = None
        self.preview_generation = 0
        self.last_preview_started_at = 0.0
        self.last_preview_compare_key = ""
        self.flush_timer_task = None
        self.closed = False

    def update_config(self, mode: str, parameters: dict) -> None:
        self.mode = mode
        self.parameters = parameters if isinstance(parameters, dict) else {}
        if not get_meeting_translation_target(self.parameters):
            self._clear_pending_work(cancel_active=True)

    def cancel(self) -> None:
        self.closed = True
        self._clear_pending_work(cancel_active=True)

    def _clear_pending_work(self, cancel_active: bool) -> None:
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_wait_seconds = 0.0
        self.pending_tail_stable_count = 0
        self.translation_queue = []
        if cancel_active:
            for task in list(self.active_tasks):
                if not task.done():
                    task.cancel()
            self.active_tasks.clear()
            if self.preview_task and not self.preview_task.done():
                self.preview_task.cancel()
            self.preview_task = None
        if self.flush_timer_task and not self.flush_timer_task.done() and self.flush_timer_task is not asyncio.current_task():
            self.flush_timer_task.cancel()
        self.flush_timer_task = None

    async def drain(self, timeout_seconds: float = 1.5) -> None:
        if self.closed:
            return

        await self._commit_pending_tail(force=True)
        self._start_next_translations()

        deadline = time.monotonic() + timeout_seconds
        while self.translation_queue or any(not task.done() for task in self.active_tasks):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            active = [task for task in self.active_tasks if not task.done()]
            if not active:
                self._start_next_translations()
                active = [task for task in self.active_tasks if not task.done()]
            if not active:
                return
            with suppress(asyncio.TimeoutError, asyncio.CancelledError, Exception):
                await asyncio.wait_for(asyncio.gather(*(asyncio.shield(task) for task in active)), timeout=remaining)

    async def observe_transcription(
        self,
        text: str,
        chunk_index: int,
        stable: bool = False,
        segment_text: str = "",
    ) -> None:
        del chunk_index
        if self.closed or self.mode != "meeting_notes":
            return
        if not get_meeting_translation_target(self.parameters):
            return
        if not stable:
            await self._observe_partial_preview(text=text, segment_text=segment_text)
            return

        normalized_text = normalize_meeting_realtime_source(text)
        normalized_segment = normalize_meeting_realtime_source(segment_text)
        if not normalized_text and not normalized_segment:
            return

        using_stable_segment = bool(stable and normalized_segment)
        if using_stable_segment:
            suffix = normalized_segment
        else:
            if not normalized_text or is_meaningless_meeting_realtime_segment(normalized_text):
                return
            suffix = self._extract_uncommitted_suffix(normalized_text)
        if not suffix:
            return
        if is_meaningless_meeting_realtime_segment(suffix):
            return

        if self.pending_tail_text:
            pending_tail = self.pending_tail_text
            pending_key = normalize_meeting_realtime_compare(pending_tail)
            suffix_key = normalize_meeting_realtime_compare(suffix)
            if (
                not using_stable_segment
                and pending_key
                and suffix_key.startswith(pending_key)
                and suffix_key != pending_key
                and has_meeting_realtime_pause_commit_length(pending_tail)
            ):
                boundary = find_meeting_realtime_boundary_after_committed(suffix, pending_key)
                await self._commit_pending_tail(force=False)
                suffix = normalize_meeting_realtime_source(strip_meeting_realtime_leading_separators(suffix[boundary or 0 :]))
                if not suffix:
                    return
            merged_tail = self._merge_pending_tail(pending_tail, suffix) if self.pending_tail_text else ""
            if merged_tail:
                self._clear_pending_tail_only(clear_identity=False)
                suffix = merged_tail
            elif self.pending_tail_text:
                await self._commit_pending_tail(force=False)

        completed_sentences, tail = split_meeting_realtime_sentences(suffix)
        buffered_parts: list[str] = []
        completed_groups: list[str] = []
        for index, sentence in enumerate(completed_sentences):
            buffered_parts.append(sentence)
            next_sentence = completed_sentences[index + 1] if index + 1 < len(completed_sentences) else tail
            if starts_with_meeting_realtime_connector(next_sentence):
                continue
            candidate = join_meeting_realtime_parts(buffered_parts)
            if is_natural_meeting_realtime_sentence(candidate):
                completed_groups.append(candidate)
                buffered_parts = []

        pending_tail = join_meeting_realtime_parts([*buffered_parts, tail])
        if pending_tail:
            for candidate in completed_groups:
                await self._commit_sentence(candidate)
        elif completed_groups:
            for candidate in completed_groups[:-1]:
                await self._commit_sentence(candidate)
            pending_tail = completed_groups[-1]
        self._set_pending_tail(pending_tail, allow_timer=stable)
        await asyncio.sleep(0)

    def _extract_uncommitted_suffix(self, normalized_text: str) -> str:
        if not self.committed_compare_key:
            return normalized_text

        boundary = find_meeting_realtime_boundary_after_committed(normalized_text, self.committed_compare_key)
        if boundary is None:
            if self._is_already_committed(normalized_text):
                return ""
            return normalized_text

        suffix = strip_meeting_realtime_leading_separators(normalized_text[boundary:])
        return normalize_meeting_realtime_source(suffix)

    def _is_already_committed(self, candidate: str) -> bool:
        candidate_key = normalize_meeting_realtime_compare(candidate)
        if not candidate_key:
            return True
        for committed_key in self.committed_sentence_keys[-12:]:
            if candidate_key == committed_key:
                return True
            if len(candidate_key) <= len(committed_key) and (
                committed_key.startswith(candidate_key)
                or SequenceMatcher(None, candidate_key, committed_key).ratio() >= 0.88
            ):
                return True
        return False

    def _trim_committed_prefix_from_sentence(self, sentence: str) -> str:
        if not self.committed_compare_key:
            return sentence
        boundary = find_meeting_realtime_boundary_after_committed(sentence, self.committed_compare_key)
        if boundary is None or boundary <= 0:
            return sentence
        return normalize_meeting_realtime_source(strip_meeting_realtime_leading_separators(sentence[boundary:]))

    async def _observe_partial_preview(self, text: str, segment_text: str = "") -> None:
        target_language = get_meeting_translation_target(self.parameters)
        if not target_language:
            return
        normalized_segment = normalize_meeting_realtime_source(segment_text)
        normalized_text = normalize_meeting_realtime_source(text)
        candidate = normalized_segment or self._extract_uncommitted_suffix(normalized_text)
        candidate = normalize_meeting_realtime_source(candidate)
        if not candidate or is_meaningless_meeting_realtime_segment(candidate) or self._is_already_committed(candidate):
            return
        if self.pending_tail_text:
            merged = self._merge_pending_tail(self.pending_tail_text, candidate)
            candidate = merged or candidate
        self._set_pending_tail(candidate, allow_timer=False)
        if not self.pending_tail_text:
            return
        sentence_index, sentence_id, source_fingerprint = self._ensure_pending_sentence_identity()
        await self._notify_pending_sentence(
            self.pending_tail_text,
            sentence_index,
            target_language,
            sentence_id,
            source_fingerprint,
            committed=False,
            provisional=True,
        )
        self._schedule_preview_translation(
            segment=self.pending_tail_text,
            target_language=target_language,
            sentence_index=sentence_index,
            sentence_id=sentence_id,
            source_fingerprint=source_fingerprint,
        )

    def _clear_pending_tail_only(self, clear_identity: bool = True) -> None:
        self.pending_tail_text = ""
        self.pending_tail_compare_key = ""
        self.pending_tail_wait_seconds = 0.0
        self.pending_tail_stable_count = 0
        if clear_identity:
            self.pending_sentence_index = 0
            self.pending_sentence_id = ""
            self.pending_source_fingerprint = ""
            self.preview_generation += 1
            if self.preview_task and not self.preview_task.done() and self.preview_task is not asyncio.current_task():
                self.preview_task.cancel()
            self.preview_task = None
        self._cancel_flush_timer()

    def _merge_pending_tail(self, pending_tail: str, next_suffix: str) -> str:
        pending = normalize_meeting_realtime_source(pending_tail)
        suffix = normalize_meeting_realtime_source(next_suffix)
        if not pending or not suffix:
            return ""
        pending_key = normalize_meeting_realtime_compare(pending)
        suffix_key = normalize_meeting_realtime_compare(suffix)
        if not pending_key or not suffix_key:
            return ""
        if pending_key == suffix_key:
            return pending if len(pending) >= len(suffix) else suffix
        if suffix_key.startswith(pending_key):
            return suffix
        if pending_key.startswith(suffix_key):
            return pending
        if starts_with_meeting_realtime_connector(suffix) or ends_with_meeting_realtime_unfinished_suffix(pending):
            return join_meeting_realtime_parts([pending, suffix])
        if not has_meeting_realtime_pause_commit_length(pending):
            return join_meeting_realtime_parts([pending, suffix])
        if meeting_realtime_similarity(pending, suffix) >= 0.9:
            return pending if len(pending_key) >= len(suffix_key) else suffix
        return ""

    def _set_pending_tail(self, tail: str, allow_timer: bool = True) -> None:
        normalized_tail = normalize_meeting_realtime_source(tail)
        if not normalized_tail or is_meaningless_meeting_realtime_segment(normalized_tail):
            self._clear_pending_tail_only()
            return

        normalized_tail = self._trim_committed_prefix_from_sentence(normalized_tail)
        tail_key = normalize_meeting_realtime_compare(normalized_tail)
        if not tail_key or self._is_already_committed(normalized_tail):
            self._clear_pending_tail_only()
            return

        if tail_key == self.pending_tail_compare_key:
            self.pending_tail_stable_count += 1
            if (
                allow_timer
                and
                self.pending_tail_stable_count >= MEETING_REALTIME_STABLE_COMMIT_OBSERVATIONS
                and self.pending_tail_wait_seconds > 0
                and is_likely_complete_meeting_realtime_clause(normalized_tail)
            ):
                self._cancel_flush_timer()
                self.flush_timer_task = asyncio.create_task(
                    self._flush_pending_after_delay(MEETING_REALTIME_STABLE_FAST_COMMIT_SECONDS)
                )
            return

        self.pending_tail_text = normalized_tail
        self.pending_tail_compare_key = tail_key
        self.pending_source_fingerprint = tail_key
        self.pending_tail_observed_at = time.monotonic()
        self.pending_tail_wait_seconds = get_meeting_realtime_pause_wait_seconds(normalized_tail)
        self.pending_tail_stable_count = 1
        self._cancel_flush_timer()
        if allow_timer and self.pending_tail_wait_seconds > 0:
            self.flush_timer_task = asyncio.create_task(self._flush_pending_after_delay())

    def _cancel_flush_timer(self) -> None:
        if self.flush_timer_task and not self.flush_timer_task.done() and self.flush_timer_task is not asyncio.current_task():
            self.flush_timer_task.cancel()
        self.flush_timer_task = None

    async def _flush_pending_after_delay(self, wait_override: float | None = None) -> None:
        try:
            wait_seconds = wait_override if wait_override is not None else (self.pending_tail_wait_seconds or MEETING_REALTIME_TRANSLATION_MAX_WAIT_SECONDS)
            await asyncio.sleep(wait_seconds)
            if self.closed:
                return
            if wait_override is not None or time.monotonic() - self.pending_tail_observed_at >= wait_seconds:
                await self._commit_pending_tail(force=False)
        except asyncio.CancelledError:
            raise
        finally:
            if self.flush_timer_task is asyncio.current_task():
                self.flush_timer_task = None

    async def _commit_pending_tail(self, force: bool) -> None:
        tail = self.pending_tail_text
        if not tail:
            return
        if force:
            if not is_force_committable_meeting_realtime_tail(tail):
                return
        elif not has_meeting_realtime_pause_commit_length(tail):
            return
        sentence_index = self.pending_sentence_index
        sentence_id = self.pending_sentence_id
        source_fingerprint = self.pending_source_fingerprint
        self._clear_pending_tail_only()
        await self._commit_sentence(
            tail,
            sentence_index=sentence_index,
            sentence_id=sentence_id,
            source_fingerprint=source_fingerprint,
        )

    async def _commit_sentence(
        self,
        sentence: str,
        sentence_index: int = 0,
        sentence_id: str = "",
        source_fingerprint: str = "",
    ) -> None:
        normalized = normalize_meeting_realtime_source(strip_meeting_realtime_leading_separators(sentence))
        normalized = self._trim_committed_prefix_from_sentence(normalized)
        if not normalized or is_meaningless_meeting_realtime_segment(normalized):
            return
        if is_tiny_meeting_realtime_fragment(normalized):
            return
        if self._is_already_committed(normalized):
            return

        compare_key = normalize_meeting_realtime_compare(normalized)
        if not compare_key:
            return

        target_language = get_meeting_translation_target(self.parameters)
        if not target_language:
            return

        if not sentence_index:
            sentence_index = self.next_sentence_index
            self.next_sentence_index += 1
        else:
            self.next_sentence_index = max(self.next_sentence_index, sentence_index + 1)
        sentence_id = sentence_id or self._make_sentence_id(sentence_index)
        source_fingerprint = source_fingerprint or compare_key
        previous_sentences = self.committed_sentences[-2:]
        previous_context_pairs = self.translated_context_pairs[-2:]
        self.committed_sentences.append(normalized)
        self.committed_sentence_keys.append(compare_key)
        self.committed_compare_key += compare_key

        await self._notify_pending_sentence(
            normalized,
            sentence_index,
            target_language,
            sentence_id,
            source_fingerprint,
            committed=True,
            provisional=False,
        )
        if len(self.translation_queue) >= MEETING_REALTIME_TRANSLATION_MAX_QUEUE:
            self.translation_queue = self.translation_queue[-(MEETING_REALTIME_TRANSLATION_MAX_QUEUE - 1) :]
        self.translation_queue.append({
            "segment": normalized,
            "target_language": target_language,
            "parameters": {**self.parameters},
            "context": dict(self.context),
            "sentence_index": sentence_index,
            "sentence_id": sentence_id,
            "source_fingerprint": source_fingerprint,
            "previous_sentences": previous_sentences,
            "previous_context_pairs": previous_context_pairs,
        })
        self._start_next_translations()

    def _make_sentence_id(self, sentence_index: int) -> str:
        return f"{self.audio_id or 'meeting'}:sentence:{sentence_index}"

    def _ensure_pending_sentence_identity(self) -> tuple[int, str, str]:
        if not self.pending_sentence_index:
            self.pending_sentence_index = self.next_sentence_index
            self.next_sentence_index += 1
        if not self.pending_sentence_id:
            self.pending_sentence_id = self._make_sentence_id(self.pending_sentence_index)
        self.pending_source_fingerprint = self.pending_source_fingerprint or normalize_meeting_realtime_compare(self.pending_tail_text)
        return self.pending_sentence_index, self.pending_sentence_id, self.pending_source_fingerprint

    async def _notify_pending_sentence(
        self,
        segment: str,
        sentence_index: int,
        target_language: str,
        sentence_id: str,
        source_fingerprint: str,
        committed: bool = True,
        provisional: bool = False,
    ) -> None:
        await send_ws_message(
            self.websocket,
            "meeting_translation_pending",
            {
                "audio_id": self.audio_id,
                "source_text": segment,
                "source_fingerprint": source_fingerprint,
                "target_language": target_language,
                "chunk_index": sentence_index,
                "sentence_index": sentence_index,
                "sentence_id": sentence_id,
                "stable": not provisional and committed,
                "committed": committed,
                "provisional": provisional,
                "phase": "preview" if provisional else "commit",
                "source_stable": bool(committed and not provisional),
                "commit_policy": "sentence_or_phrase_group",
                "realtime_profile": self.parameters.get("meeting_realtime_profile") or "frontier_simulst",
            },
        )

    def _should_preview_translate(self, segment: str) -> bool:
        text = normalize_meeting_realtime_source(segment)
        if not text or is_meaningless_meeting_realtime_segment(text) or is_tiny_meeting_realtime_fragment(text):
            return False
        metrics = get_meeting_realtime_commit_metrics(text)
        if bool(metrics["compact"]):
            return int(metrics["units"]) >= 2
        return int(metrics["units"]) >= 1 and int(metrics["compare_length"]) >= 3

    def _schedule_preview_translation(
        self,
        segment: str,
        target_language: str,
        sentence_index: int,
        sentence_id: str,
        source_fingerprint: str,
    ) -> None:
        if self.closed or get_translation_engine_preference(self.parameters) == "llm":
            return
        if not self._should_preview_translate(segment):
            return
        compare_key = normalize_meeting_realtime_compare(segment)
        if not compare_key or compare_key == self.last_preview_compare_key:
            return
        now_value = time.monotonic()
        if now_value - self.last_preview_started_at < MEETING_REALTIME_PREVIEW_MIN_INTERVAL_SECONDS:
            return
        self.last_preview_started_at = now_value
        self.last_preview_compare_key = compare_key
        self.preview_generation += 1
        generation = self.preview_generation
        if self.preview_task and not self.preview_task.done():
            self.preview_task.cancel()
        self.preview_task = asyncio.create_task(self._translate_preview_after_delay(
            segment=segment,
            target_language=target_language,
            sentence_index=sentence_index,
            sentence_id=sentence_id,
            source_fingerprint=source_fingerprint,
            generation=generation,
        ))

    async def _translate_preview_after_delay(
        self,
        segment: str,
        target_language: str,
        sentence_index: int,
        sentence_id: str,
        source_fingerprint: str,
        generation: int,
    ) -> None:
        try:
            await asyncio.sleep(MEETING_REALTIME_PREVIEW_DEBOUNCE_SECONDS)
            if self.closed or generation != self.preview_generation:
                return
            translation_meta = await translate_realtime_preview(
                raw_text=segment,
                target_language=target_language,
                previous_sentences=self.committed_sentences[-1:],
                previous_context_pairs=self.translated_context_pairs[-1:],
            )
            translation_text = str(translation_meta.get("text") or "")
            if self.closed or generation != self.preview_generation or not translation_text:
                return
            if self.pending_sentence_id and self.pending_sentence_id != sentence_id:
                return
            await send_ws_message(
                self.websocket,
                "meeting_translation",
                {
                    "audio_id": self.audio_id,
                    "text": translation_text,
                    "source_text": segment,
                    "source_fingerprint": source_fingerprint,
                    "target_language": target_language,
                    "chunk_index": sentence_index,
                    "sentence_index": sentence_index,
                    "sentence_id": sentence_id,
                    "partial": True,
                    "stable": False,
                    "committed": False,
                    "provisional": True,
                    "phase": "preview",
                    "source_stable": False,
                    "commit_policy": "sentence_or_phrase_group",
                    "realtime_profile": self.parameters.get("meeting_realtime_profile") or "frontier_simulst",
                    "translation_engine": translation_meta.get("translation_engine") or "local_hy_mt",
                    "translation_latency_ms": translation_meta.get("translation_latency_ms"),
                    "local_model_status": translation_meta.get("local_model_status"),
                },
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            return

    def _start_next_translations(self) -> None:
        if self.closed:
            return
        while self.translation_queue and len([task for task in self.active_tasks if not task.done()]) < MEETING_REALTIME_TRANSLATION_MAX_CONCURRENCY:
            item = self.translation_queue.pop(0)
            task = asyncio.create_task(self._translate_sentence(**item))
            self.active_tasks.add(task)

    async def _translate_sentence(
        self,
        segment: str,
        target_language: str,
        parameters: dict,
        context: dict,
        sentence_index: int,
        sentence_id: str,
        source_fingerprint: str,
        previous_sentences: list[str],
        previous_context_pairs: list[dict],
    ) -> None:
        try:
            cache_key = (normalize_meeting_realtime_compare(segment), target_language)
            cached_translation = self.translation_cache.get(cache_key)
            translation_text = str(cached_translation.get("text") or "") if isinstance(cached_translation, dict) else ""
            translation_meta = cached_translation if isinstance(cached_translation, dict) else {}
            if not translation_text:
                translation_result = await translate_realtime_sentence(
                    raw_text=segment,
                    target_language=target_language,
                    context=context,
                    parameters=parameters,
                    previous_sentences=previous_sentences,
                    previous_context_pairs=previous_context_pairs,
                )
                translation_text = str(translation_result.get("text") or "")
                translation_meta = translation_result
                if translation_text:
                    self.translation_cache[cache_key] = translation_meta
            if self.closed or not translation_text:
                return
            self.translated_context_pairs.append({
                "source": segment,
                "translation": translation_text,
                "target_language": target_language,
            })
            self.translated_context_pairs = self.translated_context_pairs[-6:]
            await send_ws_message(
                self.websocket,
                "meeting_translation",
                {
                    "audio_id": self.audio_id,
                    "text": translation_text,
                    "source_text": segment,
                    "source_fingerprint": source_fingerprint,
                    "target_language": target_language,
                    "chunk_index": sentence_index,
                    "sentence_index": sentence_index,
                    "sentence_id": sentence_id,
                    "partial": True,
                    "stable": True,
                    "committed": True,
                    "phase": "commit",
                    "source_stable": True,
                    "commit_policy": "sentence_or_phrase_group",
                    "realtime_profile": parameters.get("meeting_realtime_profile") or "frontier_simulst",
                    "translation_engine": translation_meta.get("translation_engine") or "llm",
                    "translation_latency_ms": translation_meta.get("translation_latency_ms"),
                    "local_model_status": translation_meta.get("local_model_status"),
                },
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not self.closed:
                await send_ws_error_message(
                    self.websocket,
                    "meeting_translation_error",
                    self.audio_id,
                    str(error),
                    "meeting_translation_failed",
                )
        finally:
            current_task = asyncio.current_task()
            if current_task in self.active_tasks:
                self.active_tasks.discard(current_task)
            if not self.closed:
                self._start_next_translations()


async def refine_voice_flow_text(
    raw_text: str,
    mode: str,
    context: dict | None,
    parameters: dict | None,
) -> tuple[str, dict]:
    if mode != "meeting_notes":
        if mode == "translation":
            target_language = ""
            if isinstance(parameters, dict):
                target_language = str(parameters.get("output_language") or parameters.get("target_language") or "")
            translation_result = await translate_text_with_engine(
                raw_text=raw_text,
                target_language=target_language or "en",
                context=context or {},
                parameters=parameters or {},
            )
            return str(translation_result.get("text") or ""), {
                "translation_engine": translation_result.get("translation_engine"),
                "translation_latency_ms": translation_result.get("translation_latency_ms"),
                "local_model_status": translation_result.get("local_model_status"),
            }
        refined = await refine_text(
            raw_text=raw_text,
            mode=mode,
            context=context,
            parameters=parameters,
        )
        return refined, {}

    refined, meeting_extra = await refine_meeting_notes_summary(
        raw_text=raw_text,
        context=context,
        parameters=parameters,
    )
    structured_result = build_meeting_structured_result(
        raw_text=raw_text,
        summary=refined,
        parameters=parameters,
        context=context,
    )
    target_language = get_meeting_translation_target(parameters)
    if not target_language:
        return refined, {
            **meeting_extra,
            "translation_text": "",
            "meeting_structured": structured_result,
        }

    translation_parameters = {
        **(parameters if isinstance(parameters, dict) else {}),
        "output_language": target_language,
    }
    translation_result = await translate_text_with_engine(
        raw_text=raw_text,
        target_language=target_language,
        context=context or {},
        parameters=translation_parameters,
    )
    return refined, {
        **meeting_extra,
        "translation_text": str(translation_result.get("text") or ""),
        "translation_engine": translation_result.get("translation_engine"),
        "translation_latency_ms": translation_result.get("translation_latency_ms"),
        "local_model_status": translation_result.get("local_model_status"),
        "meeting_structured": structured_result,
    }


async def handle_voice_flow_request(
    audio_file: UploadFile,
    mode: str,
    audio_context: str,
    parameters: str,
) -> dict:
    suffix = detect_uploaded_audio_suffix(audio_file.filename)
    tmp_path = await save_upload_to_temp_file(audio_file, suffix)

    try:
        context = normalize_json_object_field(audio_context)
        params = normalize_json_object_field(parameters)
        raw_text = normalize_meeting_transcription_text(
            await transcribe_audio_with_wav_conversion(tmp_path, suffix),
            mode,
        )

        if not raw_text or not raw_text.strip():
            return create_flow_success_payload(refined_text="", raw_text="")

        try:
            refined, extra_data = await refine_voice_flow_text(
                raw_text=raw_text,
                mode=mode,
                context=context,
                parameters=params,
            )
        except Exception as error:
            if mode == "meeting_notes":
                fallback_summary = create_meeting_notes_fallback_summary(raw_text, str(error))
                return create_flow_success_payload(
                    refined_text=fallback_summary,
                    raw_text=raw_text,
                    extra_data={
                        "partial_success": True,
                        "summary_error": str(error),
                        "translation_text": "",
                        "meeting_structured": build_meeting_structured_result(
                            raw_text=raw_text,
                            summary=fallback_summary,
                            parameters=params,
                            context=context,
                            partial_success=True,
                            summary_error=str(error),
                        ),
                    },
                )
            raise

        return create_flow_success_payload(refined_text=refined, raw_text=raw_text, extra_data=extra_data)
    except HTTPException:
        raise
    except Exception as error:
        return create_flow_error_payload(detail=str(error), code="voice_flow_failed")
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


async def handle_text_refine_request(payload: dict) -> dict:
    text = str(payload.get("text") or payload.get("raw_text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    mode = payload.get("mode", "transcript") if isinstance(payload.get("mode"), str) else "transcript"
    context = normalize_ws_object(payload.get("audio_context") or payload.get("context") or {})
    parameters = normalize_ws_object(payload.get("parameters") or {})

    try:
        refined, extra_data = await refine_voice_flow_text(
            raw_text=text,
            mode=mode,
            context=context,
            parameters=parameters,
        )
        return create_flow_success_payload(refined_text=refined, raw_text=text, extra_data=extra_data)
    except Exception as error:
        return create_flow_error_payload(detail=str(error), code="text_refine_failed", raw_text=text)


async def ws_voice_flow(websocket: WebSocket, app_instance: FastAPI | None = None):
    await websocket.accept()

    audio_id = ""
    mode = "transcript"
    context = {}
    parameters = {}
    audio_chunks: list[bytes] = []
    realtime_pipeline: MeetingRealtimePipeline | None = None
    streaming_chunk_index = 0
    realtime_translator = MeetingRealtimeTranslator(websocket)

    async def emit_streaming_transcription(result, observe_translation: bool = True) -> None:
        nonlocal streaming_chunk_index
        streaming_chunk_index += 1
        result_text = normalize_meeting_transcription_text(result.text, mode)
        result_segment_text = normalize_meeting_transcription_text(
            str(getattr(result, "segment_text", "") or ""),
            mode,
        )
        if not result_text:
            return

        result_stable = bool(getattr(result, "stable", True))
        result_utterance_index = int(getattr(result, "utterance_index", 0) or streaming_chunk_index)
        stable_text = normalize_meeting_transcription_text(str(getattr(result, "stable_text", "") or ""), mode)
        partial_text = normalize_meeting_transcription_text(str(getattr(result, "partial_text", "") or ""), mode)
        configured_source_profile = parameters.get("meeting_audio_source") if isinstance(parameters, dict) else ""
        source_profile = str(getattr(result, "source_profile", "") or configured_source_profile or "")
        await send_ws_message(
            websocket,
            "transcription",
            {
                "text": result_text,
                "segment_text": result_segment_text,
                "stable_segment_text": result_segment_text if result_stable else "",
                "stable_text": stable_text if not result_stable else result_text,
                "partial_text": "" if result_stable else (partial_text or result_segment_text),
                "audio_id": audio_id,
                "chunk_index": streaming_chunk_index,
                "utterance_index": result_utterance_index,
                "stable": result_stable,
                "is_partial": bool(getattr(result, "is_partial", not result_stable)),
                "asr_latency_ms": int(getattr(result, "asr_latency_ms", 0) or 0),
                "asr_backlog_ms": int(getattr(result, "asr_backlog_ms", 0) or 0),
                "asr_rtf": float(getattr(result, "asr_rtf", 0.0) or 0.0),
                "endpoint_reason": str(getattr(result, "endpoint_reason", "") or ""),
                "asr_window_ms": int(getattr(result, "asr_window_ms", 0) or 0),
                "asr_full_segment_ms": int(getattr(result, "asr_full_segment_ms", 0) or getattr(result, "asr_window_ms", 0) or 0),
                "hypothesis_id": str(getattr(result, "hypothesis_id", "") or ""),
                "revision_id": str(getattr(result, "revision_id", "") or ""),
                "utterance_id": str(getattr(result, "utterance_id", "") or result_utterance_index),
                "asr_engine": str(getattr(result, "asr_engine", "") or ("final_sensevoice" if result_stable and not observe_translation else "sensevoice_endpoint")),
                "source_profile": source_profile,
                "audio_source_profile": str(configured_source_profile or ""),
            },
        )
        if observe_translation:
            await realtime_translator.observe_transcription(
                result_text,
                streaming_chunk_index,
                stable=result_stable,
                segment_text=result_segment_text,
            )

    async def emit_streaming_error(error: Exception) -> None:
        await send_ws_error_message(
            websocket,
            "transcription_error",
            audio_id,
            str(error),
            "transcription_failed",
        )

    try:
        while True:
            message = await websocket.receive()

            if message["type"] != "websocket.receive":
                continue

            if "bytes" in message and message["bytes"]:
                if realtime_pipeline is not None:
                    await realtime_pipeline.append_pcm16(message["bytes"])
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
                if realtime_pipeline is not None:
                    await realtime_pipeline.cancel()
                realtime_pipeline = None
                streaming_chunk_index = 0
                realtime_translator.reset(audio_id, mode, context, parameters)
                sample_rate = get_pcm_streaming_sample_rate(parameters)
                if sample_rate:
                    try:
                        realtime_pipeline = MeetingRealtimePipeline(
                            sample_rate=sample_rate,
                            source_profile=str(parameters.get("meeting_audio_source") or ""),
                            session_factory=create_streaming_asr_session,
                            on_result=emit_streaming_transcription,
                            on_error=emit_streaming_error,
                        )
                        await realtime_pipeline.start()
                    except RuntimeError:
                        realtime_pipeline = None

                await send_ws_message(websocket, "session_started", {"audio_id": audio_id})
                await send_ws_message(
                    websocket,
                    "process_mode",
                    create_process_mode_payload(audio_id, mode, parameters),
                )
                await send_ws_message(websocket, "audio_session_started", {"audio_id": audio_id})
                continue

            if msg_type == "end_audio":
                parameters = merge_ws_end_audio_parameters(parameters, data)
                if realtime_pipeline is not None:
                    current_realtime_pipeline = realtime_pipeline
                    realtime_pipeline = None
                    try:
                        final_result = await current_realtime_pipeline.finish()
                        raw_text = normalize_meeting_transcription_text(final_result.text, mode)
                    except Exception as error:
                        await send_ws_error_message(
                            websocket,
                            "transcription_error",
                            audio_id,
                            str(error),
                            "transcription_failed",
                        )
                        continue

                    await realtime_translator.drain()
                    realtime_translator.cancel()
                    await send_ws_message(websocket, "audio_session_ending", {"audio_id": audio_id})
                    if raw_text:
                        await emit_streaming_transcription(final_result, observe_translation=False)
                        try:
                            refined, extra_data = await refine_voice_flow_text(
                                raw_text=raw_text,
                                mode=mode,
                                context=context,
                                parameters=parameters,
                            )
                        except Exception as error:
                            if mode == "meeting_notes":
                                fallback_summary = create_meeting_notes_fallback_summary(raw_text, str(error))
                                await send_ws_message(
                                    websocket,
                                    get_ws_completion_message_type(mode, parameters),
                                    {
                                        "audio_id": audio_id,
                                        "refined_text": fallback_summary,
                                        "refine_text": fallback_summary,
                                        "delivery": "inline",
                                        "user_prompt": raw_text,
                                        "web_metadata": None,
                                        "external_action": None,
                                        "partial_success": True,
                                        "summary_error": str(error),
                                        "meeting_structured": build_meeting_structured_result(
                                            raw_text=raw_text,
                                            summary=fallback_summary,
                                            parameters=parameters,
                                            context=context,
                                            partial_success=True,
                                            summary_error=str(error),
                                        ),
                                    },
                                )
                                continue
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
                                **extra_data,
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

                await realtime_translator.drain()
                realtime_translator.cancel()
                await send_ws_message(websocket, "audio_session_ending", {"audio_id": audio_id})

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
                        raw_text = normalize_meeting_transcription_text(
                            await transcribe_audio_with_wav_conversion(tmp_path, suffix),
                            mode,
                        )
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
                            {
                                "text": raw_text,
                                "stable_text": raw_text,
                                "partial_text": "",
                                "audio_id": audio_id,
                                "chunk_index": 0,
                                "utterance_index": 0,
                                "revision_id": "final:0",
                                "utterance_id": "final:0",
                                "asr_engine": "final_sensevoice",
                                "stable": True,
                                "is_partial": False,
                                "asr_latency_ms": 0,
                                "asr_backlog_ms": 0,
                                "asr_rtf": 0.0,
                                "audio_source_profile": parameters.get("meeting_audio_source") if isinstance(parameters, dict) else "",
                            },
                        )
                        try:
                            refined, extra_data = await refine_voice_flow_text(
                                raw_text=raw_text,
                                mode=mode,
                                context=context,
                                parameters=parameters,
                            )
                        except Exception as error:
                            if mode == "meeting_notes":
                                fallback_summary = create_meeting_notes_fallback_summary(raw_text, str(error))
                                await send_ws_message(
                                    websocket,
                                    get_ws_completion_message_type(mode, parameters),
                                    {
                                        "audio_id": audio_id,
                                        "refined_text": fallback_summary,
                                        "refine_text": fallback_summary,
                                        "delivery": "inline",
                                        "user_prompt": raw_text,
                                        "web_metadata": None,
                                        "external_action": None,
                                        "partial_success": True,
                                        "summary_error": str(error),
                                        "meeting_structured": build_meeting_structured_result(
                                            raw_text=raw_text,
                                            summary=fallback_summary,
                                            parameters=parameters,
                                            context=context,
                                            partial_success=True,
                                            summary_error=str(error),
                                        ),
                                    },
                                )
                                continue
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
                                **extra_data,
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
                realtime_translator.update_config(mode, parameters)
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
        if realtime_pipeline is not None:
            with suppress(Exception):
                await realtime_pipeline.drain_live()
            realtime_pipeline = None
    finally:
        try:
            if realtime_pipeline is not None:
                await realtime_pipeline.cancel()
            await realtime_translator.drain()
        finally:
            realtime_translator.cancel()


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
        start_translation_model_auto_preload_task(app)
        try:
            yield
        finally:
            preload_task = getattr(app.state, "voice_preload_task", None)
            if preload_task:
                preload_task.cancel()
            translation_task = getattr(app.state, "translation_model_task", None)
            if translation_task:
                translation_task.cancel()
            await asyncio.to_thread(unload_translation_model)

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

    @app.get("/translation-model/status")
    async def translation_model_status(request: Request):
        apply_translation_model_cache_dir(request.query_params.get("cache_dir"))
        return get_translation_model_status()

    @app.post("/translation-model/download")
    async def translation_model_download(request: Request):
        apply_translation_model_cache_dir(await read_translation_model_cache_dir_from_request(request))
        start_translation_model_download_task(app)
        return get_translation_model_status()

    @app.post("/translation-model/load")
    async def translation_model_load(request: Request):
        apply_translation_model_cache_dir(await read_translation_model_cache_dir_from_request(request))
        start_translation_model_load_task(app)
        return get_translation_model_status()

    @app.post("/translation-model/unload")
    async def translation_model_unload():
        await asyncio.to_thread(unload_translation_model)
        return get_translation_model_status()

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

    @app.post("/ai/text_refine")
    async def text_refine(request: Request):
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="JSON body must be an object")
        return await handle_text_refine_request(payload)

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
