import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi import WebSocketDisconnect

from main import ws_voice_flow


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


if __name__ == "__main__":
    unittest.main()
