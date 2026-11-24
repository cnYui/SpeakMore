"""分段润色：封口的段在后台润色，说完只补最后一段；以及接进 WebSocket 语音流后的整体行为。"""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import WebSocketDisconnect

import asr
from main import ws_voice_flow
from segment_polish import SegmentPolisher, polish_key, supports_segment_polish

SAMPLE_RATE = 16000


class SegmentPolisherTest(unittest.TestCase):
    def run_async(self, coroutine):
        return asyncio.run(coroutine)

    def test_segments_are_polished_in_the_background_and_joined_in_order(self):
        started = []

        async def refine(raw_text, mode, context, parameters):
            started.append(raw_text)
            # 后面的段先润色完，结果也必须按原来的顺序接。
            await asyncio.sleep(0.02 if raw_text == "甲" else 0)
            return f"<{raw_text}>"

        async def scenario():
            polisher = SegmentPolisher(refine)
            polisher.add("甲", "transcript", {}, {}, polish_now=True)
            polisher.add("乙", "transcript", {}, {}, polish_now=True)
            await asyncio.sleep(0)
            self.assertEqual(started, ["甲", "乙"])  # 没等说完就已经开始润色了
            polisher.add("丙", "transcript", {}, {}, polish_now=True)
            return await polisher.finish("transcript", {}, {})

        self.assertEqual(self.run_async(scenario()), "<甲><乙><丙>")

    def test_segments_added_without_polishing_are_polished_at_finish(self):
        refine = AsyncMock(side_effect=lambda raw_text, **_: f"<{raw_text}>")

        async def scenario():
            polisher = SegmentPolisher(refine)
            polisher.add("甲", "transcript", {}, {}, polish_now=False)
            polisher.add("乙", "transcript", {}, {}, polish_now=True)
            return await polisher.finish("transcript", {}, {})

        self.assertEqual(self.run_async(scenario()), "<甲><乙>")
        self.assertEqual(refine.await_count, 2)

    def test_segments_polished_under_a_different_mode_are_polished_again(self):
        refine = AsyncMock(side_effect=lambda raw_text, mode, **_: f"{mode}:{raw_text}")

        async def scenario():
            polisher = SegmentPolisher(refine)
            polisher.add("甲", "transcript", {}, {}, polish_now=True)
            polisher.add("乙", "transcript", {}, {}, polish_now=True)
            # 说完前切成了翻译：之前按听写润色的段作废，按翻译重新来。
            return await polisher.finish("translation", {}, {"output_language": "en"})

        self.assertEqual(self.run_async(scenario()), "translation:甲translation:乙")

    def test_empty_segments_are_not_sent_to_the_model(self):
        refine = AsyncMock(side_effect=lambda raw_text, **_: f"<{raw_text}>")

        async def scenario():
            polisher = SegmentPolisher(refine)
            polisher.add("", "transcript", {}, {}, polish_now=True)
            polisher.add("甲", "transcript", {}, {}, polish_now=True)
            return await polisher.finish("transcript", {}, {})

        self.assertEqual(self.run_async(scenario()), "<甲>")
        self.assertEqual(refine.await_count, 1)

    def test_a_failed_segment_fails_the_whole_result_and_cancels_the_rest(self):
        cancelled = []

        async def refine(raw_text, mode, context, parameters):
            if raw_text == "甲":
                raise RuntimeError("model down")
            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                cancelled.append(raw_text)
                raise
            return raw_text

        async def scenario():
            polisher = SegmentPolisher(refine)
            polisher.add("甲", "translation", {}, {}, polish_now=True)
            polisher.add("乙", "translation", {}, {}, polish_now=True)
            with self.assertRaises(RuntimeError):
                await polisher.finish("translation", {}, {})
            await asyncio.sleep(0)
            return cancelled

        self.assertEqual(self.run_async(scenario()), ["乙"])

    def test_cancel_stops_running_polish_and_forgets_segments(self):
        async def refine(raw_text, mode, context, parameters):
            await asyncio.sleep(5)
            return raw_text

        async def scenario():
            polisher = SegmentPolisher(refine)
            polisher.add("甲", "transcript", {}, {}, polish_now=True)
            task = polisher._segments[0].task
            polisher.cancel()
            await asyncio.sleep(0)
            return task.cancelled(), polisher.raw_segments

        cancelled, raw_segments = self.run_async(scenario())
        self.assertTrue(cancelled)
        self.assertEqual(raw_segments, [])

    def test_only_dictation_and_translation_without_selection_are_polished_by_segment(self):
        self.assertTrue(supports_segment_polish("transcript", {}))
        self.assertTrue(supports_segment_polish("translation", {"output_language": "ja"}))
        self.assertFalse(supports_segment_polish("ask_anything", {}))
        self.assertFalse(supports_segment_polish("transcript", {"selected_text": "选中的文字"}))

    def test_polish_key_changes_with_mode_and_target_language(self):
        self.assertNotEqual(polish_key("transcript", {}), polish_key("translation", {}))
        self.assertNotEqual(
            polish_key("translation", {"output_language": "en"}),
            polish_key("translation", {"output_language": "ja"}),
        )


