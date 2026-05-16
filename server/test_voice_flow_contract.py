import unittest
import threading
import time
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class VoiceFlowContractTest(unittest.TestCase):
    def create_ready_app(self):
        self.assertTrue(hasattr(main, "create_app"), "main.create_app 尚未实现")
        return main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

    def wait_until_ready(self, client: TestClient):
        for _ in range(20):
            ready = client.get("/ready")
            if ready.status_code == 200:
                return
            time.sleep(0.01)
        self.fail("测试应用未能进入 ready 状态")

    def test_ready_endpoint_returns_503_before_backend_runtime_is_ready(self):
        release = threading.Event()

        def slow_preload():
            release.wait(1)

        app = (
            main.create_app(preload_model=slow_preload, exit_scheduler=lambda _code: None)
            if hasattr(main, "create_app")
            else main.app
        )

        with TestClient(app) as client:
            response = client.get("/ready")

        release.set()
        self.assertEqual(response.status_code, 503)

    def test_voice_flow_success_payload_includes_web_metadata_and_external_action(self):
        app = self.create_ready_app()

        with patch("main.transcribe_audio_with_wav_conversion", return_value="hello"), patch(
            "main.refine_text",
            return_value="hello refined",
        ), TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": "{}",
                    "audio_metadata": "{}",
                    "parameters": "{}",
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("sample.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertIn("web_metadata", payload)
        self.assertIn("external_action", payload)

    def test_voice_flow_error_payload_includes_detail_and_code(self):
        app = self.create_ready_app()

        with patch("main.transcribe_audio_with_wav_conversion", side_effect=RuntimeError("boom")), TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": "{}",
                    "audio_metadata": "{}",
                    "parameters": "{}",
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("sample.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["detail"], "boom")
        self.assertEqual(payload["code"], "voice_flow_failed")

    def test_text_flow_translation_uses_text_and_output_language(self):
        app = self.create_ready_app()

        with patch("main.refine_text", return_value="hello translated") as refine_text, TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/text_flow",
                json={
                    "mode": "translation",
                    "text": "你好",
                    "parameters": {"output_language": "en"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["refine_text"], "hello translated")
        refine_text.assert_called_once_with(
            raw_text="你好",
            mode="translation",
            context={},
            parameters={"output_language": "en"},
        )

    def test_text_flow_requires_ready_backend(self):
        release = threading.Event()

        def slow_preload():
            release.wait(1)

        app = main.create_app(preload_model=slow_preload, exit_scheduler=lambda _code: None)

        with TestClient(app) as client:
            response = client.post(
                "/ai/text_flow",
                json={"mode": "translation", "text": "你好", "parameters": {"output_language": "en"}},
            )

        release.set()
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
