from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import importlib.util
from pathlib import Path
from threading import Lock
from typing import Callable

import httpx

from download_progress import DownloadProgress, create_hf_tqdm_class
from model_manager import get_managed_models_root, repo_cache_dir_name


TRANSLATION_MODEL_ID = "hy-mt2-1.8b"
STQ_TRANSLATION_PROFILE = "stq"
STANDARD_TRANSLATION_PROFILE = "standard"
TRANSLATION_MODEL_PROFILES = {
    STQ_TRANSLATION_PROFILE: {
        "model_id": "hy-mt2-1.8b-1.25bit",
        "repo_id": "tencent/Hy-MT2-1.8B-1.25Bit",
        "gguf_repo_id": "tencent/Hy-MT2-1.8B-1.25Bit-GGUF",
        "model_file": "Hy-MT2-1.8B-1.25Bit.gguf",
        "runtime_profile": STQ_TRANSLATION_PROFILE,
    },
    STANDARD_TRANSLATION_PROFILE: {
        "model_id": "hy-mt2-1.8b-q4-k-m",
        "repo_id": "tencent/Hy-MT2-1.8B Q4_K_M",
        "gguf_repo_id": "tencent/Hy-MT2-1.8B-GGUF",
        "model_file": "Hy-MT2-1.8B-Q4_K_M.gguf",
        "runtime_profile": STANDARD_TRANSLATION_PROFILE,
    },
}
LEGACY_TRANSLATION_MODEL_GGUF_REPO_ID = "AngelSlim/Hy-MT1.5-1.8B-2bit-GGUF"
TRANSLATION_MODEL_CACHE_DIR_ENV = "SPEAKMORE_TRANSLATION_MODEL_CACHE_DIR"
BUNDLED_LLAMA_SERVER_PATH_ENV = "SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH"
BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV = "SPEAKMORE_BUNDLED_HYMT_LLAMA_SERVER_PATH"
LLAMA_SERVER_PATH_ENVS = ("SPEAKMORE_LLAMA_SERVER_PATH", "LLAMA_SERVER_PATH", BUNDLED_LLAMA_SERVER_PATH_ENV)
HYMT_LLAMA_SERVER_PATH_ENVS = (
    "SPEAKMORE_HYMT_LLAMA_SERVER_PATH",
    BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV,
)
LLAMA_SERVER_URL_ENV = "SPEAKMORE_LOCAL_TRANSLATION_SERVER_URL"
LLAMA_SERVER_PORT_ENV = "SPEAKMORE_LLAMA_SERVER_PORT"
DEFAULT_LLAMA_SERVER_PORT = 8105
TRANSLATION_MODEL_DOWNLOAD_ATTEMPTS = 3
TRANSLATION_MODEL_DOWNLOAD_RETRY_DELAY_SECONDS = 1.5
DOWNLOAD_INTERRUPTED_DETAIL_CODE = "translation_model_download_interrupted"
DOWNLOAD_FAILED_DETAIL_CODE = "translation_model_download_failed"
SELF_TEST_FAILED_DETAIL_CODE = "translation_model_self_test_failed"
RUNTIME_MISSING_DETAIL = (
    "Local translation runtime is missing. Bundle llama-server with the app, set "
    "SPEAKMORE_BUNDLED_LLAMA_SERVER_PATH / SPEAKMORE_LLAMA_SERVER_PATH / LLAMA_SERVER_PATH, "
    "install llama-server on PATH, or install llama-cpp-python in the backend Python environment."
)
LOCAL_TRANSLATION_TIMEOUT_SECONDS = 8.0
LOCAL_TRANSLATION_SELF_TEST_TIMEOUT_SECONDS = 12.0
LOCAL_TRANSLATION_RECOMMENDED_SAMPLING = {
    "temperature": 0.7,
    "top_p": 0.6,
    "top_k": 20,
    "repeat_penalty": 1.05,
}
LOCAL_TRANSLATION_SUPPORTED_TARGETS = {
    "zh",
    "zh-CN",
    "zh-TW",
    "en",
    "ja",
    "ko",
    "es",
    "pt",
    "pt-BR",
    "fr",
    "de",
    "it",
    "ru",
    "uk",
    "ar",
    "he",
    "fa",
    "hi",
    "bn",
    "ur",
    "th",
    "vi",
    "id",
    "ms",
    "fil",
    "my",
    "km",
    "lo",
    "nl",
    "pl",
    "tr",
    "el",
    "cs",
    "ro",
    "hu",
    "sv",
    "da",
    "no",
    "fi",
    "sw",
}


