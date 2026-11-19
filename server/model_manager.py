import json
import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


MODEL_CACHE_DIR_ENV = "TYPELESS_MODEL_CACHE_DIR"
ACTIVE_MODEL_ID_ENV = "SPEAKMORE_ASR_MODEL_ID"

FUNASR_RUNTIME = "funasr"
SHERPA_ONNX_RUNTIME = "sherpa-onnx"

SENSEVOICE_SMALL_MODEL_ID = "sensevoice-small"
SENSEVOICE_SMALL_REPO_ID = "FunAudioLLM/SenseVoiceSmall"
SENSEVOICE_SMALL_REQUIRED_MODEL_FILES = (
    "model.pt",
    "config.yaml",
    "am.mvn",
    "chn_jpn_yue_eng_ko_spectok.bpe.model",
)

# sherpa-onnx 从同一个 SenseVoiceSmall 权重导出的 int8 ONNX 版本，只下载推理需要的文件（约 229 MB）。
SENSEVOICE_SMALL_INT8_MODEL_ID = "sensevoice-small-int8"
SENSEVOICE_SMALL_INT8_REPO_ID = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
SENSEVOICE_SMALL_INT8_MODEL_FILE = "model.int8.onnx"
SENSEVOICE_SMALL_INT8_TOKENS_FILE = "tokens.txt"
SENSEVOICE_SMALL_INT8_REQUIRED_MODEL_FILES = (
    SENSEVOICE_SMALL_INT8_MODEL_FILE,
    SENSEVOICE_SMALL_INT8_TOKENS_FILE,
)


@dataclass(frozen=True)
class AsrModelSpec:
    model_id: str
    repo_id: str
    runtime: str
    required_files: tuple[str, ...]
    explicit_dir_env: str
    allow_patterns: tuple[str, ...] | None = None


ASR_MODEL_SPECS: dict[str, AsrModelSpec] = {
    SENSEVOICE_SMALL_MODEL_ID: AsrModelSpec(
        model_id=SENSEVOICE_SMALL_MODEL_ID,
        repo_id=SENSEVOICE_SMALL_REPO_ID,
        runtime=FUNASR_RUNTIME,
        required_files=SENSEVOICE_SMALL_REQUIRED_MODEL_FILES,
        explicit_dir_env="SENSEVOICE_SMALL_MODEL_DIR",
    ),
    SENSEVOICE_SMALL_INT8_MODEL_ID: AsrModelSpec(
        model_id=SENSEVOICE_SMALL_INT8_MODEL_ID,
        repo_id=SENSEVOICE_SMALL_INT8_REPO_ID,
        runtime=SHERPA_ONNX_RUNTIME,
        required_files=SENSEVOICE_SMALL_INT8_REQUIRED_MODEL_FILES,
        explicit_dir_env="SENSEVOICE_SMALL_INT8_MODEL_DIR",
        allow_patterns=(SENSEVOICE_SMALL_INT8_MODEL_FILE, SENSEVOICE_SMALL_INT8_TOKENS_FILE, "LICENSE"),
    ),
}
SUPPORTED_ASR_MODEL_IDS = tuple(ASR_MODEL_SPECS)
ASR_MODEL_REPO_IDS = {model_id: spec.repo_id for model_id, spec in ASR_MODEL_SPECS.items()}
ASR_MODEL_REQUIRED_FILES = {model_id: spec.required_files for model_id, spec in ASR_MODEL_SPECS.items()}
ASR_MODEL_EXPLICIT_DIR_ENVS = {model_id: spec.explicit_dir_env for model_id, spec in ASR_MODEL_SPECS.items()}
DEFAULT_MODEL_ID = SENSEVOICE_SMALL_MODEL_ID

# 运行中由 /model/status、/model/download 按 Electron 设置切换；为空时读 SPEAKMORE_ASR_MODEL_ID，再回退默认模型。
_active_model_id: str | None = None


SHARED_ASR_MODELS_FILE = "asr-models.json"


@lru_cache(maxsize=1)
def load_shared_asr_model_metadata() -> dict[str, dict]:
    """读 shared/asr-models.json 里给界面用的名称和下载体积；开发态在仓库根目录，打包态在 _MEIPASS/shared。"""
    here = Path(__file__).resolve().parent
    for candidate in (here / "shared" / SHARED_ASR_MODELS_FILE, here.parent / "shared" / SHARED_ASR_MODELS_FILE):
        try:
            with candidate.open("r", encoding="utf-8") as file:
                items = json.load(file)
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(items, list):
            return {item["id"]: item for item in items if isinstance(item, dict) and isinstance(item.get("id"), str)}
    return {}


