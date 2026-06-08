"""ASR 模块 - 负责加载当前后端启用的 FunASR 语音模型。"""

import asyncio
import inspect
import os
import re
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

from download_progress import DownloadProgress, create_hf_tqdm_class
from model_manager import (
    SENSEVOICE_SMALL_MODEL_ID,
    find_cached_model_snapshot,
    get_active_asr_model_id,
    get_hf_cache_root as get_model_hf_cache_root,
    get_managed_model_cache_root,
    get_model_explicit_dir_env,
    get_model_repo_id,
    get_model_required_files,
)
from runtime_config import load_server_env

load_server_env()

DIR_SOURCE = "dir"
MANAGED_CACHE_SOURCE = "managed-cache"
HF_CACHE_SOURCE = "hf-cache"
DOWNLOAD_SOURCE = "download"


@dataclass(frozen=True)
class StreamingAsrModelSource:
    kind: str
    model_ref: str
    download_root: str | None = None
    model_id: str = SENSEVOICE_SMALL_MODEL_ID
    repo_id: str = "FunAudioLLM/SenseVoiceSmall"


@dataclass
class StreamingAsrRuntime:
    model: Any
    model_id: str = SENSEVOICE_SMALL_MODEL_ID
    device: str = "cpu"
    requested_device: str = "cpu"
    device_source: str = "auto"
    device_fallback_reason: str | None = None
    chunk_size: list[int] | None = None
    encoder_chunk_look_back: int | None = None
    decoder_chunk_look_back: int | None = None
    chunk_ms: int = 600
    accumulate_audio: bool = False
    keep_full_audio_for_final: bool = True
    realtime_endpointing: bool = False
    pass_cache: bool = True
    pass_is_final: bool = True
    generate_options: dict[str, Any] = field(default_factory=dict)
    postprocess: str | None = None
    asr_engine: str = "sensevoice_endpoint"
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)


@dataclass(frozen=True)
class StreamingAsrResult:
    text: str
    segment_text: str = ""
    stable_text: str = ""
    partial_text: str = ""
    stable: bool = False
    is_partial: bool = True
    utterance_index: int = 0
    asr_latency_ms: int = 0
    asr_backlog_ms: int = 0
    asr_rtf: float = 0.0
    endpoint_reason: str = ""
    asr_window_ms: int = 0
    asr_full_segment_ms: int = 0
    hypothesis_id: str = ""
    revision_id: str = ""
    utterance_id: str = ""
    asr_engine: str = ""
    source_profile: str = ""


@dataclass(frozen=True)
class MeetingEndpointEvent:
    pcm: bytes
    stable: bool
    utterance_index: int
    reason: str
    asr_window_ms: int
    full_segment_ms: int = 0


@dataclass(frozen=True)
class FunasrDeviceSelection:
    device: str
    requested_device: str
    source: str
    fallback_reason: str | None = None


_model: StreamingAsrRuntime | None = None
_model_lock = threading.Lock()
PCM16_STREAM_CHUNK_BYTES = 64 * 1024
MEETING_ENDPOINT_FRAME_MS = 30
MEETING_ENDPOINT_PREROLL_MS = 180
MEETING_ENDPOINT_MIN_SPEECH_MS = 240
MEETING_ENDPOINT_END_SILENCE_MS = 520
MEETING_ENDPOINT_PARTIAL_MS = 480
MEETING_ENDPOINT_PARTIAL_WINDOW_MS = 2400
MEETING_ENDPOINT_MAX_SEGMENT_MS = 10000
MEETING_ENDPOINT_MIN_RMS = 0.008
MEETING_ENDPOINT_PEAK_TRIGGER = 0.075


def get_hf_cache_root() -> Path:
    return get_model_hf_cache_root()


def is_cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def is_mps_available() -> bool:
    try:
        import torch

        return bool(torch.backends.mps.is_available())
    except Exception:
        return False


def normalize_funasr_device(value: str | None) -> str:
    return str(value or "").strip().lower()


def resolve_funasr_device_selection() -> FunasrDeviceSelection:
    configured_device = os.environ.get("FUNASR_DEVICE", "").strip()
    normalized_device = normalize_funasr_device(configured_device)

    if normalized_device and normalized_device != "auto":
        if normalized_device.startswith("cuda") and not is_cuda_available():
            return FunasrDeviceSelection(
                device="cpu",
                requested_device=configured_device,
                source="explicit",
                fallback_reason="cuda_unavailable",
            )
        if normalized_device == "mps" and not is_mps_available():
            return FunasrDeviceSelection(
                device="cpu",
                requested_device=configured_device,
                source="explicit",
                fallback_reason="mps_unavailable",
            )
        return FunasrDeviceSelection(device=configured_device, requested_device=configured_device, source="explicit")

    requested_device = "auto" if normalized_device == "auto" else "default"
    if is_cuda_available():
        return FunasrDeviceSelection(device="cuda:0", requested_device=requested_device, source="auto")
    if normalized_device == "auto" and is_mps_available():
        return FunasrDeviceSelection(device="mps", requested_device=requested_device, source="auto")
    return FunasrDeviceSelection(
        device="cpu",
        requested_device=requested_device,
        source="auto",
        fallback_reason="accelerator_unavailable" if normalized_device == "auto" else None,
    )