_state_lock = Lock()
_runtime_process: subprocess.Popen | None = None
_runtime_url = ""
_runtime_kind = ""
_runtime_profile = STANDARD_TRANSLATION_PROFILE
_translation_model_state: dict = {
    "status": "idle",
    "detail": "",
    "started_at": None,
}


class TranslationModelSelfTestError(RuntimeError):
    pass


def normalize_optional_path(value: str | None) -> str:
    return str(Path(value).expanduser()) if isinstance(value, str) and value.strip() else ""


def configure_translation_model_cache_dir(cache_dir: str | None) -> Path:
    normalized = normalize_optional_path(cache_dir)
    if normalized:
        os.environ[TRANSLATION_MODEL_CACHE_DIR_ENV] = normalized
    else:
        os.environ.pop(TRANSLATION_MODEL_CACHE_DIR_ENV, None)
    return get_translation_model_cache_root()


def get_translation_model_cache_root() -> Path:
    configured = normalize_optional_path(os.environ.get(TRANSLATION_MODEL_CACHE_DIR_ENV))
    if configured:
        return Path(configured)
    return get_managed_models_root() / "translation"


def normalize_translation_profile(value: str | None = None) -> str:
    return value if value in TRANSLATION_MODEL_PROFILES else STANDARD_TRANSLATION_PROFILE


def get_translation_profile(profile: str | None = None) -> dict[str, str]:
    return TRANSLATION_MODEL_PROFILES[normalize_translation_profile(profile)]


def get_translation_model_snapshot_root(cache_root: Path | None = None, profile: str | None = None) -> Path:
    root = Path(cache_root) if cache_root is not None else get_translation_model_cache_root()
    return root / repo_cache_dir_name(get_translation_profile(profile)["gguf_repo_id"]) / "snapshots"


def is_valid_translation_model_snapshot(path: Path, profile: str | None = None) -> bool:
    return path.is_dir() and (path / get_translation_profile(profile)["model_file"]).is_file()


def find_cached_translation_model_snapshot(cache_root: Path | None = None, profile: str | None = None) -> Path | None:
    profile_id = normalize_translation_profile(profile)
    snapshots_root = get_translation_model_snapshot_root(cache_root, profile_id)
    try:
        candidates = list(snapshots_root.iterdir())
    except (FileNotFoundError, OSError):
        return None

    sortable_snapshots = []
    for snapshot in candidates:
        try:
            if snapshot.is_dir():
                sortable_snapshots.append((snapshot.stat().st_mtime, snapshot))
        except OSError:
            continue

    sortable_snapshots.sort(key=lambda item: item[0], reverse=True)
    for _mtime, snapshot in sortable_snapshots:
        if is_valid_translation_model_snapshot(snapshot, profile_id):
            return snapshot
    return None


def find_cached_translation_model_file(cache_root: Path | None = None, profile: str | None = None) -> Path | None:
    profile_id = normalize_translation_profile(profile)
    model_file_name = get_translation_profile(profile_id)["model_file"]
    root = Path(cache_root) if cache_root is not None else get_translation_model_cache_root()
    direct_file = root / model_file_name
    if direct_file.is_file():
        return direct_file
    snapshot = find_cached_translation_model_snapshot(root, profile_id)
    if snapshot:
        return snapshot / model_file_name
    return None


def find_legacy_translation_model_cache_root(cache_root: Path | None = None) -> Path:
    root = Path(cache_root) if cache_root is not None else get_translation_model_cache_root()
    return root / repo_cache_dir_name(LEGACY_TRANSLATION_MODEL_GGUF_REPO_ID)


def cleanup_legacy_translation_model_residue(cache_root: Path | None = None, remove_legacy_cache: bool = False) -> None:
    root = Path(cache_root) if cache_root is not None else get_translation_model_cache_root()
    try:
        root_resolved = root.resolve()
    except OSError:
        root_resolved = root
    legacy_cache = find_legacy_translation_model_cache_root(root)
    legacy_lock = root / ".locks" / repo_cache_dir_name(LEGACY_TRANSLATION_MODEL_GGUF_REPO_ID)
    cleanup_targets = [legacy_lock]
    if remove_legacy_cache:
        cleanup_targets.append(legacy_cache)
    if not is_runtime_process_alive():
        cleanup_targets.append(root / "llama-server.log")
    try:
        cleanup_targets.extend(root.glob(".tmp-hymt-*"))
    except OSError:
        pass

    for target in cleanup_targets:
        try:
            resolved = target.resolve()
            try:
                resolved.relative_to(root_resolved)
            except ValueError:
                continue
            if target.exists():
                if target.is_dir():
                    shutil.rmtree(target, ignore_errors=True)
                else:
                    target.unlink(missing_ok=True)
        except OSError:
            continue


