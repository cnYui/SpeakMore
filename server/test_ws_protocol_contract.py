import asyncio
import contextlib
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import WebSocketDisconnect

from main import MeetingRealtimeTranslator, ws_voice_flow


class FakeWebSocket:
    def __init__(self, incoming_messages):
        self._incoming_messages = list(incoming_messages)
        self.sent_messages = []
        self.accepted = False

    async def accept(self):
        self.accepted = True

    async def receive(self):
        if not self._incoming_messages:
            raise WebSocketDisconnect()
        return self._incoming_messages.pop(0)

    async def send_json(self, payload):
        self.sent_messages.append(payload)


class WsProtocolContractTest(unittest.TestCase):
    def test_start_audio_emits_session_started_before_audio_session_started(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {},
                }),
            },
        ])

        asyncio.run(ws_voice_flow(websocket))

        self.assertTrue(websocket.accepted)
        self.assertGreaterEqual(len(websocket.sent_messages), 2)
        self.assertEqual(websocket.sent_messages[0]["K"], "session_started")
        self.assertEqual(websocket.sent_messages[1]["K"], "process_mode")

    def test_end_audio_emits_audio_session_ending_before_final_result(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {},
                }),
            },
            {
                "type": "websocket.receive",
                "bytes": b"RIFF\x24\x80\x00\x00",
            },
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "end_audio",
                    "audio_id": "audio-1",
                }),
            },
        ])

        with patch("main.transcribe_audio_with_wav_conversion", return_value="hello"), patch(
            "main.refine_text",
            return_value="hello refined",
        ):
            asyncio.run(ws_voice_flow(websocket))

        message_types = [message["K"] for message in websocket.sent_messages]
        self.assertGreaterEqual(len(message_types), 5)
        self.assertEqual(
            message_types[:5],
            [
                "session_started",
                "process_mode",
                "audio_session_started",
                "received_audio_chunk_count",
                "audio_session_ending",
            ],
        )

    def test_mode_config_update_emits_process_mode_instead_of_unknown_message_error(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {},
                }),
            },
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "set_mode_config",
                    "mode": "translation",
                }),
            },
        ])

        asyncio.run(ws_voice_flow(websocket))

        process_mode_messages = [message for message in websocket.sent_messages if message["K"] == "process_mode"]
        self.assertGreaterEqual(len(process_mode_messages), 2)
        self.assertEqual(process_mode_messages[-1]["V"]["mode"], "translation")
        self.assertFalse(
            any(
                message["K"] == "error" and message["V"].get("detail") == "Unknown message type"
                for message in websocket.sent_messages
            )
        )

    def test_transcription_failure_emits_transcription_error(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {},
                }),
            },
            {
                "type": "websocket.receive",
                "bytes": b"RIFF\x24\x80\x00\x00",
            },
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "end_audio",
                    "audio_id": "audio-1",
                }),
            },
        ])

        with patch("main.transcribe_audio_with_wav_conversion", side_effect=RuntimeError("boom")):
            asyncio.run(ws_voice_flow(websocket))

        self.assertEqual(websocket.sent_messages[-1]["K"], "transcription_error")
        self.assertEqual(websocket.sent_messages[-1]["V"]["detail"], "boom")

    def test_transcription_failure_clears_audio_chunks_before_next_end_audio(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {},
                }),
            },
            {"type": "websocket.receive", "bytes": b"RIFF\x24\x80\x00\x00"},
            {"type": "websocket.receive", "text": json.dumps({"type": "end_audio"})},
            {"type": "websocket.receive", "text": json.dumps({"type": "end_audio"})},
        ])

        calls = []

        async def fail_transcription(*args, **kwargs):
            calls.append((args, kwargs))
            raise RuntimeError("boom")

        with patch("main.transcribe_audio_with_wav_conversion", side_effect=fail_transcription):
            asyncio.run(ws_voice_flow(websocket))

        self.assertEqual(len(calls), 1)
        message_types = [message["K"] for message in websocket.sent_messages]
        self.assertEqual(message_types.count("transcription_error"), 1)
        self.assertEqual(message_types.count("audio_session_ending"), 2)

    def test_streaming_model_emits_transcription_when_pcm_chunk_arrives(self):
        class FakeStreamingSession:
            def append_pcm16(self, chunk):
                self.chunk = chunk
                return [type("StreamingResult", (), {"text": "你好"})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {"audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1}},
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()):
            asyncio.run(ws_voice_flow(websocket))

        transcription = next(message for message in websocket.sent_messages if message["K"] == "transcription")
        self.assertEqual(transcription["V"]["text"], "你好")
        self.assertEqual(transcription["V"]["audio_id"], "audio-1")
        self.assertEqual(transcription["V"]["stable_text"], transcription["V"]["text"])
        self.assertEqual(transcription["V"]["partial_text"], "")
        self.assertTrue(transcription["V"]["revision_id"])
        self.assertTrue(transcription["V"]["utterance_id"])
        self.assertEqual(transcription["V"]["asr_engine"], "sensevoice_endpoint")

    def test_meeting_notes_streaming_emits_realtime_translation_when_target_enabled(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "hello everyone."})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "hello everyone translated"
            asyncio.run(ws_voice_flow(websocket))

        translation = next(message for message in websocket.sent_messages if message["K"] == "meeting_translation")
        pending = next(message for message in websocket.sent_messages if message["K"] == "meeting_translation_pending")
        self.assertEqual(translation["V"]["text"], "hello everyone translated")
        self.assertEqual(translation["V"]["source_text"], "hello everyone.")
        self.assertEqual(translation["V"]["target_language"], "en")
        self.assertEqual(pending["V"]["target_language"], "en")
        self.assertEqual(pending["V"]["sentence_id"], translation["V"]["sentence_id"])
        self.assertEqual(pending["V"]["source_fingerprint"], translation["V"]["source_fingerprint"])
        self.assertTrue(translation["V"]["partial"])
        self.assertTrue(translation["V"]["stable"])
        self.assertEqual(pending["V"]["phase"], "commit")
        self.assertTrue(pending["V"]["source_stable"])
        self.assertEqual(translation["V"]["phase"], "commit")
        self.assertTrue(translation["V"]["source_stable"])
        pending_index = next(index for index, message in enumerate(websocket.sent_messages) if message["K"] == "meeting_translation_pending")
        translation_index = next(index for index, message in enumerate(websocket.sent_messages) if message["K"] == "meeting_translation")
        self.assertLess(pending_index, translation_index)
        refine.assert_called_once()

    def test_meeting_notes_short_cjk_segment_emits_realtime_translation(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "你好世界"})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "Hello world"
            asyncio.run(ws_voice_flow(websocket))

        translation = next(message for message in websocket.sent_messages if message["K"] == "meeting_translation")
        self.assertEqual(translation["V"]["source_text"], "你好世界")
        self.assertEqual(translation["V"]["target_language"], "en")

    def test_meeting_notes_tiny_segment_is_not_translated_as_phrase(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "hi"})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "hi"
            asyncio.run(ws_voice_flow(websocket))

        self.assertNotIn("meeting_translation_pending", [message["K"] for message in websocket.sent_messages])
        self.assertNotIn("meeting_translation", [message["K"] for message in websocket.sent_messages])
        refine.assert_not_called()

    def test_meeting_notes_streaming_skips_realtime_translation_when_target_off(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "hello everyone."})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "off",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            asyncio.run(ws_voice_flow(websocket))

        self.assertNotIn("meeting_translation", [message["K"] for message in websocket.sent_messages])
        refine.assert_not_called()

    def test_meeting_notes_partial_transcription_without_sentence_end_creates_preview_pending(self):
        websocket = FakeWebSocket([])
        translator = MeetingRealtimeTranslator(websocket)
        translator.reset(
            "audio-1",
            "meeting_notes",
            {},
            {"meeting_translation_target_language": "en"},
        )

        with patch("main.refine_text", new_callable=AsyncMock) as refine:
            asyncio.run(translator.observe_transcription("we need confirm budget plan", 1, stable=False))

        self.assertEqual([message["K"] for message in websocket.sent_messages], ["meeting_translation_pending"])
        self.assertFalse(websocket.sent_messages[0]["V"]["committed"])
        self.assertTrue(websocket.sent_messages[0]["V"]["provisional"])
        refine.assert_not_called()
        translator.cancel()

    def test_meeting_notes_stable_transcription_commits_phrase_translation(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [
                    type(
                        "StreamingResult",
                        (),
                        {
                            "text": "we need confirm budget plan",
                            "stable": True,
                            "is_partial": False,
                            "utterance_index": 1,
                            "asr_latency_ms": 24,
                            "endpoint_reason": "silence",
                            "asr_window_ms": 2100,
                        },
                    )()
                ]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "We need to confirm the budget plan."
            asyncio.run(ws_voice_flow(websocket))

        transcription = next(message for message in websocket.sent_messages if message["K"] == "transcription")
        self.assertTrue(transcription["V"]["stable"])
        self.assertFalse(transcription["V"]["is_partial"])
        self.assertEqual(transcription["V"]["endpoint_reason"], "silence")
        translation = next(message for message in websocket.sent_messages if message["K"] == "meeting_translation")
        self.assertEqual(translation["V"]["source_text"], "we need confirm budget plan")
        self.assertEqual(translation["V"]["sentence_index"], 1)
        refine.assert_called_once()

    def test_meeting_notes_realtime_translation_failure_does_not_interrupt_transcription(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "hello everyone."})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.side_effect = RuntimeError("llm failed")
            asyncio.run(ws_voice_flow(websocket))

        message_types = [message["K"] for message in websocket.sent_messages]
        self.assertIn("transcription", message_types)
        self.assertIn("meeting_translation_error", message_types)
        self.assertNotIn("refine_error", message_types)

    def test_meeting_notes_set_mode_config_updates_realtime_translation_target(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "hello everyone."})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "off",
                    },
                }),
            },
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "set_mode_config",
                    "mode": "meeting_notes",
                    "parameters": {"meeting_translation_target_language": "fr"},
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "bonjour"
            asyncio.run(ws_voice_flow(websocket))

        translation = next(message for message in websocket.sent_messages if message["K"] == "meeting_translation")
        self.assertEqual(translation["V"]["target_language"], "fr")
        refine.assert_awaited_once()
        self.assertEqual(refine.await_args.kwargs["parameters"]["output_language"], "fr")

    def test_meeting_notes_cumulative_asr_commits_only_new_sentences(self):
        class FakeStreamingSession:
            def __init__(self):
                self.outputs = [
                    "今天开会。",
                    "今天开会。第二件事讨论预算。",
                    "今天开会。第二件事讨论预算。最后确认排期。",
                ]

            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": self.outputs.pop(0)})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00"},
            {"type": "websocket.receive", "bytes": b"\x02\x00"},
            {"type": "websocket.receive", "bytes": b"\x03\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.side_effect = lambda raw_text, mode, context, parameters: f"translated: {raw_text}"
            asyncio.run(ws_voice_flow(websocket))

        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        pendings = [message for message in websocket.sent_messages if message["K"] == "meeting_translation_pending"]
        self.assertEqual([message["V"]["source_text"] for message in translations], [
            "今天开会。第二件事讨论预算。",
            "最后确认排期。",
        ])
        self.assertEqual([message["V"]["chunk_index"] for message in translations], [1, 2])
        self.assertEqual([message["V"]["sentence_index"] for message in translations], [1, 2])
        self.assertEqual([message["V"]["source_text"] for message in pendings], [
            "今天开会。第二件事讨论预算。",
            "最后确认排期。",
        ])
        self.assertTrue(all(message["V"].get("committed") is True for message in translations))
        self.assertEqual(
            [message["V"]["sentence_id"] for message in pendings],
            [message["V"]["sentence_id"] for message in translations],
        )

    def test_meeting_notes_stable_segment_text_prevents_old_sentence_retranslation(self):
        class FakeStreamingSession:
            def __init__(self):
                self.outputs = [
                    ("Your time is limited.", "Your time is limited."),
                    (
                        "Your time is limited. so don't waste it living someone else's life.",
                        "so don't waste it living someone else's life.",
                    ),
                ]

            def append_pcm16(self, _chunk):
                text, segment_text = self.outputs.pop(0)
                return [
                    type(
                        "StreamingResult",
                        (),
                        {
                            "text": text,
                            "segment_text": segment_text,
                            "stable": True,
                            "is_partial": False,
                            "utterance_index": 1,
                            "asr_latency_ms": 12,
                        },
                    )()
                ]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "fr",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00"},
            {"type": "websocket.receive", "bytes": b"\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.side_effect = lambda raw_text, mode, context, parameters: f"translated: {raw_text}"
            asyncio.run(ws_voice_flow(websocket))

        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        self.assertEqual(len(translations), 1)
        self.assertEqual(
            translations[0]["V"]["source_text"],
            "Your time is limited. so don't waste it living someone else's life.",
        )
        self.assertEqual(translations[0]["V"]["target_language"], "fr")
        self.assertEqual(translations[0]["V"]["sentence_index"], 1)
        refine.assert_called_once()

    def test_meeting_notes_multilingual_sources_use_natural_sentence_groups(self):
        websocket = FakeWebSocket([])
        translator = MeetingRealtimeTranslator(websocket)
        translator.reset(
            "audio-1",
            "meeting_notes",
            {},
            {"meeting_translation_target_language": "de"},
        )

        async def run_multilingual_scenario():
            await translator.observe_transcription(
                "今日は会議を始めます。そして予算を確認します。",
                1,
                stable=True,
                segment_text="今日は会議を始めます。そして予算を確認します。",
            )
            await translator.observe_transcription(
                "Revisamos el presupuesto y luego confirmamos la agenda.",
                2,
                stable=True,
                segment_text="Revisamos el presupuesto y luego confirmamos la agenda.",
            )
            await translator.observe_transcription(
                "نراجع الميزانية ثم نؤكد الخطة؟",
                3,
                stable=True,
                segment_text="نراجع الميزانية ثم نؤكد الخطة؟",
            )
            await translator.drain()

        with patch("main.refine_text", new_callable=AsyncMock) as refine:
            refine.side_effect = lambda raw_text, mode, context, parameters: f"translated: {raw_text}"
            asyncio.run(run_multilingual_scenario())

        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        self.assertEqual([message["V"]["source_text"] for message in translations], [
            "今日は会議を始めます。そして予算を確認します。",
            "Revisamos el presupuesto y luego confirmamos la agenda.",
            "نراجع الميزانية ثم نؤكد الخطة؟",
        ])
        self.assertTrue(all(message["V"]["target_language"] == "de" for message in translations))
        self.assertEqual(len({message["V"]["sentence_id"] for message in translations}), 3)
        translator.cancel()

    def test_meeting_notes_partial_transcription_emits_provisional_preview_then_stable_update(self):
        websocket = FakeWebSocket([])
        translator = MeetingRealtimeTranslator(websocket)
        translator.reset(
            "audio-1",
            "meeting_notes",
            {},
            {"meeting_translation_target_language": "zh"},
        )

        async def run_preview_scenario():
            await translator.observe_transcription(
                "Your time is limited",
                1,
                stable=False,
                segment_text="Your time",
            )
            if translator.preview_task:
                with contextlib.suppress(asyncio.CancelledError):
                    await translator.preview_task
            await translator.observe_transcription(
                "Your time is limited.",
                2,
                stable=True,
                segment_text="is limited.",
            )
            await translator.drain()

        with patch("main.MEETING_REALTIME_PREVIEW_DEBOUNCE_SECONDS", 0), patch(
            "main.MEETING_REALTIME_PREVIEW_MIN_INTERVAL_SECONDS",
            0,
        ), patch("main.translate_realtime_preview", new_callable=AsyncMock) as preview, patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            preview.return_value = {
                "text": "你的时间",
                "translation_engine": "local_hy_mt",
                "translation_latency_ms": 120,
                "local_model_status": "ready",
            }
            refine.return_value = "你的时间有限。"
            asyncio.run(run_preview_scenario())

        pendings = [message for message in websocket.sent_messages if message["K"] == "meeting_translation_pending"]
        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        preview_translation = next(message for message in translations if message["V"].get("provisional") is True)
        stable_translation = next(message for message in translations if message["V"].get("committed") is True)
        self.assertEqual(preview_translation["V"]["text"], "你的时间")
        self.assertFalse(preview_translation["V"]["stable"])
        self.assertFalse(preview_translation["V"]["committed"])
        self.assertEqual(preview_translation["V"]["phase"], "preview")
        self.assertFalse(preview_translation["V"]["source_stable"])
        self.assertEqual(stable_translation["V"]["text"], "你的时间有限。")
        self.assertTrue(stable_translation["V"]["stable"])
        self.assertEqual(stable_translation["V"]["phase"], "commit")
        self.assertTrue(stable_translation["V"]["source_stable"])
        self.assertEqual(preview_translation["V"]["sentence_id"], stable_translation["V"]["sentence_id"])
        self.assertEqual(pendings[0]["V"]["sentence_id"], stable_translation["V"]["sentence_id"])
        translator.cancel()

    def test_meeting_notes_unpunctuated_cumulative_asr_commits_latest_tail_once(self):
        class FakeStreamingSession:
            def __init__(self):
                self.outputs = ["你好", "你好你叫", "你好你叫什么名字"]

            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": self.outputs.pop(0)})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00"},
            {"type": "websocket.receive", "bytes": b"\x02\x00"},
            {"type": "websocket.receive", "bytes": b"\x03\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "Hello, what is your name?"
            asyncio.run(ws_voice_flow(websocket))

        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        self.assertEqual(len(translations), 1)
        self.assertEqual(translations[0]["V"]["source_text"], "你好你叫什么名字")
        self.assertEqual(translations[0]["V"]["chunk_index"], 1)

    def test_meeting_notes_stable_unpunctuated_clause_commits_with_local_agreement(self):
        class FakeStreamingSession:
            def __init__(self):
                self.outputs = ["we need confirm budget plan", "we need confirm budget plan"]

            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": self.outputs.pop(0)})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                        "meeting_realtime_profile": "frontier_simulst",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00"},
            {"type": "websocket.receive", "bytes": b"\x02\x00"},
        ])

        with patch("main.MEETING_REALTIME_STABLE_FAST_COMMIT_SECONDS", 0), patch(
            "main.create_streaming_asr_session",
            return_value=FakeStreamingSession(),
        ), patch("main.refine_text", new_callable=AsyncMock) as refine:
            refine.return_value = "We need to confirm the budget plan."
            asyncio.run(ws_voice_flow(websocket))

        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        self.assertEqual(len(translations), 1)
        self.assertEqual(translations[0]["V"]["source_text"], "we need confirm budget plan")
        self.assertEqual(translations[0]["V"]["chunk_index"], 1)
        self.assertEqual(translations[0]["V"]["realtime_profile"], "frontier_simulst")
        refine.assert_called_once()

    def test_meeting_notes_unfinished_connector_tail_does_not_fragment_translate(self):
        class FakeStreamingSession:
            def __init__(self):
                self.outputs = ["we need to", "we need to"]

            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": self.outputs.pop(0)})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00"},
            {"type": "websocket.receive", "bytes": b"\x02\x00"},
        ])

        with patch("main.MEETING_REALTIME_STABLE_FAST_COMMIT_SECONDS", 0), patch(
            "main.create_streaming_asr_session",
            return_value=FakeStreamingSession(),
        ), patch("main.refine_text", new_callable=AsyncMock) as refine:
            asyncio.run(ws_voice_flow(websocket))

        message_types = [message["K"] for message in websocket.sent_messages]
        self.assertNotIn("meeting_translation_pending", message_types)
        self.assertNotIn("meeting_translation", message_types)
        refine.assert_not_called()

    def test_meeting_notes_short_punctuated_fragments_are_merged_before_translation(self):
        class FakeStreamingSession:
            def __init__(self):
                self.outputs = [
                    "针对本。",
                    "针对本。项目任务我们的。",
                ]

            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": self.outputs.pop(0)})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00"},
            {"type": "websocket.receive", "bytes": b"\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "For this project task of ours."
            asyncio.run(ws_voice_flow(websocket))

        translations = [message for message in websocket.sent_messages if message["K"] == "meeting_translation"]
        self.assertEqual(len(translations), 1)
        self.assertEqual(translations[0]["V"]["source_text"], "针对本。项目任务我们的。")
        refine.assert_called_once()

    def test_meeting_notes_realtime_translation_skips_meaningless_fragments(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "\U0001f600"})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            asyncio.run(ws_voice_flow(websocket))

        self.assertNotIn("meeting_translation_pending", [message["K"] for message in websocket.sent_messages])
        self.assertNotIn("meeting_translation", [message["K"] for message in websocket.sent_messages])
        refine.assert_not_called()

    def test_meeting_notes_realtime_translation_strips_emoji_from_source_and_output(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "Hello \U0001f600."})()]

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.return_value = "Hello \U0001f642"
            asyncio.run(ws_voice_flow(websocket))

        translation = next(message for message in websocket.sent_messages if message["K"] == "meeting_translation")
        self.assertNotIn("\U0001f600", translation["V"]["source_text"])
        self.assertNotIn("\U0001f642", translation["V"]["text"])
        self.assertTrue(translation["V"]["committed"])

    def test_meeting_notes_end_audio_uses_final_text_for_final_translation(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "临时重复片段"})()]

            def finalize(self):
                return type("StreamingResult", (), {"text": "最终干净转写"})()

        async def refine_side_effect(raw_text, mode, context, parameters):
            if mode == "meeting_notes":
                return f"final notes: {raw_text}"
            if mode == "translation":
                return f"final translation: {raw_text}"
            return raw_text

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {
                        "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
                        "meeting_translation_target_language": "en",
                    },
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
            {
                "type": "websocket.receive",
                "text": json.dumps({"type": "end_audio", "audio_id": "audio-1"}),
            },
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            new_callable=AsyncMock,
        ) as refine:
            refine.side_effect = refine_side_effect
            asyncio.run(ws_voice_flow(websocket))

        completed = next(message for message in websocket.sent_messages if message["K"] == "refine_completed")
        self.assertEqual(completed["V"]["refined_text"], "final notes: 最终干净转写")
        self.assertEqual(completed["V"]["translation_text"], "final translation: 最终干净转写")

        self.assertEqual(completed["V"]["meeting_structured"]["version"], 1)
        self.assertGreaterEqual(len(completed["V"]["meeting_structured"]["transcriptSegments"]), 1)

    def test_streaming_model_end_audio_refines_accumulated_text_without_whole_file_asr(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return [type("StreamingResult", (), {"text": "你"})()]

            def finalize(self):
                return type("StreamingResult", (), {"text": "你好"})()

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {"audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1}},
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
            {"type": "websocket.receive", "text": json.dumps({"type": "end_audio", "audio_id": "audio-1"})},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.transcribe_audio_with_wav_conversion",
            new_callable=AsyncMock,
        ) as whole_file_asr, patch("main.refine_text", return_value="你好，世界") as refine:
            asyncio.run(ws_voice_flow(websocket))

        whole_file_asr.assert_not_called()
        refine.assert_called_once_with(raw_text="你好", mode="transcript", context={}, parameters={
            "audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1},
        })
        completion = websocket.sent_messages[-1]
        self.assertEqual(completion["K"], "audio_processing_completed")
        self.assertEqual(completion["V"]["refined_text"], "你好，世界")

    def test_end_audio_parameters_merge_audio_quality_before_refine(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return []

            def finalize(self):
                return type("StreamingResult", (), {"text": "我明天要去公司然后见王总"})()

        audio_format = {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1}
        audio_quality = {
            "average_rms": 0.012,
            "peak": 0.2,
            "clipping_ratio": 0,
            "speech_frame_ratio": 0.2,
            "low_volume_ratio": 0.8,
            "estimated_noise_floor": 0.02,
            "hints": ["low_volume", "likely_noisy"],
        }
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {"audio_format": audio_format},
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "end_audio",
                    "audio_id": "audio-1",
                    "parameters": {"audio_quality": audio_quality},
                }),
            },
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            return_value="整理后的任务",
        ) as refine:
            asyncio.run(ws_voice_flow(websocket))

        refine.assert_called_once_with(
            raw_text="我明天要去公司然后见王总",
            mode="transcript",
            context={},
            parameters={
                "audio_format": audio_format,
                "audio_quality": audio_quality,
            },
        )

    def test_meeting_notes_streaming_refine_failure_returns_partial_success(self):
        class FakeStreamingSession:
            def append_pcm16(self, _chunk):
                return []

            def finalize(self):
                return type("StreamingResult", (), {"text": "Alice will send the report tomorrow."})()

        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": {},
                    "parameters": {"audio_format": {"type": "pcm_s16le", "sample_rate": 16000, "channels": 1}},
                }),
            },
            {"type": "websocket.receive", "bytes": b"\x01\x00\x02\x00"},
            {"type": "websocket.receive", "text": json.dumps({"type": "end_audio", "audio_id": "audio-1"})},
        ])

        with patch("main.create_streaming_asr_session", return_value=FakeStreamingSession()), patch(
            "main.refine_text",
            side_effect=RuntimeError("llm boom"),
        ):
            asyncio.run(ws_voice_flow(websocket))

        completion = next(message for message in websocket.sent_messages if message["K"] == "refine_completed")
        self.assertEqual(completion["V"]["user_prompt"], "Alice will send the report tomorrow.")
        self.assertEqual(completion["V"]["partial_success"], True)
        self.assertEqual(completion["V"]["summary_error"], "llm boom")
        self.assertNotIn("translation_text", completion["V"])
        self.assertIn("逐字稿", completion["V"]["refined_text"])

    def test_refine_failure_emits_audio_processing_error(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": {},
                    "parameters": {},
                }),
            },
            {
                "type": "websocket.receive",
                "bytes": b"RIFF\x24\x80\x00\x00",
            },
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "end_audio",
                    "audio_id": "audio-1",
                }),
            },
        ])

        with patch("main.transcribe_audio_with_wav_conversion", return_value="hello"), patch(
            "main.refine_text",
            side_effect=RuntimeError("boom"),
        ):
            asyncio.run(ws_voice_flow(websocket))

        self.assertEqual(websocket.sent_messages[-1]["K"], "audio_processing_error")
        self.assertEqual(websocket.sent_messages[-1]["V"]["detail"], "boom")

    def test_start_audio_with_selected_text_echoes_process_mode_parameters(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "ask_anything",
                    "audio_context": {},
                    "parameters": {"selected_text": "被选中的代码"},
                }),
            },
        ])

        asyncio.run(ws_voice_flow(websocket))

        process_mode = next(message for message in websocket.sent_messages if message["K"] == "process_mode")
        self.assertEqual(process_mode["V"]["parameters"], {"selected_text": "被选中的代码"})

    def test_invalid_json_message_emits_error_without_crashing(self):
        websocket = FakeWebSocket([
            {"type": "websocket.receive", "text": "not-json"},
            {"type": "websocket.receive", "text": json.dumps({"type": "ping"})},
        ])

        asyncio.run(ws_voice_flow(websocket))

        self.assertEqual(websocket.sent_messages[0]["K"], "error")
        self.assertEqual(websocket.sent_messages[0]["V"]["code"], "invalid_json")
        self.assertEqual(websocket.sent_messages[1]["K"], "pong")

    def test_start_audio_ignores_non_object_parameters(self):
        websocket = FakeWebSocket([
            {
                "type": "websocket.receive",
                "text": json.dumps({
                    "type": "start_audio",
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": "bad-context",
                    "parameters": "bad-parameters",
                }),
            },
            {"type": "websocket.receive", "bytes": b"RIFF\x24\x80\x00\x00"},
            {"type": "websocket.receive", "text": json.dumps({"type": "end_audio"})},
        ])

        with patch("main.transcribe_audio_with_wav_conversion", return_value="hello"), patch(
            "main.refine_text",
            return_value="hello refined",
        ) as refine_text:
            asyncio.run(ws_voice_flow(websocket))

        process_mode = next(message for message in websocket.sent_messages if message["K"] == "process_mode")
        self.assertEqual(process_mode["V"]["parameters"], {})
        refine_text.assert_called_once_with(
            raw_text="hello",
            mode="transcript",
            context={},
            parameters={},
        )


if __name__ == "__main__":
    unittest.main()
