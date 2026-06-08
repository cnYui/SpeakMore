import unittest
import threading
import time
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class VoiceFlowContractTest(unittest.TestCase):
    def create_ready_app(self):
        self.assertTrue(hasattr(main, "create_app"), "main.create_app 尚未实现")
        return main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None, auto_preload_model=True)

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
            main.create_app(preload_model=slow_preload, exit_scheduler=lambda _code: None, auto_preload_model=True)
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

    def test_voice_flow_normalizes_non_object_json_fields(self):
        app = self.create_ready_app()

        with patch("main.transcribe_audio_with_wav_conversion", return_value="hello"), patch(
            "main.refine_text",
            return_value="hello refined",
        ) as refine_text, TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": "[]",
                    "audio_metadata": "{}",
                    "parameters": '"bad-parameters"',
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("sample.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["refine_text"], "hello refined")
        refine_text.assert_called_once_with(
            raw_text="hello",
            mode="transcript",
            context={},
            parameters={},
        )

    def test_voice_flow_normalizes_invalid_json_fields(self):
        app = self.create_ready_app()

        with patch("main.transcribe_audio_with_wav_conversion", return_value="hello"), patch(
            "main.refine_text",
            return_value="hello refined",
        ) as refine_text, TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "transcript",
                    "audio_context": "{bad-json",
                    "audio_metadata": "{}",
                    "parameters": "{bad-json",
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("sample.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["refine_text"], "hello refined")
        refine_text.assert_called_once_with(
            raw_text="hello",
            mode="transcript",
            context={},
            parameters={},
        )

    def test_text_flow_endpoint_is_removed(self):
        app = self.create_ready_app()

        with TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/text_flow",
                json={"mode": "translation", "text": "你好", "parameters": {"output_language": "en"}},
            )

        self.assertEqual(response.status_code, 404)

    def test_text_refine_success_payload_uses_existing_refiner(self):
        app = self.create_ready_app()

        with patch("main.refine_text", return_value="hello refined") as refine_text, TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/text_refine",
                json={
                    "text": "hello",
                    "mode": "transcript",
                    "audio_context": {"source": "history_retry"},
                    "parameters": {"llm": {"provider_id": "deepseek"}},
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["refine_text"], "hello refined")
        self.assertEqual(payload["user_prompt"], "hello")
        refine_text.assert_called_once_with(
            raw_text="hello",
            mode="transcript",
            context={"source": "history_retry"},
            parameters={"llm": {"provider_id": "deepseek"}},
        )

    def test_text_refine_rejects_empty_text(self):
        app = self.create_ready_app()

        with TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post("/ai/text_refine", json={"text": "   ", "mode": "transcript"})

        self.assertEqual(response.status_code, 400)

    def test_text_refine_error_payload_includes_detail_and_code(self):
        app = self.create_ready_app()

        with patch("main.refine_text", side_effect=RuntimeError("llm boom")), TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post("/ai/text_refine", json={"text": "hello", "mode": "transcript"})

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["detail"], "llm boom")
        self.assertEqual(payload["code"], "text_refine_failed")
        self.assertEqual(payload["user_prompt"], "hello")

    def test_meeting_notes_refine_failure_keeps_transcript_as_partial_success(self):
        app = self.create_ready_app()

        with patch("main.transcribe_audio_with_wav_conversion", return_value="Alice will send the report tomorrow."), patch(
            "main.refine_text",
            side_effect=RuntimeError("llm boom"),
        ), TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": "{}",
                    "audio_metadata": "{}",
                    "parameters": '{"import_source":"meeting_media","meeting_notes_quality_profile":"frontier_minutes","meeting_notes_pipeline":"extractive_then_synthesize","meeting_module":"import_file","meeting_capture_profile":"imported_media","import_processing_profile":"frontier_import","meeting_scenario_coverage":"meeting,class,interview,customer_call,project_sync,training,retrospective,brainstorm,task_plan,voice_memo,field_notes","meeting_output_depth":"comprehensive_minutes_with_transcript_fallback"}',
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("meeting.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        payload = body["data"]
        self.assertEqual(body["status"], "OK")
        self.assertEqual(payload["user_prompt"], "Alice will send the report tomorrow.")
        self.assertEqual(payload["partial_success"], True)
        self.assertEqual(payload["summary_error"], "llm boom")
        self.assertEqual(payload["translation_text"], "")
        self.assertEqual(payload["meeting_structured"]["partialSuccess"], True)
        self.assertGreaterEqual(len(payload["meeting_structured"]["transcriptSegments"]), 1)
        self.assertIn("逐字稿", payload["refine_text"])

    def test_meeting_notes_success_payload_includes_structured_result(self):
        app = self.create_ready_app()
        transcript = "今天讨论项目排期。Alice 明天发送报告。风险是预算还没有确认。"

        with patch("main.transcribe_audio_with_wav_conversion", return_value=transcript), patch(
            "main.refine_text",
            return_value="会议摘要\n- Alice 明天发送报告\n- 风险是预算还没有确认",
        ), TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": "{}",
                    "audio_metadata": "{}",
                    "parameters": '{"meeting_notes_quality_profile":"frontier_minutes","meeting_module":"new_note"}',
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("meeting.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        structured = payload["meeting_structured"]
        self.assertEqual(payload["refine_text"], "会议摘要\n- Alice 明天发送报告\n- 风险是预算还没有确认")
        self.assertEqual(structured["version"], 1)
        self.assertEqual(structured["source"], "recording")
        self.assertGreaterEqual(len(structured["transcriptSegments"]), 2)
        self.assertTrue(any("Alice" in item["text"] for item in structured["actionItems"]))
        self.assertTrue(any("预算" in item["text"] for item in structured["risks"]))

    def test_meeting_import_long_transcript_uses_chunk_summaries_then_merge(self):
        app = self.create_ready_app()
        transcript = "第一段讨论预算，Alice 明天发送报告。第二段确认排期，下周继续跟进。第三段风险是资源不足。" * 320

        async def refine_side_effect(raw_text, mode, context=None, parameters=None):
            if parameters and parameters.get("meeting_chunk_summary"):
                return f"chunk {parameters.get('meeting_chunk_index')} summary"
            if parameters and parameters.get("meeting_chunk_merge"):
                return "merged final meeting notes"
            return "single meeting notes"

        with patch("main.transcribe_audio_with_wav_conversion", return_value=transcript), patch(
            "main.refine_text",
            side_effect=refine_side_effect,
        ) as refine_text, TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": '{"import_source":"meeting_media","meeting_module":"import_file","meeting_capture_profile":"imported_media"}',
                    "audio_metadata": "{}",
                    "parameters": '{"import_source":"meeting_media","meeting_notes_quality_profile":"frontier_minutes","meeting_notes_pipeline":"extractive_then_synthesize","meeting_module":"import_file","meeting_capture_profile":"imported_media","import_processing_profile":"frontier_import"}',
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("meeting.wav", b"RIFF0000", "audio/wav")},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        chunk_calls = [
            call for call in refine_text.call_args_list
            if call.kwargs["parameters"].get("meeting_chunk_summary")
        ]
        merge_calls = [
            call for call in refine_text.call_args_list
            if call.kwargs["parameters"].get("meeting_chunk_merge")
        ]
        self.assertGreaterEqual(len(chunk_calls), 2)
        self.assertEqual(len(merge_calls), 1)
        self.assertEqual(payload["refine_text"], "merged final meeting notes")
        self.assertEqual(payload["meeting_import_chunked"], True)
        self.assertEqual(payload["meeting_import_chunk_count"], len(chunk_calls))
        self.assertEqual(payload["meeting_structured"]["source"], "import")

    def test_meeting_transcript_segmentation_returns_multiple_segments(self):
        segments = main.build_meeting_transcript_segments("今天讨论预算。明天 Alice 发送报告。下周继续跟进排期。")

        self.assertGreaterEqual(len(segments), 3)
        self.assertEqual(segments[0]["index"], 1)
        self.assertIn("今天", segments[0]["text"])

    def test_voice_flow_rejects_unsupported_media_extension(self):
        app = self.create_ready_app()

        with TestClient(app) as client:
            self.wait_until_ready(client)
            response = client.post(
                "/ai/voice_flow",
                data={
                    "audio_id": "audio-1",
                    "mode": "meeting_notes",
                    "audio_context": "{}",
                    "audio_metadata": "{}",
                    "parameters": "{}",
                    "is_retry": "false",
                    "device_name": "mic",
                    "user_over_time": "12",
                    "send_time": "123456",
                },
                files={"audio_file": ("sample.txt", b"hello", "text/plain")},
            )

        self.assertEqual(response.status_code, 415)

    def test_save_upload_to_temp_file_enforces_one_gb_limit(self):
        class FakeUpload:
            filename = "meeting.wav"

            def __init__(self):
                self.calls = 0

            async def read(self, _size):
                self.calls += 1
                if self.calls == 1:
                    return b"aa"
                if self.calls == 2:
                    return b"aa"
                return b""

        async def run_case():
            return await main.save_upload_to_temp_file(FakeUpload(), ".wav")

        with patch("main.MAX_UPLOAD_AUDIO_BYTES", 3), self.assertRaises(main.HTTPException) as raised:
            import asyncio

            asyncio.run(run_case())

        self.assertEqual(raised.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