def is_retryable_translation_model_download_error(error: Exception | str) -> bool:
    text = str(error or "").lower()
    retry_markers = (
        "incompleteread",
        "connection broken",
        "connection reset",
        "connection aborted",
        "remote end closed",
        "read timed out",
        "timeout",
        "temporarily unavailable",
        "chunkedencodingerror",
        "protocolerror",
        "ssl",
        "eof occurred",
    )
    return any(marker in text for marker in retry_markers)


def normalize_translation_model_download_error(error: Exception | str) -> str:
    if is_retryable_translation_model_download_error(error):
        return DOWNLOAD_INTERRUPTED_DETAIL_CODE
    error_text = str(error or "").strip()
    if not error_text:
        return DOWNLOAD_FAILED_DETAIL_CODE
    return f"{DOWNLOAD_FAILED_DETAIL_CODE}: {error_text[:300]}"


def normalize_download_progress(progress: dict | None = None) -> dict[str, int | None]:
    downloaded = progress.get("downloaded_bytes") if isinstance(progress, dict) else None
    total = progress.get("total_bytes") if isinstance(progress, dict) else None
    percent = progress.get("progress_percent") if isinstance(progress, dict) else None
    downloaded_files = progress.get("downloaded_files") if isinstance(progress, dict) else None
    total_files = progress.get("total_files") if isinstance(progress, dict) else None
    file_percent = progress.get("file_progress_percent") if isinstance(progress, dict) else None
    progress_percent = int(percent) if isinstance(percent, (int, float)) else None
    file_progress_percent = int(file_percent) if isinstance(file_percent, (int, float)) else None
    if progress_percent is not None:
        progress_percent = max(0, min(100, progress_percent))
    if file_progress_percent is not None:
        file_progress_percent = max(0, min(100, file_progress_percent))
    return {
        "downloaded_bytes": max(0, int(downloaded)) if isinstance(downloaded, (int, float)) else 0,
        "total_bytes": max(0, int(total)) if isinstance(total, (int, float)) else 0,
        "progress_percent": progress_percent,
        "downloaded_files": max(0, int(downloaded_files)) if isinstance(downloaded_files, (int, float)) else 0,
        "total_files": max(0, int(total_files)) if isinstance(total_files, (int, float)) else 0,
        "file_progress_percent": file_progress_percent,
    }


def set_translation_model_state(status: str, detail: str = "", started_at: float | None = None, progress: dict | None = None) -> None:
    with _state_lock:
        current = dict(_translation_model_state)
        if started_at is None and status in {"downloading", "loading"}:
            started_at = current.get("started_at") if isinstance(current.get("started_at"), float) else time.time()
        _translation_model_state.clear()
        _translation_model_state.update({
            "status": status,
            "detail": detail,
            "started_at": started_at,
            **normalize_download_progress(progress),
        })


def update_translation_model_progress(progress: DownloadProgress) -> None:
    with _state_lock:
        current = dict(_translation_model_state)
        _translation_model_state.clear()
        _translation_model_state.update({
            **current,
            **normalize_download_progress(progress),
            "updated_at": time.time(),
        })


def get_runtime_url() -> str:
    external_url = str(os.environ.get(LLAMA_SERVER_URL_ENV, "") or "").strip().rstrip("/")
    if external_url:
        return external_url
    return _runtime_url


def get_runtime_log_path() -> Path:
    return get_translation_model_cache_root() / "llama-server.log"


def read_runtime_log_tail(log_path: Path | None = None, max_chars: int = 2400) -> str:
    path = log_path or get_runtime_log_path()
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return text[-max_chars:].strip()


def build_runtime_failure_detail(error: Exception | str, log_tail: str = "") -> str:
    error_text = str(error or "").strip()
    if SELF_TEST_FAILED_DETAIL_CODE in error_text:
        return error_text
    log_lower = log_tail.lower()
    if "gguf_init_from_reader" in log_lower or "failed to load model" in log_lower:
        return (
            "Local translation model could not be loaded. The cached GGUF may be incomplete "
            "or incompatible with the bundled llama.cpp runtime."
        )
    if "port" in error_text.lower() and "already in use" in error_text.lower():
        return error_text
    if log_tail:
        last_line = log_tail.splitlines()[-1].strip()
        if last_line:
            return f"Local translation runtime failed to start: {last_line[:300]}"
    return f"Local translation runtime failed to start: {error_text or 'unknown error'}"


def is_runtime_process_alive() -> bool:
    return bool(_runtime_process and _runtime_process.poll() is None)


def is_translation_model_ready() -> bool:
    return get_translation_model_status()["ready"] is True


def get_cached_translation_profiles() -> dict[str, Path]:
    return {
        profile_id: model_file
        for profile_id in TRANSLATION_MODEL_PROFILES
        if (model_file := find_cached_translation_model_file(profile=profile_id)) is not None
    }


