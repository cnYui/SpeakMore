import os
from pathlib import Path


MODEL_CACHE_DIR_ENV = "TYPELESS_MODEL_CACHE_DIR"
SENSEVOICE_SMALL_MODEL_ID = "sensevoice-small"
SENSEVOICE_SMALL_REPO_ID = "FunAudioLLM/SenseVoiceSmall"
SENSEVOICE_SMALL_REQUIRED_MODEL_FILES = (
    "model.pt",
    "config.yaml",
    "am.mvn",
    "chn_jpn_yue_eng_ko_spectok.bpe.model",
)
SUPPORTED_ASR_MODEL_IDS = (SENSEVOICE_SMALL_MODEL_ID,)
ASR_MODEL_REPO_IDS = {
    SENSEVOICE_SMALL_MODEL_ID: SENSEVOICE_SMALL_REPO_ID,
}
ASR_MODEL_REQUIRED_FILES = {
    SENSEVOICE_SMALL_MODEL_ID: SENSEVOICE_SMALL_REQUIRED_MODEL_FILES,
}
ASR_MODEL_EXPLICIT_DIR_ENVS = {
    SENSEVOICE_SMALL_MODEL_ID: "SENSEVOICE_SMALL_MODEL_DIR",
}
DEFAULT_MODEL_ID = SENSEVOICE_SMALL_MODEL_ID
ACTIVE_ASR_MODEL_ID = SENSEVOICE_SMALL_MODEL_ID


def validate_asr_model_id(model_id: str):
    if model_id not in SUPPORTED_ASR_MODEL_IDS:
        raise ValueError(f"未知模型: {model_id}")


def get_active_asr_model_id():
    validate_asr_model_id(ACTIVE_ASR_MODEL_ID)
    return ACTIVE_ASR_MODEL_ID


def get_model_repo_id(model_id: str):
    validate_asr_model_id(model_id)
    return ASR_MODEL_REPO_IDS[model_id]


def get_model_required_files(model_id: str):
    validate_asr_model_id(model_id)
    return ASR_MODEL_REQUIRED_FILES[model_id]


def get_model_explicit_dir_env(model_id: str):
    validate_asr_model_id(model_id)
    return ASR_MODEL_EXPLICIT_DIR_ENVS[model_id]


def get_managed_models_root():
    local_app_data = os.environ.get("LOCALAPPDATA")
    base_dir = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base_dir / "Typeless" / "models"


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
