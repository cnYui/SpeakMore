"""PyTorch 版和 int8 ONNX 版 SenseVoiceSmall 并存：注册表、切换、只下载和 sherpa-onnx 推理。"""

import json
import os
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import asr
import main
import model_manager
from model_manager import (
    SENSEVOICE_SMALL_INT8_MODEL_ID,
    SENSEVOICE_SMALL_INT8_REPO_ID,
    SENSEVOICE_SMALL_MODEL_ID,
    repo_cache_dir_name,
)

ROOT = Path(__file__).resolve().parents[1]


def create_int8_snapshot(cache_root: Path) -> Path:
    snapshot_dir = cache_root / repo_cache_dir_name(SENSEVOICE_SMALL_INT8_REPO_ID) / "snapshots" / "int8"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "model.int8.onnx").write_bytes(b"onnx")
    (snapshot_dir / "tokens.txt").write_text("<blk> 0", encoding="utf-8")
    return snapshot_dir


class AsrModelRegistryTest(unittest.TestCase):
    def setUp(self):
        model_manager.reset_active_asr_model_id()

    def tearDown(self):
        model_manager.reset_active_asr_model_id()

    def test_shared_metadata_matches_backend_registry(self):
        items = json.loads((ROOT / "shared" / "asr-models.json").read_text(encoding="utf-8"))

        self.assertEqual([item["id"] for item in items], list(model_manager.SUPPORTED_ASR_MODEL_IDS))
        for item in items:
            self.assertEqual(item["repoId"], model_manager.get_model_repo_id(item["id"]))
            self.assertEqual(item["runtime"], model_manager.get_model_runtime(item["id"]))
            self.assertGreater(item["sizeBytes"], 0)
        self.assertEqual([item["id"] for item in items if item.get("default")], [model_manager.DEFAULT_MODEL_ID])

    def test_active_model_comes_from_env_then_runtime_switch(self):
        with patch.dict(os.environ, {"SPEAKMORE_ASR_MODEL_ID": SENSEVOICE_SMALL_INT8_MODEL_ID}, clear=False):
            self.assertEqual(model_manager.get_active_asr_model_id(), SENSEVOICE_SMALL_INT8_MODEL_ID)
            model_manager.set_active_asr_model_id(SENSEVOICE_SMALL_MODEL_ID)
            self.assertEqual(model_manager.get_active_asr_model_id(), SENSEVOICE_SMALL_MODEL_ID)

        with patch.dict(os.environ, {"SPEAKMORE_ASR_MODEL_ID": "unknown-model"}, clear=False):
            model_manager.reset_active_asr_model_id()
            self.assertEqual(model_manager.get_active_asr_model_id(), SENSEVOICE_SMALL_MODEL_ID)

        with self.assertRaises(ValueError):
            model_manager.set_active_asr_model_id("unknown-model")

    def test_int8_snapshot_is_detected_in_managed_cache(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot = create_int8_snapshot(Path(temp_dir))
            with patch.dict(os.environ, {"TYPELESS_MODEL_CACHE_DIR": temp_dir}, clear=False):
                self.assertEqual(model_manager.find_cached_model_snapshot(SENSEVOICE_SMALL_INT8_MODEL_ID), snapshot)
                self.assertTrue(model_manager.is_model_cached(SENSEVOICE_SMALL_INT8_MODEL_ID))
                self.assertFalse(model_manager.is_model_cached(SENSEVOICE_SMALL_MODEL_ID))


class SherpaOnnxRuntimeTest(unittest.TestCase):
    def setUp(self):
        asr._model = None
        model_manager.reset_active_asr_model_id()

    def tearDown(self):
        asr._model = None
        model_manager.reset_active_asr_model_id()

    def test_int8_download_only_fetches_inference_files(self):
        observed = {}

        def fake_snapshot_download(model, **kwargs):
            observed["model"] = model
            observed.update(kwargs)
            return "/tmp/int8"

        source = asr.StreamingAsrModelSource(
            kind=asr.DOWNLOAD_SOURCE,
            model_ref=SENSEVOICE_SMALL_INT8_REPO_ID,
            download_root="/tmp/cache",
            model_id=SENSEVOICE_SMALL_INT8_MODEL_ID,
            repo_id=SENSEVOICE_SMALL_INT8_REPO_ID,
        )
        with patch.dict(sys.modules, {"huggingface_hub": types.SimpleNamespace(snapshot_download=fake_snapshot_download)}):
            asr.resolve_model_ref_for_build(source)

        self.assertEqual(observed["model"], SENSEVOICE_SMALL_INT8_REPO_ID)
        self.assertEqual(observed["allow_patterns"], ["model.int8.onnx", "tokens.txt", "LICENSE"])

    def test_int8_runtime_uses_sherpa_onnx_on_cpu_and_decodes_accumulated_audio(self):
        calls = {}
        decoded_lengths = []

        class FakeStream:
            def __init__(self):
                self.result = types.SimpleNamespace(text="")

            def accept_waveform(self, sample_rate, audio):
                calls["sample_rate"] = sample_rate
                self.length = len(audio)

        class FakeRecognizer:
            def create_stream(self):
                return FakeStream()

            def decode_stream(self, stream):
                decoded_lengths.append(stream.length)
                stream.result.text = f" 累计{stream.length} "

        def from_sense_voice(**kwargs):
            calls["kwargs"] = kwargs
            return FakeRecognizer()

        fake_sherpa = types.SimpleNamespace(OfflineRecognizer=types.SimpleNamespace(from_sense_voice=from_sense_voice))
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot = create_int8_snapshot(Path(temp_dir))
            source = asr.StreamingAsrModelSource(
                kind=asr.MANAGED_CACHE_SOURCE,
                model_ref=str(snapshot),
                model_id=SENSEVOICE_SMALL_INT8_MODEL_ID,
                repo_id=SENSEVOICE_SMALL_INT8_REPO_ID,
            )
            with patch.dict(sys.modules, {"sherpa_onnx": fake_sherpa}), patch.dict(os.environ, {"FUNASR_DEVICE": "cuda:0"}):
                runtime = asr.build_streaming_asr_model(source)

        self.assertEqual(runtime.runtime_kind, model_manager.SHERPA_ONNX_RUNTIME)
        self.assertEqual(runtime.device, "cpu")
        self.assertEqual(runtime.device_fallback_reason, asr.ONNX_CPU_ONLY_REASON)
        self.assertEqual(calls["kwargs"]["provider"], "cpu")
        self.assertTrue(calls["kwargs"]["model"].endswith("model.int8.onnx"))
        self.assertTrue(calls["kwargs"]["tokens"].endswith("tokens.txt"))
        self.assertTrue(calls["kwargs"]["use_itn"])

        runtime.chunk_ms = 2
        session = asr.StreamingAsrSession(runtime, sample_rate=1000, chunk_ms=2)
        first = session.append_pcm16(b"\x01\x00\x02\x00")
        final = session.finalize()

        self.assertEqual(calls["sample_rate"], 16000)
        self.assertEqual(first[-1].text, "累计2")
        self.assertEqual(final.text, "累计2")
        self.assertEqual(decoded_lengths, [2, 2])

    def test_preload_reloads_when_active_model_changes(self):
        loaded = []

        def fake_load(*_args):
            model_id = model_manager.get_active_asr_model_id()
            loaded.append(model_id)
            return asr.StreamingAsrRuntime(model=object(), model_id=model_id)

        with patch("asr._load_streaming_asr_model", side_effect=fake_load):
            first = asr.preload_asr_model()
            again = asr.preload_asr_model()
            model_manager.set_active_asr_model_id(SENSEVOICE_SMALL_INT8_MODEL_ID)
            switched = asr.preload_asr_model()

        self.assertIs(first, again)
        self.assertEqual(switched.model_id, SENSEVOICE_SMALL_INT8_MODEL_ID)
        self.assertEqual(loaded, [SENSEVOICE_SMALL_MODEL_ID, SENSEVOICE_SMALL_INT8_MODEL_ID])


class ModelApiTest(unittest.TestCase):
    def setUp(self):
        asr._model = None
        model_manager.reset_active_asr_model_id()

    def tearDown(self):
        asr._model = None
        model_manager.reset_active_asr_model_id()

    def test_status_lists_both_models_and_marks_active(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
        with patch.dict(os.environ, {"SPEAKMORE_ASR_MODEL_ID": ""}, clear=False), TestClient(app) as client:
            payload = client.get("/model/status").json()

        self.assertEqual(payload["active_model_id"], SENSEVOICE_SMALL_MODEL_ID)
        self.assertEqual([item["model_id"] for item in payload["models"]], [SENSEVOICE_SMALL_MODEL_ID, SENSEVOICE_SMALL_INT8_MODEL_ID])
        self.assertEqual([item["active"] for item in payload["models"]], [True, False])
        self.assertEqual(payload["models"][1]["label"], "SenseVoiceSmall int8")
        self.assertGreater(payload["models"][1]["size_bytes"], 200_000_000)

    def test_status_with_model_id_switches_active_model_when_idle(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
        with TestClient(app) as client:
            payload = client.get("/model/status", params={"model_id": SENSEVOICE_SMALL_INT8_MODEL_ID}).json()

        self.assertEqual(payload["active_model_id"], SENSEVOICE_SMALL_INT8_MODEL_ID)
        self.assertEqual(payload["model_id"], SENSEVOICE_SMALL_INT8_MODEL_ID)
        self.assertEqual(payload["repo_id"], SENSEVOICE_SMALL_INT8_REPO_ID)
        self.assertEqual(payload["status"], "idle")

    def test_download_without_load_keeps_active_model(self):
        downloaded = []

        def fake_download(model_id, progress_callback=None):
            progress_callback({"downloaded_bytes": 5, "total_bytes": 10, "progress_percent": 50})
            downloaded.append(model_id)
            return "/tmp/model"

        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None, download_model=fake_download)
        with patch("main.is_model_cached", return_value=False), TestClient(app) as client:
            started = client.post("/model/download", json={"model_id": SENSEVOICE_SMALL_INT8_MODEL_ID, "load": False})
            for _ in range(50):
                payload = client.get("/model/status").json()
                int8 = payload["models"][1]
                if int8["status"] != "downloading":
                    break
                time.sleep(0.01)

        self.assertEqual(started.status_code, 200)
        self.assertEqual(downloaded, [SENSEVOICE_SMALL_INT8_MODEL_ID])
        self.assertEqual(payload["active_model_id"], SENSEVOICE_SMALL_MODEL_ID)
        self.assertEqual(payload["status"], "idle")
        self.assertEqual(int8["status"], "idle")
        self.assertIn("已下载", int8["detail"])

    def test_download_with_load_switches_and_loads_requested_model(self):
        loaded = []

        def fake_preload():
            loaded.append(model_manager.get_active_asr_model_id())

        app = main.create_app(preload_model=fake_preload, exit_scheduler=lambda _code: None)
        with TestClient(app) as client:
            client.post("/model/download", json={"model_id": SENSEVOICE_SMALL_INT8_MODEL_ID})
            for _ in range(50):
                ready = client.get("/ready")
                if ready.status_code == 200:
                    break
                time.sleep(0.01)

        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json()["active_model_id"], SENSEVOICE_SMALL_INT8_MODEL_ID)
        self.assertEqual(loaded, [SENSEVOICE_SMALL_INT8_MODEL_ID])

    def test_idle_detail_follows_cached_state_of_active_model(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
        with TestClient(app) as client:
            with patch("main.is_model_cached", return_value=False):
                missing = client.get("/model/status").json()
            with patch("main.is_model_cached", return_value=True):
                cached = client.get("/model/status").json()

        self.assertEqual(missing["detail"], main.MODEL_MISSING_DETAIL)
        self.assertEqual(cached["detail"], main.MODEL_CACHED_IDLE_DETAIL)

    def test_switch_is_refused_while_active_model_is_loading(self):
        app = main.create_app(preload_model=lambda: time.sleep(0.3), exit_scheduler=lambda _code: None)
        with TestClient(app) as client:
            client.post("/model/download")
            payload = client.get("/model/status", params={"model_id": SENSEVOICE_SMALL_INT8_MODEL_ID}).json()

        self.assertEqual(payload["active_model_id"], SENSEVOICE_SMALL_MODEL_ID)


if __name__ == "__main__":
    unittest.main()