def select_download_profile() -> str:
    stq_runtime = resolve_llama_server_runtime(STQ_TRANSLATION_PROFILE)
    return STQ_TRANSLATION_PROFILE if stq_runtime["path"] else STANDARD_TRANSLATION_PROFILE


def select_status_profile(cached_profiles: dict[str, Path], current_profile: str = "") -> str:
    requested_profile = current_profile if current_profile in TRANSLATION_MODEL_PROFILES else ""
    if requested_profile and requested_profile in cached_profiles:
        return requested_profile
    stq_runtime = resolve_llama_server_runtime(STQ_TRANSLATION_PROFILE)
    standard_runtime = resolve_llama_server_runtime(STANDARD_TRANSLATION_PROFILE)
    if STQ_TRANSLATION_PROFILE in cached_profiles and stq_runtime["path"]:
        return STQ_TRANSLATION_PROFILE
    if STANDARD_TRANSLATION_PROFILE in cached_profiles and standard_runtime["path"]:
        return STANDARD_TRANSLATION_PROFILE
    if STQ_TRANSLATION_PROFILE in cached_profiles and not standard_runtime["path"]:
        return STQ_TRANSLATION_PROFILE
    if STANDARD_TRANSLATION_PROFILE in cached_profiles:
        return STANDARD_TRANSLATION_PROFILE
    return select_download_profile()


def get_translation_model_status() -> dict:
    now = time.time()
    with _state_lock:
        current = dict(_translation_model_state)

    cached_profiles = get_cached_translation_profiles()
    status = str(current.get("status") or "idle")
    runtime_url = get_runtime_url()
    runtime_ready = bool(
        runtime_url
        and (
            str(os.environ.get(LLAMA_SERVER_URL_ENV, "")).strip()
            or is_runtime_process_alive()
            or _runtime_kind == "llama-server-existing"
        )
    )
    if status == "ready" and not runtime_ready:
        status = "runtime_missing"

    selected_profile = select_status_profile(cached_profiles, _runtime_profile if runtime_ready else "")
    profile = get_translation_profile(selected_profile)
    cached_file = cached_profiles.get(selected_profile)
    available_runtime = get_available_runtime_info(selected_profile)
    fallback_reason = ""
    if selected_profile == STANDARD_TRANSLATION_PROFILE and not resolve_llama_server_runtime(STQ_TRANSLATION_PROFILE)["path"]:
        fallback_reason = "stq_runtime_unavailable"
    if selected_profile == STANDARD_TRANSLATION_PROFILE and STQ_TRANSLATION_PROFILE in cached_profiles and STANDARD_TRANSLATION_PROFILE in cached_profiles:
        fallback_reason = fallback_reason or "using_stable_profile"
    started_at = current.get("started_at")
    return {
        "status": status,
        "detail": str(current.get("detail") or ""),
        "model_id": profile["model_id"],
        "repo_id": profile["repo_id"],
        "gguf_repo_id": profile["gguf_repo_id"],
        "model_file": profile["model_file"],
        "runtime_profile": selected_profile,
        "available_profiles": sorted(cached_profiles.keys()),
        "fallback_reason": fallback_reason,
        "cache_dir": str(get_translation_model_cache_root()),
        "cached": cached_file is not None,
        "model_path": str(cached_file) if cached_file else "",
        "ready": status == "ready",
        "runtime_url": runtime_url,
        "runtime_kind": _runtime_kind if runtime_url else "",
        **available_runtime,
        "runtime_pid": _runtime_process.pid if is_runtime_process_alive() else None,
        "runtime_log_path": str(get_runtime_log_path()),
        "runtime_missing": status == "runtime_missing",
        "self_test_passed": status == "ready",
        "started_at": started_at,
        "updated_at": now,
        "elapsed_ms": int((now - started_at) * 1000) if isinstance(started_at, (float, int)) else 0,
        **normalize_download_progress(current),
    }


