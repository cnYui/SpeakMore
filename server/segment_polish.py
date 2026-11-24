"""长录音的分段润色：识别会话每封口一段（最长 30 秒）原文，就在后台交给大模型润色并存下来；
说完以后只需要再处理最后一段，把各段润色结果按顺序接起来一次交付。"""

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from asr import join_segment_texts

# 只有这两种任务按段润色：听写（transcript）和翻译（translation）。
# 自由提问要把整句话放在一起理解，不能拆开，仍然只在说完后润色一次（识别照样分段）。
SEGMENT_POLISH_MODES = {"transcript", "translation"}

RefineFunction = Callable[..., Awaitable[str]]


def supports_segment_polish(mode: str, parameters: dict | None) -> bool:
    """这一轮是否按段润色：只有听写和翻译；带选区的（对选中的文字做操作）按整体处理。"""
    if mode not in SEGMENT_POLISH_MODES:
        return False
    return not (parameters or {}).get("selected_text")


def polish_key(mode: str, parameters: dict | None) -> tuple[str, str]:
    """润色结果依赖的设置：中途切了模式 / 翻译目标语言，之前润色好的段就作废、要重新润色。"""
    return mode, str((parameters or {}).get("output_language") or "")


def _consume_exception(task: "asyncio.Future[Any]") -> None:
    # 取走异常，避免“Task exception was never retrieved”；真正的错误在 finish() 里 await 时再抛出。
    if not task.cancelled():
        task.exception()


@dataclass
class _Segment:
    raw: str
    key: tuple[str, str]
    task: "asyncio.Future[str] | None"


class SegmentPolisher:
    def __init__(self, refine: RefineFunction) -> None:
        self._refine = refine
        self._segments: list[_Segment] = []

    @property
    def raw_segments(self) -> list[str]:
        return [segment.raw for segment in self._segments]

    def add(self, raw: str, mode: str, context: dict | None, parameters: dict | None, polish_now: bool) -> None:
        """记下一个封口的段；polish_now 为真就立刻在后台开始润色（空段不需要润色）。"""
        task = None
        if polish_now and raw.strip():
            task = self._start(raw, mode, context, parameters)
        self._segments.append(_Segment(raw=raw, key=polish_key(mode, parameters), task=task))

    async def finish(self, mode: str, context: dict | None, parameters: dict | None) -> str:
        """等所有段润色完，按顺序接成全文。润色时的模式和现在不一样的段、还没开始润色的段，现在补上。"""
        key = polish_key(mode, parameters)
        for segment in self._segments:
            if not segment.raw.strip():
                continue
            if segment.task is None or segment.key != key:
                if segment.task is not None:
                    segment.task.cancel()
                segment.task = self._start(segment.raw, mode, context, parameters)
                segment.key = key

        tasks = [segment.task for segment in self._segments if segment.task is not None]
        try:
            results = await asyncio.gather(*tasks)
        except BaseException:
            self.cancel()
            raise
        return join_segment_texts(list(results))

    def cancel(self) -> None:
        for segment in self._segments:
            if segment.task is not None and not segment.task.done():
                segment.task.cancel()
        self._segments = []

    def _start(self, raw: str, mode: str, context: dict | None, parameters: dict | None) -> "asyncio.Future[str]":
        task = asyncio.ensure_future(self._refine(raw_text=raw, mode=mode, context=context, parameters=parameters))
        task.add_done_callback(_consume_exception)
        return task