def resolve_funasr_device() -> str:
    return resolve_funasr_device_selection().device


def get_asr_runtime_device_status() -> dict[str, str | None]:
    if isinstance(_model, StreamingAsrRuntime):
        return {
            "device": _model.device,
            "requested_device": _model.requested_device,
            "device_source": _model.device_source,
            "fallback_reason": _model.device_fallback_reason,
        }

    selection = resolve_funasr_device_selection()
    return {
        "device": selection.device,
        "requested_device": selection.requested_device,
        "device_source": selection.source,
        "fallback_reason": selection.fallback_reason,
    }


def is_valid_model_dir(path: Path, required_files: tuple[str, ...]) -> bool:
    return path.is_dir() and all((path / name).is_file() for name in required_files)


def is_valid_streaming_model_dir(path: Path, model_id: str) -> bool:
    return is_valid_model_dir(path, get_model_required_files(model_id))


def get_candidate_streaming_model_sources(
    model_id: str | None = None,
) -> list[StreamingAsrModelSource]:
    selected_model_id = get_active_asr_model_id() if model_id is None else model_id
    repo_id = get_model_repo_id(selected_model_id)
    explicit_dir_env = get_model_explicit_dir_env(selected_model_id)

    configured_dir = os.getenv(explicit_dir_env, "").strip()
    if configured_dir:
        explicit_dir = Path(configured_dir).expanduser()
        if not is_valid_streaming_model_dir(explicit_dir, selected_model_id):
            raise ValueError(f"{explicit_dir_env} 指向的模型权重不完整")
        return [
            StreamingAsrModelSource(
                kind=DIR_SOURCE,
                model_ref=str(explicit_dir),
                model_id=selected_model_id,
                repo_id=repo_id,
            )
        ]

    sources: list[StreamingAsrModelSource] = []
    managed_root = get_managed_model_cache_root(selected_model_id)
    managed_snapshot = find_cached_model_snapshot(selected_model_id)
    if managed_snapshot:
        sources.append(
            StreamingAsrModelSource(
                kind=MANAGED_CACHE_SOURCE,
                model_ref=str(managed_snapshot),
                model_id=selected_model_id,
                repo_id=repo_id,
            )
        )

    hf_snapshot = find_cached_model_snapshot(selected_model_id, cache_root=get_hf_cache_root())
    if hf_snapshot:
        sources.append(
            StreamingAsrModelSource(
                kind=HF_CACHE_SOURCE,
                model_ref=str(hf_snapshot),
                model_id=selected_model_id,
                repo_id=repo_id,
            )
        )

    sources.append(
        StreamingAsrModelSource(
            kind=DOWNLOAD_SOURCE,
            model_ref=repo_id,
            download_root=str(managed_root),
            model_id=selected_model_id,
            repo_id=repo_id,
        )
    )
    return sources


def resolve_streaming_model_source(model_id: str | None = None) -> StreamingAsrModelSource:
    return get_candidate_streaming_model_sources(model_id)[0]


def resolve_funasr_repo_dir() -> Path | None:
    configured_repo = os.environ.get("FUNASR_REPO_DIR", "").strip()
    candidates = [Path(configured_repo)] if configured_repo else []

    for candidate in candidates:
        if (candidate / "funasr").is_dir():
            return candidate
    return None


def ensure_funasr_repo_import_path() -> None:
    repo_dir = resolve_funasr_repo_dir()
    if repo_dir and str(repo_dir) not in sys.path:
        sys.path.insert(0, str(repo_dir))


def get_auto_model_kwargs(model_id: str) -> dict[str, Any]:
    if model_id == SENSEVOICE_SMALL_MODEL_ID:
        return {"disable_pbar": True}
    return {}


def resolve_model_ref_for_build(
    source: StreamingAsrModelSource,
    download_progress_callback: Callable[[DownloadProgress], None] | None = None,
) -> str:
    if source.kind != DOWNLOAD_SOURCE or not source.download_root:
        return source.model_ref

    from huggingface_hub import snapshot_download

    if not download_progress_callback:
        return snapshot_download(source.model_ref, cache_dir=source.download_root)

    tqdm_class = create_hf_tqdm_class(download_progress_callback)
    return snapshot_download(source.model_ref, cache_dir=source.download_root, tqdm_class=tqdm_class)


def create_streaming_runtime(
    model: Any,
    model_id: str,
    device_selection: FunasrDeviceSelection | None = None,
) -> StreamingAsrRuntime:
    if model_id != SENSEVOICE_SMALL_MODEL_ID:
        raise ValueError(f"未知 streaming ASR 模型: {model_id}")

    selection = device_selection or FunasrDeviceSelection(device="cpu", requested_device="cpu", source="auto")
    return StreamingAsrRuntime(
        model=model,
        model_id=model_id,
        device=selection.device,
        requested_device=selection.requested_device,
        device_source=selection.source,
        device_fallback_reason=selection.fallback_reason,
        chunk_ms=1200,
        accumulate_audio=False,
        keep_full_audio_for_final=True,
        realtime_endpointing=True,
        pass_cache=False,
        pass_is_final=False,
        generate_options={
            "language": "auto",
            "use_itn": True,
            "ban_emo_unk": False,
            "batch_size_s": 60,
        },
        postprocess="rich_transcription",
    )


