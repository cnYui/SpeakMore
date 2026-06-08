import threading
import time
import unittest
import asyncio
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main


class ServiceReadinessTest(unittest.TestCase):
    def test_main_exposes_create_app_factory(self):
        self.assertTrue(hasattr(main, "create_app"), "main.create_app 尚未实现")

    def test_health_is_live_while_model_preload_is_running(self):
        self.assertTrue(hasattr(main, "create_app"), "main.create_app 尚未实现")
        if not hasattr(main, "create_app"):
            return

        release = threading.Event()

        def slow_preload():
            release.wait(1)

        app = main.create_app(preload_model=slow_preload, exit_scheduler=lambda _code: None, auto_preload_model=True)

        with TestClient(app) as client:
            health = client.get("/health")
            ready = client.get("/ready")

        release.set()
        self.assertEqual(health.status_code, 200)
        self.assertIn(health.json()["status"], {"loading", "downloading"})
        self.assertEqual(ready.status_code, 503)
        self.assertIn(ready.json()["status"], {"loading", "downloading"})

    def test_preload_failure_marks_service_failed_and_requests_exit(self):
        self.assertTrue(hasattr(main, "create_app"), "main.create_app 尚未实现")
        if not hasattr(main, "create_app"):
            return

        exit_codes = []

        def broken_preload():
            raise RuntimeError("boom")

        app = main.create_app(
            preload_model=broken_preload,
            exit_scheduler=exit_codes.append,
            auto_preload_model=True,
            exit_on_preload_failure=True,
        )

        with TestClient(app) as client:
            for _ in range(20):
                ready = client.get("/ready")
                if ready.json()["status"] == "failed":
                    break
                time.sleep(0.01)

        self.assertEqual(exit_codes, [1])

    def test_config_reload_endpoint_refreshes_refiner_runtime(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with patch("main.reload_refiner_runtime_config") as reload_refiner_runtime_config, TestClient(app) as client:
            response = client.post("/config/reload")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        reload_refiner_runtime_config.assert_called_once_with()

    def test_startup_auto_preloads_cached_translation_model_when_runtime_available(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with patch("main.should_auto_preload_translation_model", return_value=True), \
            patch("main.can_auto_preload_translation_model", return_value=True), \
            patch("main.start_translation_model_load_task") as start_translation_model_load_task, \
            TestClient(app) as client:
            response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        start_translation_model_load_task.assert_called_once_with(app)

    def test_startup_does_not_auto_preload_translation_model_when_disabled(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with patch("main.should_auto_preload_translation_model", return_value=False), \
            patch("main.can_auto_preload_translation_model", return_value=True), \
            patch("main.start_translation_model_load_task") as start_translation_model_load_task, \
            TestClient(app) as client:
            response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        start_translation_model_load_task.assert_not_called()

    def test_translation_model_download_auto_loads_when_runtime_available(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
        load_task = AsyncMock()

        with patch("main.download_translation_model", return_value=None), \
            patch("main.can_auto_preload_translation_model", return_value=True), \
            patch("main.run_translation_model_load_task", load_task):
            asyncio.run(main.run_translation_model_download_task(app))

        load_task.assert_awaited_once_with(app)

    def test_model_status_is_idle_until_user_starts_download(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with patch(
            "main.get_asr_runtime_device_status",
            return_value={
                "device": "mps",
                "requested_device": "auto",
                "device_source": "auto",
                "fallback_reason": None,
            },
        ), TestClient(app) as client:
            status = client.get("/model/status")
            ready = client.get("/ready")

        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "idle")
        self.assertEqual(status.json()["model_id"], "sensevoice-small")
        self.assertEqual(status.json()["device"], "mps")
        self.assertEqual(status.json()["requested_device"], "auto")
        self.assertEqual(status.json()["device_source"], "auto")
        self.assertIsNone(status.json()["fallback_reason"])
        self.assertEqual(ready.status_code, 503)

    def test_model_status_distinguishes_cached_but_not_loaded_model(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with patch("main.find_cached_model_snapshot", return_value="/tmp/sensevoice-snapshot"), TestClient(app) as client:
            status = client.get("/model/status")

        self.assertEqual(status.status_code, 200)
        payload = status.json()
        self.assertEqual(payload["status"], "idle")
        self.assertEqual(payload["cached"], True)
        self.assertIn("已下载", payload["detail"])
        self.assertNotIn("还没有下载", payload["detail"])

    def test_model_download_endpoint_starts_preload_task(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with TestClient(app) as client:
            started = client.post("/model/download")
            for _ in range(20):
                ready = client.get("/ready")
                if ready.status_code == 200:
                    break
                time.sleep(0.01)

        self.assertEqual(started.status_code, 200)
        self.assertEqual(ready.status_code, 200)
        self.assertEqual(ready.json()["status"], "ready")

    def test_model_status_and_download_accept_user_selected_cache_dir(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with TestClient(app) as client:
            status = client.get("/model/status", params={"cache_dir": "D:\\Models\\FunASR"})
            started = client.post("/model/download", json={"cache_dir": "E:\\Models\\FunASR"})

        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["cache_dir"], "D:\\Models\\FunASR")
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json()["cache_dir"], "E:\\Models\\FunASR")

    def test_model_status_includes_download_progress(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)
        with TestClient(app) as client:
            app.state.voice_service_status = main.create_voice_service_state(
                "downloading",
                "正在下载 SenseVoiceSmall 模型",
                started_at=time.time(),
                download_progress={
                    "downloaded_bytes": 25,
                    "total_bytes": 100,
                    "progress_percent": 25,
                },
            )
            response = client.get("/model/status")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["downloaded_bytes"], 25)
        self.assertEqual(payload["total_bytes"], 100)
        self.assertEqual(payload["progress_percent"], 25)
        self.assertEqual(payload["downloaded_files"], 0)
        self.assertEqual(payload["total_files"], 0)
        self.assertIsNone(payload["file_progress_percent"])


if __name__ == "__main__":
    unittest.main()