def download_translation_model(progress_callback: Callable[[DownloadProgress], None] | None = None) -> Path:
    from huggingface_hub import snapshot_download

    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    profile_id = select_download_profile()
    profile = get_translation_profile(profile_id)
    cache_root = get_translation_model_cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)
    tqdm_class = create_hf_tqdm_class(progress_callback) if progress_callback else None
    kwargs = {
        "repo_id": profile["gguf_repo_id"],
        "cache_dir": cache_root,
        "allow_patterns": [profile["model_file"], "README.md", "README_CN.md", "LICENSE.txt", "License.txt"],
        "max_workers": 2,
        "resume_download": True,
    }
    if tqdm_class:
        kwargs["tqdm_class"] = tqdm_class
    cleanup_legacy_translation_model_residue(cache_root, remove_legacy_cache=True)
    last_error: Exception | None = None
    for attempt in range(1, TRANSLATION_MODEL_DOWNLOAD_ATTEMPTS + 1):
        try:
            snapshot_path = Path(snapshot_download(**kwargs))
            model_file = snapshot_path / profile["model_file"]
            if not model_file.is_file():
                raise RuntimeError(f"Downloaded snapshot does not contain {profile['model_file']}")
            return model_file
        except Exception as error:
            last_error = error
            if attempt >= TRANSLATION_MODEL_DOWNLOAD_ATTEMPTS or not is_retryable_translation_model_download_error(error):
                break
            time.sleep(TRANSLATION_MODEL_DOWNLOAD_RETRY_DELAY_SECONDS * attempt)
    raise RuntimeError(normalize_translation_model_download_error(last_error or "unknown download error")) from last_error


def build_translation_model_download_failure_detail(error: Exception | str) -> str:
    text = str(error or "").strip()
    if (
        text in {DOWNLOAD_INTERRUPTED_DETAIL_CODE, DOWNLOAD_FAILED_DETAIL_CODE}
        or text.startswith(f"{DOWNLOAD_FAILED_DETAIL_CODE}:")
    ):
        return text
    return normalize_translation_model_download_error(error)


def resolve_llama_server_runtime(runtime_profile: str = STANDARD_TRANSLATION_PROFILE) -> dict[str, str]:
    env_names = HYMT_LLAMA_SERVER_PATH_ENVS if runtime_profile == STQ_TRANSLATION_PROFILE else LLAMA_SERVER_PATH_ENVS
    for env_name in env_names:
        candidate = str(os.environ.get(env_name, "") or "").strip()
        if candidate and Path(candidate).is_file():
            return {
                "path": candidate,
                "source": "bundled" if env_name in {BUNDLED_LLAMA_SERVER_PATH_ENV, BUNDLED_HYMT_LLAMA_SERVER_PATH_ENV} else "configured",
            }
    if runtime_profile == STQ_TRANSLATION_PROFILE:
        return {
            "path": "",
            "source": "",
        }
    path_candidate = shutil.which("llama-server") or ""
    if path_candidate:
        return {
            "path": path_candidate,
            "source": "path",
        }
    return {
        "path": "",
        "source": "",
    }


def resolve_llama_server_path() -> str:
    return resolve_llama_server_runtime(STANDARD_TRANSLATION_PROFILE)["path"]


def get_available_runtime_info(runtime_profile: str = STANDARD_TRANSLATION_PROFILE) -> dict:
    runtime_profile = normalize_translation_profile(runtime_profile)
    runtime = resolve_llama_server_runtime(runtime_profile)
    stq_runtime = resolve_llama_server_runtime(STQ_TRANSLATION_PROFILE)
    standard_runtime = resolve_llama_server_runtime(STANDARD_TRANSLATION_PROFILE)
    if runtime["path"]:
        return {
            "runtime_available": True,
            "runtime_path": runtime["path"],
            "runtime_source": runtime["source"],
            "runtime_kind_available": "llama-server",
            "stq_runtime_available": bool(stq_runtime["path"]),
            "stq_runtime_path": stq_runtime["path"],
            "standard_runtime_available": bool(standard_runtime["path"]),
            "standard_runtime_path": standard_runtime["path"],
        }
    if runtime_profile == STANDARD_TRANSLATION_PROFILE and has_llama_cpp_python_server():
        return {
            "runtime_available": True,
            "runtime_path": sys.executable,
            "runtime_source": "python",
            "runtime_kind_available": "llama-cpp-python",
            "stq_runtime_available": bool(stq_runtime["path"]),
            "stq_runtime_path": stq_runtime["path"],
            "standard_runtime_available": True,
            "standard_runtime_path": standard_runtime["path"] or sys.executable,
        }
    return {
        "runtime_available": False,
        "runtime_path": "",
        "runtime_source": "",
        "runtime_kind_available": "",
        "stq_runtime_available": bool(stq_runtime["path"]),
        "stq_runtime_path": stq_runtime["path"],
        "standard_runtime_available": bool(standard_runtime["path"]) or has_llama_cpp_python_server(),
        "standard_runtime_path": standard_runtime["path"] or (sys.executable if has_llama_cpp_python_server() else ""),
    }


def has_llama_cpp_python_server() -> bool:
    try:
        return importlib.util.find_spec("llama_cpp.server") is not None
    except ModuleNotFoundError:
        return False


def resolve_llama_server_port() -> int:
    try:
        port = int(str(os.environ.get(LLAMA_SERVER_PORT_ENV, "") or "").strip())
    except ValueError:
        port = DEFAULT_LLAMA_SERVER_PORT
    return max(1024, min(65535, port or DEFAULT_LLAMA_SERVER_PORT))


