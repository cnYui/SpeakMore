import threading
import time
import unittest

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

        app = main.create_app(preload_model=slow_preload, exit_scheduler=lambda _code: None)

        with TestClient(app) as client:
            health = client.get("/health")
            ready = client.get("/ready")

        release.set()
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "starting")
        self.assertEqual(ready.status_code, 503)
        self.assertEqual(ready.json()["status"], "starting")

    def test_preload_failure_marks_service_failed_and_requests_exit(self):
        self.assertTrue(hasattr(main, "create_app"), "main.create_app 尚未实现")
        if not hasattr(main, "create_app"):
            return

        exit_codes = []

        def broken_preload():
            raise RuntimeError("boom")

        app = main.create_app(preload_model=broken_preload, exit_scheduler=exit_codes.append)

        with TestClient(app) as client:
            for _ in range(20):
                ready = client.get("/ready")
                if ready.json()["status"] == "failed":
                    break
                time.sleep(0.01)

        self.assertEqual(exit_codes, [1])


if __name__ == "__main__":
    unittest.main()