def get_model_display_metadata(model_id: str) -> dict:
    spec = get_model_spec(model_id)
    shared = load_shared_asr_model_metadata().get(model_id, {})
    size_bytes = shared.get("sizeBytes")
    return {
        "label": str(shared.get("label") or spec.model_id),
        "variant": str(shared.get("variant") or ""),
        "runtime": spec.runtime,
        "size_bytes": int(size_bytes) if isinstance(size_bytes, (int, float)) else 0,
    }


def validate_asr_model_id(model_id: str):
    if model_id not in SUPPORTED_ASR_MODEL_IDS:
        raise ValueError(f"未知模型: {model_id}")


def normalize_asr_model_id(model_id: str | None) -> str:
    candidate = str(model_id or "").strip()
    return candidate if candidate in SUPPORTED_ASR_MODEL_IDS else ""


def get_active_asr_model_id():
    if _active_model_id:
        return _active_model_id
    return normalize_asr_model_id(os.environ.get(ACTIVE_MODEL_ID_ENV)) or DEFAULT_MODEL_ID


def set_active_asr_model_id(model_id: str):
    global _active_model_id
    validate_asr_model_id(model_id)
    _active_model_id = model_id
    return model_id


def reset_active_asr_model_id():
    global _active_model_id
    _active_model_id = None


def get_model_spec(model_id: str) -> AsrModelSpec:
    validate_asr_model_id(model_id)
    return ASR_MODEL_SPECS[model_id]


def get_model_repo_id(model_id: str):
    return get_model_spec(model_id).repo_id


def get_model_runtime(model_id: str):
    return get_model_spec(model_id).runtime


def get_model_required_files(model_id: str):
    return get_model_spec(model_id).required_files


def get_model_explicit_dir_env(model_id: str):
    return get_model_spec(model_id).explicit_dir_env


def get_model_allow_patterns(model_id: str):
    patterns = get_model_spec(model_id).allow_patterns
    return list(patterns) if patterns else None


def get_managed_models_root():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "Typeless" / "models"
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SpeakMore" / "models"
    else:
        return Path.home() / "AppData" / "Local" / "Typeless" / "models"


def normalize_model_cache_dir(cache_dir: str | None) -> str:
    return str(Path(cache_dir).expanduser()) if isinstance(cache_dir, str) and cache_dir.strip() else ""


def configure_model_cache_dir(cache_dir: str | None):
    normalized = normalize_model_cache_dir(cache_dir)
    if normalized:
        os.environ[MODEL_CACHE_DIR_ENV] = normalized
    else:
        os.environ.pop(MODEL_CACHE_DIR_ENV, None)
    return get_managed_model_cache_root()


def get_managed_model_cache_root(model_id: str = SENSEVOICE_SMALL_MODEL_ID):
    validate_asr_model_id(model_id)
    configured_cache_dir = normalize_model_cache_dir(os.environ.get(MODEL_CACHE_DIR_ENV))
    if configured_cache_dir:
        return Path(configured_cache_dir)
    return get_managed_models_root() / "funasr"


def get_hf_cache_root() -> Path:
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home) / "hub"
    user_profile = Path(os.getenv("USERPROFILE") or Path.home())
    return user_profile / ".cache" / "huggingface" / "hub"


def repo_cache_dir_name(repo_id: str):
    return f"models--{repo_id.replace('/', '--')}"


def is_valid_model_snapshot(path: Path, model_id: str = SENSEVOICE_SMALL_MODEL_ID):
    return path.is_dir() and all((path / relative_path).is_file() for relative_path in get_model_required_files(model_id))


def find_cached_model_snapshot(model_id: str = SENSEVOICE_SMALL_MODEL_ID, cache_root=None):
    root = Path(cache_root) if cache_root is not None else get_managed_model_cache_root(model_id)
    snapshots_root = root / repo_cache_dir_name(get_model_repo_id(model_id)) / "snapshots"
    try:
        candidates = list(snapshots_root.iterdir())
    except (FileNotFoundError, OSError):
        return None

    sortable_snapshots = []
    for snapshot in candidates:
        try:
            if not snapshot.is_dir():
                continue
            sortable_snapshots.append((snapshot.stat().st_mtime, snapshot))
        except OSError:
            continue

    sortable_snapshots.sort(key=lambda item: item[0], reverse=True)
    for _, snapshot in sortable_snapshots:
        if is_valid_model_snapshot(snapshot, model_id):
            return snapshot
    return None


def is_model_cached(model_id: str) -> bool:
    """模型是否已在本机可用：显式目录、用户/默认缓存目录或 Hugging Face 缓存任一处有完整文件即可。"""
    explicit_dir = os.getenv(get_model_explicit_dir_env(model_id), "").strip()
    if explicit_dir and is_valid_model_snapshot(Path(explicit_dir).expanduser(), model_id):
        return True
    if find_cached_model_snapshot(model_id) is not None:
        return True
    return find_cached_model_snapshot(model_id, cache_root=get_hf_cache_root()) is not None