def wait_for_local_server(
    url: str,
    timeout_seconds: float = 60.0,
    process: subprocess.Popen | None = None,
    log_path: Path | None = None,
) -> None:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        if process is not None and process.poll() is not None:
            log_tail = read_runtime_log_tail(log_path)
            raise RuntimeError(build_runtime_failure_detail(f"process exited with code {process.returncode}", log_tail))
        try:
            response = httpx.get(f"{url}/v1/models", timeout=1.2)
            if response.status_code < 500:
                return
        except Exception as error:
            last_error = error
        time.sleep(0.25)
    log_tail = read_runtime_log_tail(log_path)
    raise RuntimeError(build_runtime_failure_detail(last_error or "timeout", log_tail))


def get_runtime_model_identifiers(url: str, timeout_seconds: float = 1.2) -> set[str]:
    try:
        response = httpx.get(f"{url.rstrip('/')}/v1/models", timeout=timeout_seconds)
        response.raise_for_status()
        data = response.json()
    except Exception:
        return set()

    identifiers: set[str] = set()
    for key in ("data", "models"):
        values = data.get(key) if isinstance(data, dict) else []
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, dict):
                continue
            for field in ("id", "name", "model"):
                value = str(item.get(field) or "").strip()
                if value:
                    identifiers.add(value)
    return identifiers


def is_runtime_serving_translation_model(url: str, model_file: Path) -> bool:
    expected_names = {model_file.name, model_file.stem}
    identifiers = get_runtime_model_identifiers(url)
    return any(
        identifier in expected_names or any(expected in identifier for expected in expected_names)
        for identifier in identifiers
    )


def unload_translation_model() -> dict:
    global _runtime_process, _runtime_url, _runtime_kind, _runtime_profile
    process = _runtime_process
    _runtime_process = None
    _runtime_url = ""
    _runtime_kind = ""
    _runtime_profile = STANDARD_TRANSLATION_PROFILE
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    set_translation_model_state("idle", "Local translation model unloaded")
    return get_translation_model_status()


def build_load_candidates() -> list[tuple[str, Path]]:
    candidates: list[tuple[str, Path]] = []
    stq_runtime = resolve_llama_server_runtime(STQ_TRANSLATION_PROFILE)
    standard_runtime = resolve_llama_server_runtime(STANDARD_TRANSLATION_PROFILE)
    stq_file = find_cached_translation_model_file(profile=STQ_TRANSLATION_PROFILE)
    standard_file = find_cached_translation_model_file(profile=STANDARD_TRANSLATION_PROFILE)
    if stq_file and stq_runtime["path"]:
        candidates.append((STQ_TRANSLATION_PROFILE, stq_file))
    if standard_file and (standard_runtime["path"] or has_llama_cpp_python_server()):
        candidates.append((STANDARD_TRANSLATION_PROFILE, standard_file))
    return candidates


def create_runtime_args(profile_id: str, model_file: Path) -> tuple[list[str], str, str | None]:
    profile_id = normalize_translation_profile(profile_id)
    port = resolve_llama_server_port()
    thread_count = str(max(2, min(8, os.cpu_count() or 4)))
    if profile_id == STQ_TRANSLATION_PROFILE:
        runtime = resolve_llama_server_runtime(STQ_TRANSLATION_PROFILE)
        if not runtime["path"]:
            raise RuntimeError("Hy-MT STQ runtime is missing")
        return ([
            runtime["path"],
            "--model",
            str(model_file),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--ctx-size",
            "4096",
            "--threads",
            thread_count,
            "--jinja",
            "--cache-prompt",
            "--no-webui",
        ], "llama-server-stq", runtime["path"])

    runtime = resolve_llama_server_runtime(STANDARD_TRANSLATION_PROFILE)
    if runtime["path"]:
        return ([
            runtime["path"],
            "--model",
            str(model_file),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--ctx-size",
            "4096",
            "--threads",
            thread_count,
            "--jinja",
            "--cache-prompt",
            "--no-webui",
        ], "llama-server", runtime["path"])
    if has_llama_cpp_python_server():
        return ([
            sys.executable,
            "-m",
            "llama_cpp.server",
            "--model",
            str(model_file),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--n_ctx",
            "4096",
            "--n_threads",
            thread_count,
        ], "llama-cpp-python", None)
    raise RuntimeError(RUNTIME_MISSING_DETAIL)