class FakeWebSocket:
    def __init__(self, incoming_messages, on_end_audio=None):
        self._incoming = list(incoming_messages)
        self._on_end_audio = on_end_audio
        self.sent_messages = []

    async def accept(self):
        pass

    async def receive(self):
        if not self._incoming:
            raise WebSocketDisconnect()
        message = self._incoming.pop(0)
        if self._on_end_audio and "end_audio" in str(message.get("text", "")):
            self._on_end_audio()
        return message

    async def send_json(self, payload):
        self.sent_messages.append(payload)


def start_message(mode):
    return {
        "type": "websocket.receive",
        "text": json.dumps({
            "type": "start_audio",
            "audio_id": "a1",
            "mode": mode,
            "audio_context": {},
            "parameters": {"audio_format": {"type": "pcm_s16le", "sample_rate": SAMPLE_RATE, "channels": 1}},
        }),
    }


def audio_messages(seconds):
    half_second = bytes(SAMPLE_RATE)  # 0.5 秒的 PCM16 静音
    return [{"type": "websocket.receive", "bytes": half_second} for _ in range(int(seconds * 2))]


END_MESSAGE = {"type": "websocket.receive", "text": json.dumps({"type": "end_audio", "audio_id": "a1"})}


class SegmentedWebSocketTest(unittest.TestCase):
    def run_session(self, mode, seconds):
        """跑一轮录音：识别按 1 秒一段（甲、乙、丙…），润色把每段包成 <…>。返回 (消息, 润色调用, 说完时已经开始润色的次数)。"""
        finals = iter("甲乙丙丁戊己")

        def fake_generate(runtime, pcm_bytes, cache, is_final):
            return next(finals) if is_final else "草稿"

        refine = AsyncMock(side_effect=lambda raw_text, **_: f"<{raw_text}>")
        snapshot = {}
        websocket = FakeWebSocket(
            [start_message(mode), *audio_messages(seconds), END_MESSAGE],
            on_end_audio=lambda: snapshot.setdefault("started_before_end", refine.await_count + refine.call_count),
        )
        runtime = asr.StreamingAsrRuntime(model=None, accumulate_audio=True, chunk_ms=1200)

        with patch("asr.generate_streaming_asr_chunk", side_effect=fake_generate), patch(
            "main.create_streaming_asr_session",
            side_effect=lambda sample_rate=16000: asr.StreamingAsrSession(runtime, sample_rate=sample_rate, segment_ms=1000),
        ), patch("main.refine_text", refine):
            asyncio.run(ws_voice_flow(websocket))
        return websocket.sent_messages, refine, snapshot.get("started_before_end", 0)

    def test_dictation_polishes_each_segment_and_delivers_the_joined_text(self):
        messages, refine, started_before_end = self.run_session("transcript", 2.5)

        completed = [m for m in messages if m["K"] == "audio_processing_completed"]
        self.assertEqual(len(completed), 1)
        self.assertEqual(completed[0]["V"]["refined_text"], "<甲><乙><丙>")
        self.assertEqual([call.kwargs["raw_text"] for call in refine.call_args_list], ["甲", "乙", "丙"])
        # 前两段在说话的时候就已经交给大模型了，说完只剩最后一段。
        self.assertGreaterEqual(started_before_end, 2)

    def test_short_dictation_polishes_once(self):
        messages, refine, _ = self.run_session("transcript", 0.5)

        completed = [m for m in messages if m["K"] == "audio_processing_completed"]
        self.assertEqual(completed[0]["V"]["refined_text"], "<甲>")
        self.assertEqual(refine.call_count, 1)

    def test_ask_mode_still_polishes_the_whole_text_once(self):
        messages, refine, _ = self.run_session("ask_anything", 2.5)

        completed = [m for m in messages if m["K"] == "refine_completed"]
        self.assertEqual(len(completed), 1)
        self.assertEqual(refine.call_count, 1)
        self.assertEqual(refine.call_args.kwargs["raw_text"], "甲乙丙")
        self.assertEqual(completed[0]["V"]["refined_text"], "<甲乙丙>")

    def test_transcription_messages_carry_the_cumulative_text(self):
        messages, _, _ = self.run_session("transcript", 2.5)

        texts = [m["V"]["text"] for m in messages if m["K"] == "transcription"]
        self.assertTrue(texts)
        self.assertEqual(texts[-1], "甲乙丙")


if __name__ == "__main__":
    unittest.main()