def create_model_with_device(AutoModel, model_ref: str, model_id: str, device: str):
    return AutoModel(
        model=model_ref,
        hub="hf",
        device=device,
        disable_update=True,
        **get_auto_model_kwargs(model_id),
    )


def build_streaming_asr_model(
    source: StreamingAsrModelSource,
    download_progress_callback: Callable[[DownloadProgress], None] | None = None,
) -> StreamingAsrRuntime:
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    if source.kind != DOWNLOAD_SOURCE:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    ensure_funasr_repo_import_path()
    from funasr import AutoModel

    device_selection = resolve_funasr_device_selection()
    model_ref = resolve_model_ref_for_build(source, download_progress_callback)
    print(f"[ASR] 从 {source.kind} 加载 {source.model_id}: {model_ref}，设备: {device_selection.device}")

    try:
        model = create_model_with_device(AutoModel, model_ref, source.model_id, device_selection.device)
        return create_streaming_runtime(model, source.model_id, device_selection)
    except Exception as error:
        if normalize_funasr_device(device_selection.device) == "cpu":
            raise

        fallback_selection = FunasrDeviceSelection(
            device="cpu",
            requested_device=device_selection.requested_device,
            source=device_selection.source,
            fallback_reason=f"{normalize_funasr_device(device_selection.device)}_initialization_failed: {error}",
        )
        print(f"[ASR] {device_selection.device} 初始化失败，回退 CPU: {error}")
        model = create_model_with_device(AutoModel, model_ref, source.model_id, fallback_selection.device)
        return create_streaming_runtime(model, source.model_id, fallback_selection)


def _load_streaming_asr_model(download_progress_callback: Callable[[DownloadProgress], None] | None = None):
    selected_model_id = get_active_asr_model_id()
    errors: list[str] = []
    for source in get_candidate_streaming_model_sources(selected_model_id):
        try:
            model = build_streaming_asr_model(source, download_progress_callback)
            print(f"[ASR] {selected_model_id} 模型加载完成，来源: {source.kind}")
            return model
        except Exception as error:
            if source.kind == DOWNLOAD_SOURCE:
                errors.append(
                    f"{source.kind}: {source.model_ref} -> 下载或加载失败，目标目录: {source.download_root}: {error}"
                )
            else:
                errors.append(f"{source.kind}: {source.model_ref} -> {error}")

    raise RuntimeError(f"{selected_model_id} 模型加载失败: " + " | ".join(errors))


def preload_asr_model(download_progress_callback: Callable[[DownloadProgress], None] | None = None):
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        if download_progress_callback:
            _model = _load_streaming_asr_model(download_progress_callback)
        else:
            _model = _load_streaming_asr_model()
        return _model


def _get_model():
    return preload_asr_model()


def convert_audio_file_to_pcm16_bytes(source_path: str) -> bytes:
    completed = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "pipe:1",
        ],
        capture_output=True,
        timeout=30,
        check=True,
    )
    return completed.stdout


