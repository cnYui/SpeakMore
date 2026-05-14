"""ASR 模块 - 唯一使用 faster-whisper base 进行语音转文字"""

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DEFAULT_WHISPER_MODEL = "base"
BASE_MODEL_REPO_DIR = "models--Systran--faster-whisper-base"
DIR_SOURCE = "dir"
MANAGED_CACHE_SOURCE = "managed-cache"
HF_CACHE_SOURCE = "hf-cache"
DOWNLOAD_SOURCE = "download"
REQUIRED_MODEL_FILES = ("model.bin", "config.json")


@dataclass(frozen=True)
class WhisperModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None


_model = None


def get_whisper_model_name() -> str:
    configured_model = os.getenv("WHISPER_MODEL", "").strip() or DEFAULT_WHISPER_MODEL
    if configured_model != DEFAULT_WHISPER_MODEL:
        raise ValueError(
            f"当前项目仅支持 faster-whisper 模型 {DEFAULT_WHISPER_MODEL}，收到: {configured_model}"
        )
    return configured_model


def get_managed_whisper_cache_root() -> Path:
    local_app_data = Path(os.getenv("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    return local_app_data / "Typeless" / "models" / "faster-whisper"


def get_hf_cache_root() -> Path:
    user_profile = Path(os.getenv("USERPROFILE") or Path.home())
    return user_profile / ".cache" / "huggingface" / "hub"


def is_valid_whisper_model_dir(path: Path) -> bool:
    return path.is_dir() and all((path / name).exists() for name in REQUIRED_MODEL_FILES)


def find_cached_whisper_snapshot(cache_root: Path) -> Path | None:
    snapshots_root = cache_root / BASE_MODEL_REPO_DIR / "snapshots"
    if not snapshots_root.exists():
        return None

    candidates = sorted(
        (candidate for candidate in snapshots_root.iterdir() if candidate.is_dir()),
        key=lambda candidate: candidate.stat().st_mtime,
        reverse=True,
    )

    for candidate in candidates:
        if is_valid_whisper_model_dir(candidate):
            return candidate

    return None


def resolve_whisper_model_source() -> WhisperModelSource:
    get_whisper_model_name()

    configured_dir = os.getenv("WHISPER_MODEL_DIR", "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_whisper_model_dir(explicit_dir):
            raise ValueError(
                "WHISPER_MODEL_DIR 必须指向包含 model.bin 和 config.json 的 faster-whisper 模型目录"
            )
        return WhisperModelSource(kind=DIR_SOURCE, model_ref=str(explicit_dir))

    managed_root = get_managed_whisper_cache_root()
    managed_snapshot = find_cached_whisper_snapshot(managed_root)
    if managed_snapshot:
        return WhisperModelSource(kind=MANAGED_CACHE_SOURCE, model_ref=str(managed_snapshot))

    hf_snapshot = find_cached_whisper_snapshot(get_hf_cache_root())
    if hf_snapshot:
        return WhisperModelSource(kind=HF_CACHE_SOURCE, model_ref=str(hf_snapshot))

    return WhisperModelSource(
        kind=DOWNLOAD_SOURCE,
        model_ref=DEFAULT_WHISPER_MODEL,
        download_root=str(managed_root),
    )


def build_whisper_model(source: WhisperModelSource):
    from faster_whisper import WhisperModel

    load_kwargs = {"device": "cpu", "compute_type": "int8"}

    if source.kind == DOWNLOAD_SOURCE:
        print(f"[ASR] 未命中本地 faster-whisper base，首次下载到: {source.download_root}")
        return WhisperModel(
            source.model_ref,
            download_root=source.download_root,
            **load_kwargs,
        )

    print(f"[ASR] 从 {source.kind} 加载 faster-whisper base: {source.model_ref}")
    return WhisperModel(source.model_ref, **load_kwargs)


def _get_model():
    """懒加载 Whisper 模型（单例）"""
    global _model
    if _model is not None:
        return _model

    source = resolve_whisper_model_source()

    try:
        _model = build_whisper_model(source)
    except Exception as error:
        if source.kind == DOWNLOAD_SOURCE:
            raise RuntimeError(
                f"faster-whisper 模型 {source.model_ref} 下载或加载失败，目标目录: {source.download_root}"
            ) from error
        raise RuntimeError(
            f"faster-whisper 模型加载失败，来源: {source.kind}，目标: {source.model_ref}"
        ) from error

    print(f"[ASR] 模型加载完成，来源: {source.kind}")
    return _model


async def transcribe_audio(audio_path: str, language: str | None = None) -> str:
    """转写音频文件为文本

    Args:
        audio_path: 音频文件路径（支持 wav, ogg, mp3 等）
        language: 指定语言代码（如 "zh", "en"），None 则自动检测

    Returns:
        转写后的文本
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _transcribe_sync, audio_path, language)


def _transcribe_sync(audio_path: str, language: str | None = None) -> str:
    """同步转写（在线程池中执行）"""
    model = _get_model()

    segments, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    text_parts = []
    for segment in segments:
        text_parts.append(segment.text.strip())

    return " ".join(text_parts)
