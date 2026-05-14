import os
import unittest
from pathlib import Path
from unittest.mock import patch


class RuntimeConfigTest(unittest.TestCase):
    def test_get_env_file_path_points_to_server_env(self):
        try:
            from runtime_config import get_env_file_path
        except ModuleNotFoundError as error:
            self.fail(f"runtime_config 模块缺失: {error}")

        self.assertEqual(get_env_file_path(), Path(__file__).with_name(".env"))

    def test_server_bind_defaults_to_loopback(self):
        try:
            from runtime_config import get_server_host, get_server_port
        except ModuleNotFoundError as error:
            self.fail(f"runtime_config 模块缺失: {error}")

        with patch.dict(os.environ, {"HOST": "", "PORT": ""}, clear=False):
            self.assertEqual(get_server_host(), "127.0.0.1")
            self.assertEqual(get_server_port(), 8000)

    def test_cors_allowed_origins_default_to_local_clients(self):
        try:
            from runtime_config import get_cors_allowed_origins
        except ModuleNotFoundError as error:
            self.fail(f"runtime_config 模块缺失: {error}")

        with patch.dict(os.environ, {}, clear=False):
            self.assertEqual(
                get_cors_allowed_origins(),
                ["null", "http://127.0.0.1:5173", "http://localhost:5173"],
            )

    def test_cors_allowed_origins_reads_csv_env(self):
        try:
            from runtime_config import get_cors_allowed_origins
        except ModuleNotFoundError as error:
            self.fail(f"runtime_config 模块缺失: {error}")

        with patch.dict(
            os.environ,
            {"CORS_ALLOWED_ORIGINS": "https://app.example.com, https://admin.example.com"},
            clear=False,
        ):
            self.assertEqual(
                get_cors_allowed_origins(),
                ["https://app.example.com", "https://admin.example.com"],
            )


if __name__ == "__main__":
    unittest.main()
