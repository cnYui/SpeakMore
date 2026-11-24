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

    def test_sensevoice_runtime_generates_from_accumulated_audio(self):
        calls = []

        class FakeModel:
            def generate(self, **kwargs):
                calls.append(kwargs)
                return [{"text": f"<|zh|><|NEUTRAL|><|Speech|><|withitn|>累计{len(kwargs['input'])}"}]

        runtime = asr.StreamingAsrRuntime(
            model=FakeModel(),
            model_id=asr.SENSEVOICE_SMALL_MODEL_ID,
            chunk_ms=2,
            accumulate_audio=True,
            generate_options={"language": "auto", "use_itn": True, "ban_emo_unk": False},
            postprocess="rich_transcription",
        )
        # 固定时钟：这个测试只看累计识别的语义，不看“识别变慢就拉长间隔”。
        session = asr.StreamingAsrSession(runtime, sample_rate=1000, chunk_ms=2, clock=lambda: 0.0)

        first = session.append_pcm16(b"\x01\x00\x02\x00")
        second = session.append_pcm16(b"\x03\x00\x04\x00")
        final = session.finalize()

        self.assertEqual(first[-1].text, "累计2")
        self.assertEqual(second[-1].text, "累计4")
        self.assertEqual(final.text, "累计4")
        self.assertEqual([len(call["input"]) for call in calls], [2, 4, 4])

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
            "asr.subprocess.run",
            return_value=type("CompletedProcess", (), {"stdout": b"\x01\x00\x02\x00"})(),
        ):
            result = asyncio.run(asr.transcribe_audio("audio.wav"))

        self.assertEqual(result, "你好")
        self.assertEqual(b"".join(fake_session.chunks), b"\x01\x00\x02\x00")


if __name__ == "__main__":
    unittest.main()