def start_translation_runtime(profile_id: str, model_file: Path) -> dict:
    global _runtime_process, _runtime_url, _runtime_kind, _runtime_profile
    port = resolve_llama_server_port()
    url = f"http://127.0.0.1:{port}"
    args, runtime_kind, runtime_path = create_runtime_args(profile_id, model_file)

    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            if is_runtime_serving_translation_model(url, model_file):
                run_translation_model_self_test(url, get_translation_profile(profile_id)["model_id"])
                _runtime_process = None
                _runtime_url = url
                _runtime_kind = "llama-server-existing"
                _runtime_profile = normalize_translation_profile(profile_id)
                set_translation_model_state("ready", "Local translation model attached to existing llama-server")
                return get_translation_model_status()
            raise RuntimeError(f"Port {port} is already in use")
    except OSError:
        pass

    log_path = get_runtime_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_file = log_path.open("w", encoding="utf-8")
    try:
        _runtime_process = subprocess.Popen(
            args,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            env=os.environ.copy(),
            cwd=str(Path(runtime_path).parent) if runtime_path else None,
        )
    finally:
        log_file.close()
    _runtime_url = url
    _runtime_kind = runtime_kind
    _runtime_profile = normalize_translation_profile(profile_id)
    wait_for_local_server(url, process=_runtime_process, log_path=log_path)
    run_translation_model_self_test(url, get_translation_profile(profile_id)["model_id"])
    set_translation_model_state("ready", f"Local translation model loaded with {runtime_kind}")
    return get_translation_model_status()


def load_translation_model() -> dict:
    global _runtime_url, _runtime_kind, _runtime_profile
    external_url = str(os.environ.get(LLAMA_SERVER_URL_ENV, "") or "").strip().rstrip("/")
    if external_url:
        _runtime_url = external_url
        _runtime_kind = "external"
        _runtime_profile = STANDARD_TRANSLATION_PROFILE
        wait_for_local_server(external_url, timeout_seconds=5.0)
        run_translation_model_self_test(external_url, get_translation_profile(STANDARD_TRANSLATION_PROFILE)["model_id"])
        set_translation_model_state("ready", "Using external local translation runtime")
        return get_translation_model_status()

    candidates = build_load_candidates()
    if not candidates:
        if get_cached_translation_profiles():
            set_translation_model_state("runtime_missing", RUNTIME_MISSING_DETAIL)
            return get_translation_model_status()
        set_translation_model_state("failed", "Local translation model is not downloaded")
        return get_translation_model_status()

    if is_runtime_process_alive() and _runtime_url:
        set_translation_model_state("ready", "Local translation model is already loaded")
        return get_translation_model_status()

    last_error: Exception | None = None
    for profile_id, model_file in candidates:
        try:
            return start_translation_runtime(profile_id, model_file)
        except Exception as error:
            last_error = error
            detail = build_runtime_failure_detail(error, read_runtime_log_tail(get_runtime_log_path()))
            unload_translation_model()
            if profile_id == STQ_TRANSLATION_PROFILE and len(candidates) > 1:
                set_translation_model_state("idle", f"STQ runtime failed, falling back to stable model: {detail}")
                continue
            if isinstance(error, TranslationModelSelfTestError):
                set_translation_model_state("failed_self_test", str(error))
                raise RuntimeError(str(error)) from error
            set_translation_model_state("failed", detail)
            raise RuntimeError(detail) from error
    detail = build_runtime_failure_detail(last_error or "unknown error", read_runtime_log_tail(get_runtime_log_path()))
    set_translation_model_state("failed", detail)
    raise RuntimeError(detail) from last_error


def build_local_translation_messages(
    raw_text: str,
    target_language_name: str,
    target_language_id: str,
    previous_sentences: list[str] | None = None,
    previous_context_pairs: list[dict] | None = None,
) -> list[dict]:
    previous_sentences = previous_sentences or []
    previous_context_pairs = previous_context_pairs or []
    pair_lines = "\n".join(
        f"- Source: {str(item.get('source') or '').strip()} | Translation: {str(item.get('translation') or '').strip()}"
        for item in previous_context_pairs[-2:]
        if isinstance(item, dict)
    )
    context_lines = "\n".join(str(item or "").strip() for item in previous_sentences[-2:] if str(item or "").strip())
    context_block = ""
    if context_lines or pair_lines:
        context_block = (
            "Use the following context only for terminology, names, and pronouns. "
            "Do not translate or repeat this context:\n"
            f"{context_lines or '(no previous sentence context)'}\n"
            f"{pair_lines or '(no previous translation context)'}\n\n"
        )
    user_prompt = (
        f"{context_block}"
        f"Translate the following text into {target_language_name} ({target_language_id}). "
        "Note that you should only output the translated result without any additional explanation, "
        "labels, markdown, emoji, or repeated historical sentences:\n\n"
        f"{raw_text}"
    )
    return [{"role": "user", "content": user_prompt}]