def iter_audio_file_pcm16_chunks(source_path: str, chunk_bytes: int = PCM16_STREAM_CHUNK_BYTES):
    process = subprocess.Popen(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stderr = b""

    try:
        while True:
            chunk = process.stdout.read(chunk_bytes) if process.stdout else b""
            if not chunk:
                break
            yield chunk
        if process.stderr:
            stderr = process.stderr.read()[-4000:]
        return_code = process.wait(timeout=5)
        if return_code != 0:
            raise subprocess.CalledProcessError(return_code, "ffmpeg", stderr=stderr)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def pcm16_bytes_to_float32(pcm_bytes: bytes):
    import numpy as np

    if len(pcm_bytes) % 2 == 1:
        pcm_bytes = pcm_bytes[:-1]
    if not pcm_bytes:
        return np.asarray([], dtype="float32")
    return np.frombuffer(pcm_bytes, dtype="<i2").astype("float32") / 32768.0


def calculate_pcm16_frame_level(pcm_bytes: bytes) -> tuple[float, float]:
    if len(pcm_bytes) < 2:
        return 0.0, 0.0
    sample_count = len(pcm_bytes) // 2
    total = 0.0
    peak = 0.0
    for offset in range(0, sample_count * 2, 2):
        sample = int.from_bytes(pcm_bytes[offset : offset + 2], byteorder="little", signed=True) / 32768.0
        absolute = abs(sample)
        peak = max(peak, absolute)
        total += sample * sample
    return (total / max(1, sample_count)) ** 0.5, peak


class MeetingEndpointDetector:
    def __init__(
        self,
        sample_rate: int = 16000,
        frame_ms: int = MEETING_ENDPOINT_FRAME_MS,
        preroll_ms: int = MEETING_ENDPOINT_PREROLL_MS,
        min_speech_ms: int = MEETING_ENDPOINT_MIN_SPEECH_MS,
        end_silence_ms: int = MEETING_ENDPOINT_END_SILENCE_MS,
        partial_ms: int = MEETING_ENDPOINT_PARTIAL_MS,
        partial_window_ms: int = MEETING_ENDPOINT_PARTIAL_WINDOW_MS,
        max_segment_ms: int = MEETING_ENDPOINT_MAX_SEGMENT_MS,
    ) -> None:
        self.sample_rate = max(1, int(sample_rate or 16000))
        self.frame_ms = max(10, int(frame_ms))
        self.frame_bytes = max(2, int(self.sample_rate * self.frame_ms / 1000) * 2)
        self.preroll_frames = max(1, int(preroll_ms / self.frame_ms))
        self.min_speech_ms = max(self.frame_ms, int(min_speech_ms))
        self.end_silence_ms = max(self.frame_ms, int(end_silence_ms))
        self.partial_ms = max(self.frame_ms, int(partial_ms))
        self.partial_window_ms = max(self.partial_ms, int(partial_window_ms))
        self.partial_window_bytes = max(self.frame_bytes, int(self.sample_rate * self.partial_window_ms / 1000) * 2)
        self.max_segment_ms = max(self.partial_ms, int(max_segment_ms))
        self.pending = bytearray()
        self.preroll: deque[bytes] = deque(maxlen=self.preroll_frames)
        self.segment = bytearray()
        self.in_speech = False
        self.segment_ms = 0
        self.voiced_ms = 0
        self.silence_ms = 0
        self.next_partial_ms = self.partial_ms
        self.next_utterance_index = 1
        self.noise_floor = 0.003

    def append_pcm16(self, chunk: bytes) -> list[MeetingEndpointEvent]:
        if not chunk:
            return []
        self.pending.extend(chunk)
        events: list[MeetingEndpointEvent] = []
        while len(self.pending) >= self.frame_bytes:
            frame = bytes(self.pending[: self.frame_bytes])
            del self.pending[: self.frame_bytes]
            event = self._observe_frame(frame)
            if event:
                events.append(event)
        return events

    def finalize(self) -> list[MeetingEndpointEvent]:
        if self.pending:
            remainder = bytes(self.pending)
            self.pending.clear()
            if len(remainder) >= 2:
                event = self._observe_frame(remainder)
                if event:
                    return [event]
        if self.in_speech and self.voiced_ms >= self.min_speech_ms and self.segment:
            return [self._create_event(stable=True, reason="finalize")]
        self.reset_segment()
        return []

    def reset_segment(self) -> None:
        self.segment.clear()
        self.in_speech = False
        self.segment_ms = 0
        self.voiced_ms = 0
        self.silence_ms = 0
        self.next_partial_ms = self.partial_ms

    def _observe_frame(self, frame: bytes) -> MeetingEndpointEvent | None:
        rms, peak = calculate_pcm16_frame_level(frame)
        threshold = max(MEETING_ENDPOINT_MIN_RMS, min(0.04, self.noise_floor * 3.2 + 0.003))
        is_speech = rms >= threshold or peak >= MEETING_ENDPOINT_PEAK_TRIGGER

        if not self.in_speech:
            if not is_speech:
                self.noise_floor = (self.noise_floor * 0.95) + (rms * 0.05)
                self.preroll.append(frame)
                return None
            self.in_speech = True
            self.segment = bytearray(b"".join(self.preroll))
            self.preroll.clear()
            self.segment_ms = max(0, len(self.segment) // max(1, self.frame_bytes)) * self.frame_ms
            self.voiced_ms = 0
            self.silence_ms = 0
            self.next_partial_ms = self.partial_ms

        self.segment.extend(frame)
        self.segment_ms += self.frame_ms
        if is_speech:
            self.voiced_ms += self.frame_ms
            self.silence_ms = 0
        else:
            self.silence_ms += self.frame_ms

        if self.voiced_ms < self.min_speech_ms:
            return None
        if self.segment_ms >= self.max_segment_ms:
            return self._create_event(stable=True, reason="max_segment")
        if self.silence_ms >= self.end_silence_ms:
            return self._create_event(stable=True, reason="silence")
        if self.segment_ms >= self.next_partial_ms:
            self.next_partial_ms += self.partial_ms
            return MeetingEndpointEvent(
                pcm=bytes(self.segment[-self.partial_window_bytes :]),
                stable=False,
                utterance_index=self.next_utterance_index,
                reason="partial",
                asr_window_ms=min(self.segment_ms, self.partial_window_ms),
                full_segment_ms=self.segment_ms,
            )
        return None

    def _create_event(self, stable: bool, reason: str) -> MeetingEndpointEvent:
        event = MeetingEndpointEvent(
            pcm=bytes(self.segment),
            stable=stable,
            utterance_index=self.next_utterance_index,
            reason=reason,
            asr_window_ms=self.segment_ms,
            full_segment_ms=self.segment_ms,
        )
        if stable:
            self.next_utterance_index += 1
            self.reset_segment()
        return event


def extract_funasr_text(result: Any) -> str:
    item = result
    if isinstance(item, tuple) and item:
        item = item[0]
    while isinstance(item, list) and item:
        item = item[0]
    if isinstance(item, dict):
        return str(item.get("text", "")).strip()
    return str(item or "").strip()


def normalize_rich_transcription_text(text: str) -> str:
    try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        return str(rich_transcription_postprocess(text)).strip()
    except Exception:
        return re.sub(r"<\|[^|]+?\|>", "", text).strip()


def postprocess_asr_text(text: str, postprocess: str | None) -> str:
    if postprocess == "rich_transcription":
        return normalize_rich_transcription_text(text)
    return text


def should_insert_asr_text_separator(left: str, right: str) -> bool:
    if not left or not right:
        return False
    left_char = left[-1]
    right_char = right[0]
    if left_char.isspace() or right_char.isspace():
        return False
    if "\u4e00" <= left_char <= "\u9fff" or "\u4e00" <= right_char <= "\u9fff":
        return False
    return left_char.isalnum() and right_char.isalnum() or left_char in ".!?"


def join_asr_text(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    separator = " " if should_insert_asr_text_separator(left, right) else ""
    return f"{left}{separator}{right}"


def longest_common_text_prefix(left: str, right: str) -> str:
    max_length = min(len(left), len(right))
    index = 0
    while index < max_length and left[index] == right[index]:
        index += 1
    return left[:index]


def trim_common_prefix_to_commit_boundary(value: str) -> str:
    raw_text = value
    text = raw_text.strip()
    if not text:
        return ""
    if any("\u4e00" <= char <= "\u9fff" for char in text):
        return text
    if raw_text[-1:].isspace() or not text[-1].isalnum():
        return text.strip()
    boundary = -1
    for index in range(len(text) - 1, -1, -1):
        char = text[index]
        if char.isspace() or char in ",.;:!?)]}":
            boundary = index
            break
    if boundary <= 0:
        return ""
    return text[:boundary].strip()


def generate_streaming_asr_chunk(
    runtime: StreamingAsrRuntime,
    pcm_bytes: bytes,
    cache: dict[str, Any],
    is_final: bool,
) -> str:
    audio = pcm16_bytes_to_float32(pcm_bytes)
    kwargs: dict[str, Any] = {"input": audio}
    if runtime.pass_cache:
        kwargs["cache"] = cache
    if runtime.pass_is_final:
        kwargs["is_final"] = is_final
    if runtime.chunk_size is not None:
        kwargs["chunk_size"] = runtime.chunk_size
    if runtime.encoder_chunk_look_back is not None:
        kwargs["encoder_chunk_look_back"] = runtime.encoder_chunk_look_back
    if runtime.decoder_chunk_look_back is not None:
        kwargs["decoder_chunk_look_back"] = runtime.decoder_chunk_look_back
    kwargs.update(runtime.generate_options)

    with runtime.lock:
        result = runtime.model.generate(**kwargs)
    return postprocess_asr_text(extract_funasr_text(result), runtime.postprocess)


class StreamingAsrSession:
    def __init__(
        self,
        runtime: StreamingAsrRuntime,
        sample_rate: int = 16000,
        chunk_ms: int | None = None,
    ) -> None:
        self.runtime = runtime
        self.sample_rate = sample_rate
        self.chunk_ms = runtime.chunk_ms if chunk_ms is None else chunk_ms
        self.cache: dict[str, Any] = {}
        self.pcm_buffer = bytearray()
        self.full_pcm = bytearray()
        self.chunk_bytes = max(1, int(self.sample_rate * self.chunk_ms / 1000) * 2)
        self.text_parts: list[str] = []
        self.has_audio = False
        self.partial_tail_text = ""
        self.endpoint_detector = MeetingEndpointDetector(sample_rate=self.sample_rate) if runtime.realtime_endpointing else None

    def append_pcm16(self, chunk: bytes) -> list[StreamingAsrResult]:
        if not chunk:
            return []

        self.has_audio = True
        if self.runtime.accumulate_audio or self.runtime.keep_full_audio_for_final:
            self.full_pcm.extend(chunk)

        if self.endpoint_detector is not None:
            return [
                self._generate_endpoint_event(event)
                for event in self.endpoint_detector.append_pcm16(chunk)
            ]

        self.pcm_buffer.extend(chunk)
        results: list[StreamingAsrResult] = []

        while len(self.pcm_buffer) >= self.chunk_bytes:
            pcm_chunk = bytes(self.pcm_buffer[: self.chunk_bytes])
            del self.pcm_buffer[: self.chunk_bytes]
            results.append(self._generate(pcm_chunk, False))

        return results

    def finalize(self) -> StreamingAsrResult:
        if not self.has_audio and not self.pcm_buffer:
            return StreamingAsrResult(text="".join(self.text_parts), segment_text="")

        if self.endpoint_detector is not None:
            for event in self.endpoint_detector.finalize():
                self._generate_endpoint_event(event)

        final_chunk = bytes(self.full_pcm if self.runtime.keep_full_audio_for_final else self.pcm_buffer)
        self.pcm_buffer.clear()
        return self._generate(final_chunk, True)

    def _compose_text(self, tail_text: str = "") -> str:
        stable = "".join(self.text_parts)
        if not stable:
            return tail_text
        if not tail_text:
            return stable
        if tail_text.startswith(stable):
            return tail_text
        return join_asr_text(stable, tail_text)

    def _append_streaming_text(self, text: str) -> str:
        if not text:
            return "".join(self.text_parts)
        current = "".join(self.text_parts)
        if current and text.startswith(current):
            suffix = text[len(current) :]
            if suffix:
                self.text_parts.append((" " if should_insert_asr_text_separator(current, suffix) else "") + suffix)
            return "".join(self.text_parts)
        if current and current.endswith(text):
            return current
        self.text_parts.append((" " if should_insert_asr_text_separator(current, text) else "") + text)
        return "".join(self.text_parts)

    def _generate_endpoint_event(self, event: MeetingEndpointEvent) -> StreamingAsrResult:
        started_at = time.monotonic()
        text = generate_streaming_asr_chunk(self.runtime, event.pcm, {}, event.stable)
        latency_ms = int((time.monotonic() - started_at) * 1000)
        if event.stable:
            self.partial_tail_text = ""
            stable_text = self._append_streaming_text(text)
            return StreamingAsrResult(
                text=stable_text,
                segment_text=text,
                stable=True,
                is_partial=False,
                utterance_index=event.utterance_index,
                asr_latency_ms=latency_ms,
                endpoint_reason=event.reason,
                asr_window_ms=event.asr_window_ms,
            )

        self.partial_tail_text = text
        return StreamingAsrResult(
            text=self._compose_text(text),
            segment_text=text,
            stable=False,
            is_partial=True,
            utterance_index=event.utterance_index,
            asr_latency_ms=latency_ms,
            endpoint_reason=event.reason,
            asr_window_ms=event.asr_window_ms,
        )

    def _generate(self, pcm_chunk: bytes, is_final: bool) -> StreamingAsrResult:
        source_pcm = bytes(self.full_pcm) if self.runtime.accumulate_audio else pcm_chunk
        started_at = time.monotonic()
        text = generate_streaming_asr_chunk(self.runtime, source_pcm, self.cache, is_final)
        latency_ms = int((time.monotonic() - started_at) * 1000)
        if is_final and self.runtime.keep_full_audio_for_final:
            if text:
                self.text_parts = [text]
            self.partial_tail_text = ""
            return StreamingAsrResult(
                text="".join(self.text_parts),
                segment_text=text,
                stable=True,
                is_partial=False,
                asr_latency_ms=latency_ms,
            )

        if self.runtime.accumulate_audio:
            if text:
                self.text_parts = [text]
            return StreamingAsrResult(
                text="".join(self.text_parts),
                segment_text=text,
                stable=False,
                is_partial=True,
                asr_latency_ms=latency_ms,
            )

        return StreamingAsrResult(
            text=self._append_streaming_text(text),
            segment_text=text,
            stable=False,
            is_partial=True,
            asr_latency_ms=latency_ms,
        )


def is_streaming_asr_model_loaded() -> bool:
    return isinstance(_model, StreamingAsrRuntime)


def create_streaming_asr_session(sample_rate: int = 16000) -> StreamingAsrSession:
    model = _get_model()
    if not isinstance(model, StreamingAsrRuntime):
        raise RuntimeError("当前 ASR 模型不支持 streaming 会话")
    return StreamingAsrSession(model, sample_rate=sample_rate)


def transcribe_pcm16_bytes(pcm_bytes: bytes) -> str:
    if not pcm_bytes:
        return ""

    session = create_streaming_asr_session()
    chunk_size = getattr(session, "chunk_bytes", len(pcm_bytes) or 1)
    for offset in range(0, len(pcm_bytes), chunk_size):
        session.append_pcm16(pcm_bytes[offset : offset + chunk_size])
    return session.finalize().text


class AudioBackpressureQueue:
    def __init__(
        self,
        sample_rate: int = 16000,
        max_audio_ms: int = 2000,
    ) -> None:
        self.sample_rate = max(1, int(sample_rate or 16000))
        self.max_bytes = max(2, int(self.sample_rate * max_audio_ms / 1000) * 2)
        self.pending: deque[bytes] = deque()
        self.pending_bytes = 0
        self.dropped_bytes = 0
        self.closed = False
        self.condition = asyncio.Condition()

    async def put(self, chunk: bytes) -> None:
        if not chunk:
            return
        async with self.condition:
            if self.closed:
                return
            if len(chunk) > self.max_bytes:
                self.dropped_bytes += len(chunk) - self.max_bytes
                normalized = bytes(chunk[-self.max_bytes :])
            else:
                normalized = bytes(chunk)
            while self.pending and self.pending_bytes + len(normalized) > self.max_bytes:
                dropped = self.pending.popleft()
                self.pending_bytes -= len(dropped)
                self.dropped_bytes += len(dropped)
            self.pending.append(normalized)
            self.pending_bytes += len(normalized)
            self.condition.notify()

    async def get(self) -> bytes | None:
        async with self.condition:
            while not self.pending and not self.closed:
                await self.condition.wait()
            if not self.pending:
                return None
            chunk = self.pending.popleft()
            self.pending_bytes -= len(chunk)
            return chunk

    async def close(self) -> None:
        async with self.condition:
            self.closed = True
            self.condition.notify_all()

    def backlog_ms(self) -> int:
        return int(self.pending_bytes / max(1, self.sample_rate * 2) * 1000)


class RealtimeAsrEngine:
    def __init__(
        self,
        sample_rate: int = 16000,
        session_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.sample_rate = max(1, int(sample_rate or 16000))
        factory = session_factory or create_streaming_asr_session
        self.session = factory(sample_rate=self.sample_rate)

    def append_pcm16(self, chunk: bytes) -> list[StreamingAsrResult]:
        return self.session.append_pcm16(chunk)

    def finalize(self) -> StreamingAsrResult:
        return self.session.finalize()


class StableTranscriptAssembler:
    @staticmethod
    def split_result_text(result: StreamingAsrResult) -> tuple[str, str]:
        text = str(result.text or "")
        segment = str(result.segment_text or "")
        if result.stable:
            return text, ""
        if not segment:
            return "", text
        if text.endswith(segment):
            stable_prefix = text[: -len(segment)]
            return stable_prefix.strip(), segment
        return "", segment or text


class MeetingRealtimePipeline:
    def __init__(
        self,
        sample_rate: int = 16000,
        source_profile: str = "",
        session_factory: Callable[..., Any] | None = None,
        on_result: Callable[[StreamingAsrResult], Any] | None = None,
        on_error: Callable[[Exception], Any] | None = None,
    ) -> None:
        self.sample_rate = max(1, int(sample_rate or 16000))
        self.source_profile = str(source_profile or "")
        self.on_result = on_result
        self.on_error = on_error
        self.queue = AudioBackpressureQueue(sample_rate=self.sample_rate)
        self.engine = RealtimeAsrEngine(sample_rate=self.sample_rate, session_factory=session_factory)
        self.worker_task: asyncio.Task | None = None
        self.full_pcm = bytearray()
        self.closed = False
        self.sequence = 0
        self.stable_transcript_text = ""
        self.partial_revision = 0
        self.last_partial_hypothesis_text = ""

    async def start(self) -> None:
        if self.worker_task is None:
            self.worker_task = asyncio.create_task(self._run())

    async def append_pcm16(self, chunk: bytes) -> None:
        if self.closed:
            return
        if chunk:
            self.full_pcm.extend(chunk)
        await self.queue.put(chunk)

    async def finish(self) -> StreamingAsrResult:
        self.closed = True
        await self.queue.close()
        await self._wait_worker()
        if self.queue.dropped_bytes > 0 and self.full_pcm:
            started_at = time.monotonic()
            final_text = await asyncio.to_thread(transcribe_pcm16_bytes, bytes(self.full_pcm))
            latency_ms = int((time.monotonic() - started_at) * 1000)
            full_ms = int(len(self.full_pcm) / max(1, self.sample_rate * 2) * 1000)
            return StreamingAsrResult(
                text=final_text,
                segment_text=final_text,
                stable_text=final_text,
                partial_text="",
                stable=True,
                is_partial=False,
                utterance_index=self.sequence + 1,
                asr_latency_ms=latency_ms,
                asr_backlog_ms=0,
                asr_rtf=round(latency_ms / max(1, full_ms), 4),
                endpoint_reason="final_full_rescore",
                asr_window_ms=full_ms,
                asr_full_segment_ms=full_ms,
                hypothesis_id=f"final:{self.sequence + 1}",
                revision_id=f"final:{self.sequence + 1}",
                utterance_id=f"final:{self.sequence + 1}",
                asr_engine="final_sensevoice",
                source_profile=self.source_profile,
            )
        result = await asyncio.to_thread(self.engine.finalize)
        decorated = self._decorate_result(result)
        final_text = str(getattr(result, "text", "") or getattr(result, "segment_text", "") or decorated.text or "").strip()
        return replace(
            decorated,
            text=final_text,
            revision_id=f"final:{decorated.utterance_id or self.sequence}",
            utterance_id=f"final:{decorated.utterance_id or self.sequence}",
            asr_engine="final_sensevoice",
            is_partial=False,
            stable=True,
            partial_text="",
            stable_text=final_text,
        )

    async def cancel(self) -> None:
        self.closed = True
        await self.queue.close()
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
        await self._wait_worker()

    async def drain_live(self) -> None:
        self.closed = True
        await self.queue.close()
        await self._wait_worker()

    async def _wait_worker(self) -> None:
        if not self.worker_task:
            return
        try:
            await self.worker_task
        except asyncio.CancelledError:
            pass
        finally:
            self.worker_task = None

    async def _run(self) -> None:
        try:
            while True:
                chunk = await self.queue.get()
                if chunk is None:
                    return
                results = await asyncio.to_thread(self.engine.append_pcm16, chunk)
                for result in results:
                    decorated = self._decorate_result(result)
                    if self.on_result:
                        maybe_awaitable = self.on_result(decorated)
                        if inspect.isawaitable(maybe_awaitable):
                            await maybe_awaitable
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if self.on_error:
                maybe_awaitable = self.on_error(error)
                if inspect.isawaitable(maybe_awaitable):
                    await maybe_awaitable

    def _decorate_result(self, result: StreamingAsrResult) -> StreamingAsrResult:
        if not isinstance(result, StreamingAsrResult):
            result = StreamingAsrResult(
                text=str(getattr(result, "text", "") or ""),
                segment_text=str(getattr(result, "segment_text", "") or ""),
                stable=bool(getattr(result, "stable", True)),
                is_partial=bool(getattr(result, "is_partial", not bool(getattr(result, "stable", True)))),
                utterance_index=int(getattr(result, "utterance_index", 0) or 0),
                asr_latency_ms=int(getattr(result, "asr_latency_ms", 0) or 0),
                endpoint_reason=str(getattr(result, "endpoint_reason", "") or ""),
                asr_window_ms=int(getattr(result, "asr_window_ms", 0) or 0),
                asr_full_segment_ms=int(getattr(result, "asr_full_segment_ms", 0) or getattr(result, "full_segment_ms", 0) or 0),
            )
        self.sequence += 1
        if result.stable:
            stable_text = str(result.text or result.segment_text or "").strip()
            if not stable_text:
                stable_text = self.stable_transcript_text
            elif self.stable_transcript_text and not stable_text.startswith(self.stable_transcript_text):
                segment_text = str(result.segment_text or "").strip()
                if self.stable_transcript_text.startswith(stable_text):
                    stable_text = self.stable_transcript_text
                else:
                    stable_text = join_asr_text(self.stable_transcript_text, segment_text) if segment_text else self.stable_transcript_text
            self.stable_transcript_text = stable_text
            self.last_partial_hypothesis_text = stable_text
            partial_text = ""
        else:
            _result_stable_text, partial_text = StableTranscriptAssembler.split_result_text(result)
            stable_hint = str(getattr(result, "stable_text", "") or _result_stable_text or "").strip()
            full_hypothesis = str(result.text or "").strip()
            if not stable_hint and self.last_partial_hypothesis_text and full_hypothesis:
                common_prefix = trim_common_prefix_to_commit_boundary(
                    longest_common_text_prefix(self.last_partial_hypothesis_text, full_hypothesis),
                )
                if common_prefix and len(common_prefix) > len(self.stable_transcript_text):
                    stable_hint = common_prefix
            if stable_hint and (not self.stable_transcript_text or len(stable_hint) >= len(self.stable_transcript_text)):
                self.stable_transcript_text = stable_hint
            partial_text = str(getattr(result, "partial_text", "") or partial_text or result.segment_text or "").strip()
            if self.stable_transcript_text and partial_text.startswith(self.stable_transcript_text):
                partial_text = partial_text[len(self.stable_transcript_text) :].strip()
            stable_text = self.stable_transcript_text
            self.last_partial_hypothesis_text = full_hypothesis or join_asr_text(stable_text, partial_text)
            self.partial_revision += 1
        window_ms = int(result.asr_window_ms or 0)
        full_segment_ms = int(result.asr_full_segment_ms or window_ms or 0)
        latency_ms = int(result.asr_latency_ms or 0)
        utterance_id = str(result.utterance_index or self.sequence)
        revision_id = f"{utterance_id}:{'stable' if result.stable else 'partial'}:{self.partial_revision if not result.stable else self.sequence}"
        display_text = stable_text if result.stable or not partial_text else join_asr_text(stable_text, partial_text)
        return replace(
            result,
            text=display_text,
            stable_text=stable_text,
            partial_text=partial_text,
            asr_backlog_ms=self.queue.backlog_ms(),
            asr_rtf=round(latency_ms / max(1, window_ms), 4),
            asr_full_segment_ms=full_segment_ms,
            hypothesis_id=f"{result.utterance_index or self.sequence}:{'stable' if result.stable else 'partial'}:{self.sequence}",
            revision_id=revision_id,
            utterance_id=utterance_id,
            asr_engine=str(getattr(result, "asr_engine", "") or "sensevoice_endpoint"),
            source_profile=self.source_profile,
        )


async def transcribe_audio(audio_path: str, language: str | None = None) -> str:
    """转写音频文件为文本。"""
    loop = asyncio.get_event_loop()
    del language
    return await loop.run_in_executor(None, _transcribe_sync, audio_path)


def _transcribe_sync(audio_path: str) -> str:
    session = create_streaming_asr_session()
    for pcm_chunk in iter_audio_file_pcm16_chunks(audio_path):
        session.append_pcm16(pcm_chunk)
    return session.finalize().text
