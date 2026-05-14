import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from asr import (
    DEFAULT_WHISPER_MODEL,
    DIR_SOURCE,
    DOWNLOAD_SOURCE,
    HF_CACHE_SOURCE,
    MANAGED_CACHE_SOURCE,
    WhisperModelSource,
    resolve_whisper_model_source,
)
from main import should_enable_reload

BASE_REPO_DIR = "models--Systran--faster-whisper-base"


def create_snapshot(cache_root: Path, snapshot_name: str = "test-snapshot") -> Path:
    snapshot_dir = cache_root / BASE_REPO_DIR / "snapshots" / snapshot_name
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "model.bin").write_bytes(b"model")
    (snapshot_dir / "config.json").write_text("{}", encoding="utf-8")
    return snapshot_dir


def create_explicit_model_dir(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "model.bin").write_bytes(b"model")
    (root / "config.json").write_text("{}", encoding="utf-8")
    return root


class AsrConfigTest(unittest.TestCase):
    def test_resolve_whisper_model_source_prefers_explicit_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = create_explicit_model_dir(Path(temp_dir) / "explicit-model")
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"

            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": DEFAULT_WHISPER_MODEL,
                    "WHISPER_MODEL_DIR": str(explicit_dir),
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = resolve_whisper_model_source()

        self.assertEqual(
            source,
            WhisperModelSource(kind=DIR_SOURCE, model_ref=str(explicit_dir), download_root=None),
        )

    def test_resolve_whisper_model_source_rejects_invalid_explicit_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            invalid_dir = Path(temp_dir) / "invalid-model"
            invalid_dir.mkdir(parents=True, exist_ok=True)

            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": DEFAULT_WHISPER_MODEL,
                    "WHISPER_MODEL_DIR": str(invalid_dir),
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                },
                clear=False,
            ):
                with self.assertRaisesRegex(ValueError, "WHISPER_MODEL_DIR"):
                    resolve_whisper_model_source()

    def test_resolve_whisper_model_source_prefers_managed_cache_over_hf_cache(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"
            managed_root = local_app_data / "Typeless" / "models" / "faster-whisper"
            hf_root = user_profile / ".cache" / "huggingface" / "hub"
            managed_snapshot = create_snapshot(managed_root, "managed-snapshot")
            create_snapshot(hf_root, "hf-snapshot")

            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": DEFAULT_WHISPER_MODEL,
                    "WHISPER_MODEL_DIR": "",
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = resolve_whisper_model_source()

        self.assertEqual(
            source,
            WhisperModelSource(
                kind=MANAGED_CACHE_SOURCE,
                model_ref=str(managed_snapshot),
                download_root=None,
            ),
        )

    def test_resolve_whisper_model_source_uses_hf_cache_when_managed_cache_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"
            hf_root = user_profile / ".cache" / "huggingface" / "hub"
            hf_snapshot = create_snapshot(hf_root, "hf-snapshot")

            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": DEFAULT_WHISPER_MODEL,
                    "WHISPER_MODEL_DIR": "",
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = resolve_whisper_model_source()

        self.assertEqual(
            source,
            WhisperModelSource(kind=HF_CACHE_SOURCE, model_ref=str(hf_snapshot), download_root=None),
        )

    def test_resolve_whisper_model_source_falls_back_to_managed_download_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"
            expected_download_root = local_app_data / "Typeless" / "models" / "faster-whisper"

            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": DEFAULT_WHISPER_MODEL,
                    "WHISPER_MODEL_DIR": "",
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = resolve_whisper_model_source()

        self.assertEqual(
            source,
            WhisperModelSource(
                kind=DOWNLOAD_SOURCE,
                model_ref=DEFAULT_WHISPER_MODEL,
                download_root=str(expected_download_root),
            ),
        )

    def test_resolve_whisper_model_source_ignores_legacy_env_variables(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"
            expected_download_root = local_app_data / "Typeless" / "models" / "faster-whisper"

            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": DEFAULT_WHISPER_MODEL,
                    "WHISPER_MODEL_DIR": "",
                    "WHISPER_MODEL_PATH": "C:/legacy/ggml-base.bin",
                    "SENSEVOICE_MODEL_DIR": "C:/legacy/sense-voice",
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = resolve_whisper_model_source()

        self.assertEqual(
            source,
            WhisperModelSource(
                kind=DOWNLOAD_SOURCE,
                model_ref=DEFAULT_WHISPER_MODEL,
                download_root=str(expected_download_root),
            ),
        )

    def test_resolve_whisper_model_source_rejects_non_base_model_name(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(
                os.environ,
                {
                    "WHISPER_MODEL": "small",
                    "WHISPER_MODEL_DIR": "",
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                },
                clear=False,
            ):
                with self.assertRaisesRegex(ValueError, "仅支持 faster-whisper 模型 base"):
                    resolve_whisper_model_source()

    def test_should_enable_reload_defaults_to_false(self):
        with patch.dict(os.environ, {}, clear=False):
            self.assertFalse(should_enable_reload())

    def test_should_enable_reload_reads_truthy_env_value(self):
        with patch.dict(os.environ, {"UVICORN_RELOAD": "true"}, clear=False):
            self.assertTrue(should_enable_reload())


if __name__ == "__main__":
    unittest.main()