def normalize_local_translation_output(value: object) -> str:
    text = str(value or "").strip()
    text = text.strip("` \n\t")
    return text


def is_invalid_local_translation_output(text: str, source_text: str = "") -> bool:
    normalized = normalize_local_translation_output(text)
    if not normalized:
        return True
    compact = normalized.replace(" ", "")
    if compact and compact.count("?") / max(1, len(compact)) >= 0.35:
        return True
    if len(compact) >= 16:
        repeated_question_groups = compact.count("???")
        if repeated_question_groups >= 2:
            return True
    source_compact = str(source_text or "").strip().replace(" ", "")
    if source_compact and compact == source_compact:
        return True
    return False


def extract_chat_completion_text(data: dict) -> str:
    choices = data.get("choices", []) if isinstance(data, dict) else []
    if not choices or not isinstance(choices, list):
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else {}
    return normalize_local_translation_output(message.get("content") if isinstance(message, dict) else "")


def build_local_translation_payload(
    *,
    model_id: str,
    raw_text: str,
    target_language_id: str,
    target_language_name: str,
    previous_sentences: list[str] | None = None,
    previous_context_pairs: list[dict] | None = None,
    max_tokens: int = 256,
) -> dict:
    return {
        "model": model_id,
        "messages": build_local_translation_messages(
            raw_text=raw_text,
            target_language_name=target_language_name,
            target_language_id=target_language_id,
            previous_sentences=previous_sentences,
            previous_context_pairs=previous_context_pairs,
        ),
        **LOCAL_TRANSLATION_RECOMMENDED_SAMPLING,
        "max_tokens": max_tokens,
        "stream": False,
    }


def call_local_translation_api_sync(
    runtime_url: str,
    payload: dict,
    timeout_seconds: float = LOCAL_TRANSLATION_TIMEOUT_SECONDS,
) -> str:
    with httpx.Client(timeout=timeout_seconds) as client:
        response = client.post(f"{runtime_url.rstrip('/')}/v1/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
    return extract_chat_completion_text(data)


async def call_local_translation_api_async(
    runtime_url: str,
    payload: dict,
    timeout_seconds: float = LOCAL_TRANSLATION_TIMEOUT_SECONDS,
) -> str:
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(f"{runtime_url.rstrip('/')}/v1/chat/completions", json=payload)
        response.raise_for_status()
        data = response.json()
    return extract_chat_completion_text(data)


def run_translation_model_self_test(runtime_url: str, model_id: str) -> None:
    source_text = "今天天气很好。"
    payload = build_local_translation_payload(
        model_id=model_id,
        raw_text=source_text,
        target_language_id="en",
        target_language_name="English",
        max_tokens=64,
    )
    text = call_local_translation_api_sync(
        runtime_url,
        payload,
        timeout_seconds=LOCAL_TRANSLATION_SELF_TEST_TIMEOUT_SECONDS,
    )
    lower = text.lower()
    if is_invalid_local_translation_output(text, source_text) or not any(token in lower for token in ("weather", "nice", "good", "fine")):
        raise TranslationModelSelfTestError(f"{SELF_TEST_FAILED_DETAIL_CODE}: {text[:120] or 'empty output'}")


async def translate_with_local_model(
    raw_text: str,
    target_language_id: str,
    target_language_name: str,
    previous_sentences: list[str] | None = None,
    previous_context_pairs: list[dict] | None = None,
    max_tokens: int = 256,
    timeout_seconds: float = LOCAL_TRANSLATION_TIMEOUT_SECONDS,
) -> str:
    if target_language_id not in LOCAL_TRANSLATION_SUPPORTED_TARGETS:
        raise RuntimeError(f"Unsupported local translation target: {target_language_id}")
    status = get_translation_model_status()
    if not status.get("ready"):
        raise RuntimeError(str(status.get("detail") or status.get("status") or "local translation model is not ready"))
    runtime_url = str(status.get("runtime_url") or "").rstrip("/")
    if not runtime_url:
        raise RuntimeError("Local translation runtime URL is empty")

    payload = build_local_translation_payload(
        model_id=str(status.get("model_id") or TRANSLATION_MODEL_ID),
        raw_text=raw_text,
        target_language_id=target_language_id,
        target_language_name=target_language_name,
        previous_sentences=previous_sentences,
        previous_context_pairs=previous_context_pairs,
        max_tokens=max_tokens,
    )
    text = await call_local_translation_api_async(runtime_url, payload, timeout_seconds=timeout_seconds)
    if is_invalid_local_translation_output(text, raw_text):
        raise RuntimeError(f"{SELF_TEST_FAILED_DETAIL_CODE}: invalid local translation output")
    return text
