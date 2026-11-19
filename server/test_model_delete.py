import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

import main
import model_manager

INT8 = model_manager.SENSEVOICE_SMALL_INT8_MODEL_ID
PYTORCH = model_manager.SENSEVOICE_SMALL_MODEL_ID


def write_snapshot(cache_root: Path, model_id: str, size: int = 2048) -> Path:
    """在缓存根目录下造一份完整的模型快照（文件内容是占位字节）。"""
    snapshot = model_manager.get_model_repo_cache_dir(model_id, cache_root=cache_root) / "snapshots" / "abc123"
    snapshot.mkdir(parents=True)
    for relative_path in model_manager.get_model_required_files(model_id):
        (snapshot / relative_path).write_bytes(b"x" * size)
    return snapshot


class ModelDeleteApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cache_root = Path(self.tmp.name) / "models"
        self.cache_root.mkdir()
        self.empty_hf = Path(self.tmp.name) / "hf"
        # 隔离环境：只认临时缓存目录，不受本机已有的 Hugging Face 缓存 / 显式目录影响。
        patcher = mock.patch.dict(os.environ, {
            "HF_HOME": str(self.empty_hf),
            model_manager.MODEL_CACHE_DIR_ENV: str(self.cache_root),
            model_manager.ACTIVE_MODEL_ID_ENV: PYTORCH,
        })
        patcher.start()
        self.addCleanup(patcher.stop)
        for model_id in (PYTORCH, INT8):
            os.environ.pop(model_manager.get_model_explicit_dir_env(model_id), None)
        model_manager.set_active_asr_model_id(PYTORCH)
        self.addCleanup(lambda: model_manager.set_active_asr_model_id(PYTORCH))

    def make_client(self, **kwargs):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None, **kwargs)
        return TestClient(app), app

    def models_by_id(self, payload):
        return {item["model_id"]: item for item in payload["models"]}

    def test_deletes_downloaded_model_and_reports_freed_space(self):
        snapshot = write_snapshot(self.cache_root, INT8, size=4096)
        other = write_snapshot(self.cache_root, PYTORCH)
        with self.make_client()[0] as client:
            before = client.get("/model/status", params={"cache_dir": str(self.cache_root)}).json()
            self.assertTrue(self.models_by_id(before)[INT8]["cached"])

            response = client.post("/model/delete", json={"model_id": INT8, "cache_dir": str(self.cache_root)})
            self.assertEqual(response.status_code, 200)
            payload = response.json()

        self.assertTrue(payload["delete"]["deleted"])
        self.assertEqual(payload["delete"]["freed_bytes"], 4096 * len(model_manager.get_model_required_files(INT8)))
        self.assertFalse(snapshot.exists())
        self.assertFalse(model_manager.get_model_repo_cache_dir(INT8).exists(), "整个仓库目录都要删掉，不留空壳")
        self.assertFalse(self.models_by_id(payload)[INT8]["cached"])
        self.assertTrue(other.exists(), "别的模型不受影响")
        self.assertTrue(self.models_by_id(payload)[PYTORCH]["cached"])

    def test_deleting_the_active_model_unloads_it_and_returns_to_not_downloaded(self):
        write_snapshot(self.cache_root, PYTORCH)
        client, app = self.make_client()
        with mock.patch.object(main, "unload_asr_model") as unload, client:
            main.set_voice_service_state(app, "ready", "ASR 模型已完成预热")
            response = client.post("/model/delete", json={"model_id": PYTORCH, "cache_dir": str(self.cache_root)})
            payload = response.json()
            ready = client.get("/ready")

        unload.assert_called()
        self.assertEqual(payload["status"], "idle")
        self.assertFalse(payload["cached"])
        self.assertEqual(ready.status_code, 503, "当前模型删掉后语音链路不能再显示就绪")

    def test_refuses_while_the_model_is_downloading(self):
        snapshot = write_snapshot(self.cache_root, INT8)
        client, app = self.make_client()

        class RunningTask:
            def done(self):
                return False

            def cancel(self):
                pass

        with client:
            app.state.model_download_tasks = {INT8: RunningTask()}
            response = client.post("/model/delete", json={"model_id": INT8, "cache_dir": str(self.cache_root)})

        self.assertEqual(response.status_code, 409)
        self.assertTrue(snapshot.exists(), "下载中拒绝删除，文件不能动")

    def test_rejects_unknown_or_missing_model_id(self):
        with self.make_client()[0] as client:
            self.assertEqual(client.post("/model/delete", json={"model_id": "whisper"}).status_code, 400)
            self.assertEqual(client.post("/model/delete", json={}).status_code, 400)
            self.assertEqual(client.post("/model/delete").status_code, 400)

    def test_deleting_a_model_that_is_not_cached_is_a_harmless_noop(self):
        with self.make_client()[0] as client:
            response = client.post("/model/delete", json={"model_id": INT8, "cache_dir": str(self.cache_root)})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["delete"]["deleted"])
        self.assertEqual(response.json()["delete"]["freed_bytes"], 0)

    def test_never_deletes_shared_locations_only_reports_them(self):
        # 显式指定的模型目录（环境变量）和 Hugging Face 缓存可能被别的程序共用：不能删，只报告位置。
        explicit = Path(self.tmp.name) / "explicit-int8"
        explicit.mkdir()
        for relative_path in model_manager.get_model_required_files(INT8):
            (explicit / relative_path).write_bytes(b"y" * 16)
        hf_snapshot = write_snapshot(self.empty_hf / "hub", INT8)
        managed_snapshot = write_snapshot(self.cache_root, INT8)

        with mock.patch.dict(os.environ, {model_manager.get_model_explicit_dir_env(INT8): str(explicit)}):
            with self.make_client()[0] as client:
                response = client.post("/model/delete", json={"model_id": INT8, "cache_dir": str(self.cache_root)})

        payload = response.json()["delete"]
        self.assertTrue(payload["deleted"])
        self.assertFalse(managed_snapshot.exists())
        self.assertTrue(explicit.exists() and all((explicit / name).exists() for name in model_manager.get_model_required_files(INT8)))
        self.assertTrue(hf_snapshot.exists())
        self.assertEqual(len(payload["external_locations"]), 2)

    def test_delete_failure_is_reported_as_500_with_a_reason(self):
        write_snapshot(self.cache_root, INT8)

        def broken_delete(_model_id):
            raise PermissionError("文件被占用")

        client, _app = self.make_client(delete_model=broken_delete)
        with client:
            response = client.post("/model/delete", json={"model_id": INT8, "cache_dir": str(self.cache_root)})
        self.assertEqual(response.status_code, 500)
        self.assertIn("文件被占用", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
