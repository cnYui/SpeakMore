import asyncio
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import asr


class AsrRuntimeTest(unittest.TestCase):
    def setUp(self):
        asr._model = None

    def test_preload_asr_model_uses_sensevoice_model_id_by_default(self):
        fake_model = object()

        with patch("asr._load_streaming_asr_model", return_value=fake_model) as load_streaming:
            result = asr.preload_asr_model()

        self.assertIs(result, fake_model)
        load_streaming.assert_called_once_with()

    def test_download_source_downloads_to_managed_cache_during_model_build(self):
        observed = {}

        class FakeAutoModel:
            def __init__(self, **kwargs):
                observed["kwargs"] = kwargs

        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_dir = os.path.join(temp_dir, "models--FunAudioLLM--SenseVoiceSmall", "snapshots", "abc")
            source = asr.StreamingAsrModelSource(
                kind=asr.DOWNLOAD_SOURCE,
                model_ref="FunAudioLLM/SenseVoiceSmall",
                download_root=temp_dir,
            )
            fake_funasr = types.SimpleNamespace(AutoModel=FakeAutoModel)
            download_calls = []

            def fake_snapshot_download(model, cache_dir=None):
                download_calls.append({"model": model, "cache_dir": cache_dir})
                return snapshot_dir

            fake_huggingface_hub = types.SimpleNamespace(snapshot_download=fake_snapshot_download)

            with patch.dict(sys.modules, {"funasr": fake_funasr, "huggingface_hub": fake_huggingface_hub}), patch(
                "asr.resolve_funasr_device_selection",
                return_value=asr.FunasrDeviceSelection(device="cpu", requested_device="cpu", source="explicit"),
            ):
                asr.build_streaming_asr_model(source)

            self.assertEqual(download_calls, [{"model": "FunAudioLLM/SenseVoiceSmall", "cache_dir": temp_dir}])
            self.assertEqual(observed["kwargs"]["model"], snapshot_dir)
            self.assertEqual(observed["kwargs"]["hub"], "hf")
            self.assertEqual(observed["kwargs"]["device"], "cpu")

    def test_resolve_funasr_device_selection_prefers_mps_when_cuda_is_unavailable(self):
        with patch.dict(os.environ, {"FUNASR_DEVICE": "auto"}, clear=False), patch(
            "asr.is_cuda_available",
            return_value=False,
        ), patch("asr.is_mps_available", return_value=True):
            selection = asr.resolve_funasr_device_selection()

        self.assertEqual(selection.device, "mps")
        self.assertEqual(selection.requested_device, "auto")
        self.assertEqual(selection.source, "auto")
        self.assertIsNone(selection.fallback_reason)

    def test_resolve_funasr_device_selection_keeps_default_cpu_when_only_mps_is_available(self):
        with patch.dict(os.environ, {"FUNASR_DEVICE": ""}, clear=False), patch(
            "asr.is_cuda_available",
            return_value=False,
        ), patch("asr.is_mps_available", return_value=True):
            selection = asr.resolve_funasr_device_selection()

        self.assertEqual(selection.device, "cpu")
        self.assertEqual(selection.requested_device, "default")
        self.assertEqual(selection.source, "auto")
        self.assertIsNone(selection.fallback_reason)

    def test_resolve_funasr_device_selection_falls_back_when_explicit_mps_is_unavailable(self):
        with patch.dict(os.environ, {"FUNASR_DEVICE": "mps"}, clear=False), patch(
            "asr.is_mps_available",
            return_value=False,
        ):
            selection = asr.resolve_funasr_device_selection()

        self.assertEqual(selection.device, "cpu")
        self.assertEqual(selection.requested_device, "mps")
        self.assertEqual(selection.source, "explicit")
        self.assertEqual(selection.fallback_reason, "mps_unavailable")

    def test_build_streaming_asr_model_falls_back_to_cpu_when_mps_initialization_fails(self):
        calls = []

        class FakeAutoModel:
            def __init__(self, **kwargs):
                calls.append(kwargs["device"])
                if kwargs["device"] == "mps":
                    raise RuntimeError("missing mps op")

        source = asr.StreamingAsrModelSource(kind=asr.DIR_SOURCE, model_ref="/tmp/sensevoice")
        fake_funasr = types.SimpleNamespace(AutoModel=FakeAutoModel)

        with patch.dict(sys.modules, {"funasr": fake_funasr}), patch(
            "asr.resolve_funasr_device_selection",
            return_value=asr.FunasrDeviceSelection(device="mps", requested_device="mps", source="explicit"),
        ):
            runtime = asr.build_streaming_asr_model(source)

        self.assertEqual(calls, ["mps", "cpu"])
        self.assertEqual(runtime.device, "cpu")
        self.assertEqual(runtime.requested_device, "mps")
        self.assertEqual(runtime.device_source, "explicit")
        self.assertIn("mps_initialization_failed", runtime.device_fallback_reason)

    def test_download_source_passes_progress_tqdm_to_snapshot_download(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot_dir = os.path.join(temp_dir, "models--FunAudioLLM--SenseVoiceSmall", "snapshots", "abc")
            source = asr.StreamingAsrModelSource(
                kind=asr.DOWNLOAD_SOURCE,
                model_ref="FunAudioLLM/SenseVoiceSmall",
                download_root=temp_dir,
            )
            observed = {}

            def fake_snapshot_download(model, cache_dir=None, tqdm_class=None):
                observed["model"] = model
                observed["cache_dir"] = cache_dir
                observed["tqdm_class"] = tqdm_class
                return snapshot_dir

            fake_huggingface_hub = types.SimpleNamespace(snapshot_download=fake_snapshot_download)

            with patch.dict(sys.modules, {"huggingface_hub": fake_huggingface_hub}):
                result = asr.resolve_model_ref_for_build(source, download_progress_callback=lambda progress: None)

            self.assertEqual(result, snapshot_dir)
            self.assertEqual(observed["model"], "FunAudioLLM/SenseVoiceSmall")
            self.assertEqual(observed["cache_dir"], temp_dir)
            self.assertTrue(callable(observed["tqdm_class"]))

    def test_sensevoice_runtime_generates_incremental_audio_and_final_full_audio(self):
        calls = []

        class FakeModel:
            def generate(self, **kwargs):
                calls.append(kwargs)
                return [{"text": f"<|zh|><|NEUTRAL|><|Speech|><|withitn|>累计{len(kwargs['input'])}"}]

        runtime = asr.StreamingAsrRuntime(
            model=FakeModel(),
            model_id=asr.SENSEVOICE_SMALL_MODEL_ID,
            chunk_ms=2,
            accumulate_audio=False,
            keep_full_audio_for_final=True,
            generate_options={"language": "auto", "use_itn": True, "ban_emo_unk": False},
            postprocess="rich_transcription",
        )
        session = asr.StreamingAsrSession(runtime, sample_rate=1000, chunk_ms=2)

        first = session.append_pcm16(b"\x01\x00\x02\x00")
        second = session.append_pcm16(b"\x03\x00\x04\x00")
        final = session.finalize()

        self.assertEqual(first[-1].text, "累计2")
        self.assertEqual(second[-1].text, first[-1].text)
        self.assertEqual(final.text, "累计4")
        self.assertEqual([len(call["input"]) for call in calls], [2, 2, 4])

    def test_meeting_endpoint_detector_skips_silence_and_flushes_on_pause(self):
        detector = asr.MeetingEndpointDetector(
            sample_rate=1000,
            frame_ms=20,
            preroll_ms=20,
            min_speech_ms=40,
            end_silence_ms=40,
            partial_ms=60,
            max_segment_ms=200,
        )

        def frame(level):
            sample = int(max(-1, min(1, level)) * 32767)
            return sample.to_bytes(2, byteorder="little", signed=True) * 20

        events = []
        events.extend(detector.append_pcm16(frame(0) * 2))
        events.extend(detector.append_pcm16(frame(0.18) * 3))
        events.extend(detector.append_pcm16(frame(0) * 2))

        self.assertTrue(any(not event.stable and event.reason == "partial" for event in events))
        stable_events = [event for event in events if event.stable]
        self.assertEqual(len(stable_events), 1)
        self.assertEqual(stable_events[0].reason, "silence")
        self.assertEqual(stable_events[0].utterance_index, 1)

    def test_join_asr_text_preserves_cjk_and_spaces_english_words(self):
        self.assertEqual(asr.join_asr_text("hello", "world"), "hello world")
        self.assertEqual(asr.join_asr_text("会议", "开始"), "会议开始")

    def test_meeting_realtime_pipeline_keeps_stable_prefix_and_replaces_partial_tail(self):
        pipeline = asr.MeetingRealtimePipeline(
            sample_rate=1000,
            session_factory=lambda sample_rate: object(),
        )

        first = pipeline._decorate_result(asr.StreamingAsrResult(
            text="We need confirm",
            segment_text="confirm",
            stable_text="We need",
            partial_text="confirm",
            stable=False,
            is_partial=True,
            utterance_index=1,
        ))
        second = pipeline._decorate_result(asr.StreamingAsrResult(
            text="We need confirm budget",
            segment_text="confirm budget",
            stable_text="We need",
            partial_text="confirm budget",
            stable=False,
            is_partial=True,
            utterance_index=1,
        ))
        rollback = pipeline._decorate_result(asr.StreamingAsrResult(
            text="We",
            segment_text="",
            stable=True,
            is_partial=False,
            utterance_index=1,
        ))

        self.assertEqual(first.stable_text, "We need")
        self.assertEqual(first.partial_text, "confirm")
        self.assertEqual(first.text, "We need confirm")
        self.assertEqual(second.stable_text, "We need")
        self.assertEqual(second.partial_text, "confirm budget")
        self.assertEqual(second.text, "We need confirm budget")
        self.assertEqual(rollback.stable_text, "We need")
        self.assertEqual(rollback.partial_text, "")
        self.assertEqual(rollback.text, "We need")

    def test_meeting_realtime_pipeline_promotes_local_agreement_prefix(self):
        pipeline = asr.MeetingRealtimePipeline(
            sample_rate=1000,
            session_factory=lambda sample_rate: object(),
        )

        first = pipeline._decorate_result(asr.StreamingAsrResult(
            text="We need confirm budget",
            segment_text="",
            stable=False,
            is_partial=True,
            utterance_index=1,
        ))
        second = pipeline._decorate_result(asr.StreamingAsrResult(
            text="We need confirm timeline",
            segment_text="",
            stable=False,
            is_partial=True,
            utterance_index=1,
        ))

        self.assertEqual(first.stable_text, "")
        self.assertEqual(first.text, "We need confirm budget")
        self.assertEqual(second.stable_text, "We need confirm")
        self.assertEqual(second.partial_text, "timeline")
        self.assertEqual(second.text, "We need confirm timeline")

    def test_transcribe_audio_uses_pcm16_streaming_session(self):
        fake_runtime = asr.StreamingAsrRuntime(
            model=object(),
            chunk_size=[0, 10, 5],
            encoder_chunk_look_back=4,
            decoder_chunk_look_back=1,
        )

        class FakeSession:
            chunk_bytes = 2

            def __init__(self):
                self.chunks = []

            def append_pcm16(self, chunk):
                self.chunks.append(chunk)
                return []

            def finalize(self):
                return asr.StreamingAsrResult(text="你好")

        fake_session = FakeSession()

        with patch("asr._get_model", return_value=fake_runtime), patch(
            "asr.create_streaming_asr_session",
            return_value=fake_session,
        ), patch(
            "asr.iter_audio_file_pcm16_chunks",
            return_value=[b"\x01\x00", b"\x02\x00"],
        ):
            result = asyncio.run(asr.transcribe_audio("audio.wav"))

        self.assertEqual(result, "你好")
        self.assertEqual(b"".join(fake_session.chunks), b"\x01\x00\x02\x00")


if __name__ == "__main__":
    unittest.main()
