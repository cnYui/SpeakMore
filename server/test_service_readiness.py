import threading
import time
import unittest
from unittest.mock import patch

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

    def test_model_status_is_idle_until_user_starts_download(self):
        app = main.create_app(preload_model=lambda: None, exit_scheduler=lambda _code: None)

        with TestClient(app) as client:
            status = client.get("/model/status")
            ready = client.get("/ready")

        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "idle")
        self.assertEqual(status.json()["model_id"], "sensevoice-small")
        self.assertEqual(ready.status_code, 503)

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


if __name__ == "__main__":
    unittest.main()
