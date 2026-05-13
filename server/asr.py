"""ASR 模块 - 使用 faster-whisper (CTranslate2) 加载 Whisper 模型进行语音转文字"""

import os
import asyncio
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()

_model = None
_model_lock = asyncio.Lock()


def _get_model():
    """懒加载 Whisper 模型（单例）"""
    global _model
    if _model is not None:
        return _model

    from faster_whisper import WhisperModel

    # 先用 base 模型快速启动，后续可换 large-v3-turbo
    print("[ASR] 加载模型: base (首次会自动下载约 150MB)")
    _model = WhisperModel("base", device="cpu", compute_type="int8")
    print("[ASR] 模型加载完成")

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
        vad_filter=True,  # 启用 VAD 过滤静音段
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    # 拼接所有 segment 的文本
    text_parts = []
    for segment in segments:
        text_parts.append(segment.text.strip())

    return " ".join(text_parts)
