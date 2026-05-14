import os
from pathlib import Path

from dotenv import load_dotenv

_ENV_FILE_PATH = Path(__file__).with_name(".env")
_DEFAULT_CORS_ALLOWED_ORIGINS = ["null", "http://127.0.0.1:5173", "http://localhost:5173"]
_env_loaded = False


def get_env_file_path() -> Path:
    return _ENV_FILE_PATH


def load_server_env() -> None:
    global _env_loaded
    if _env_loaded:
        return
    load_dotenv(_ENV_FILE_PATH)
    _env_loaded = True


def get_server_host() -> str:
    return os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1"


def get_server_port() -> int:
    return int(os.getenv("PORT", "8000").strip() or "8000")


def get_cors_allowed_origins() -> list[str]:
    configured = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
    if not configured:
        return _DEFAULT_CORS_ALLOWED_ORIGINS.copy()
    return [origin.strip() for origin in configured.split(",") if origin.strip()]
