import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import asr
import model_manager
from model_manager import (
    SENSEVOICE_SMALL_MODEL_ID,
    find_cached_model_snapshot,
    repo_cache_dir_name,
)


def create_sensevoice_snapshot(cache_root: Path, snapshot_name: str = "sensevoice") -> Path:
    snapshot_dir = cache_root / repo_cache_dir_name("FunAudioLLM/SenseVoiceSmall") / "snapshots" / snapshot_name
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    (snapshot_dir / "model.pt").write_bytes(b"model")
    (snapshot_dir / "config.yaml").write_text("model: SenseVoiceSmall", encoding="utf-8")
    (snapshot_dir / "am.mvn").write_bytes(b"mvn")
    (snapshot_dir / "chn_jpn_yue_eng_ko_spectok.bpe.model").write_bytes(b"bpe")
    return snapshot_dir


class AsrConfigTest(unittest.TestCase):
    def test_model_manager_exposes_only_sensevoice_small(self):
        self.assertEqual(model_manager.SUPPORTED_ASR_MODEL_IDS, (model_manager.SENSEVOICE_SMALL_MODEL_ID,))
        self.assertEqual(model_manager.DEFAULT_MODEL_ID, model_manager.SENSEVOICE_SMALL_MODEL_ID)
        self.assertEqual(model_manager.get_active_asr_model_id(), model_manager.SENSEVOICE_SMALL_MODEL_ID)
        self.assertEqual(
            model_manager.get_model_explicit_dir_env(model_manager.SENSEVOICE_SMALL_MODEL_ID),
            "SENSEVOICE_SMALL_MODEL_DIR",
        )

    def test_model_manager_supports_sensevoice_small_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            snapshot = create_sensevoice_snapshot(Path(temp_dir))

            result = find_cached_model_snapshot(SENSEVOICE_SMALL_MODEL_ID, cache_root=Path(temp_dir))

        self.assertEqual(result, snapshot)

    def test_model_manager_uses_user_selected_cache_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            selected_root = Path(temp_dir) / "CustomFunASR"

            with patch.dict(os.environ, {"TYPELESS_MODEL_CACHE_DIR": str(selected_root)}, clear=False):
                result = model_manager.get_managed_model_cache_root(SENSEVOICE_SMALL_MODEL_ID)

        self.assertEqual(result, selected_root)

    def test_resolve_streaming_model_source_uses_hf_cache_by_default(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            local_app_data = Path(temp_dir) / "LocalAppData"
            user_profile = Path(temp_dir) / "UserProfile"
            hf_root = user_profile / ".cache" / "huggingface" / "hub"
            snapshot = create_sensevoice_snapshot(hf_root)

            with patch.dict(
                os.environ,
                {
                    "SENSEVOICE_SMALL_MODEL_DIR": "",
                    "LOCALAPPDATA": str(local_app_data),
                    "USERPROFILE": str(user_profile),
                },
                clear=False,
            ):
                source = asr.resolve_streaming_model_source()

        self.assertEqual(
            source,
            asr.StreamingAsrModelSource(
                kind=asr.HF_CACHE_SOURCE,
                model_ref=str(snapshot),
                download_root=None,
                model_id=SENSEVOICE_SMALL_MODEL_ID,
                repo_id="FunAudioLLM/SenseVoiceSmall",
            ),
        )

    def test_resolve_streaming_model_source_prefers_explicit_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            explicit_dir = create_sensevoice_snapshot(Path(temp_dir), "explicit-sensevoice")

            with patch.dict(
                os.environ,
                {
                    "SENSEVOICE_SMALL_MODEL_DIR": str(explicit_dir),
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                },
                clear=False,
            ):
                source = asr.resolve_streaming_model_source()

        self.assertEqual(source.model_id, SENSEVOICE_SMALL_MODEL_ID)
        self.assertEqual(source.kind, asr.DIR_SOURCE)
        self.assertEqual(source.model_ref, str(explicit_dir))

    def test_resolve_streaming_model_source_rejects_invalid_explicit_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            invalid_dir = Path(temp_dir) / "invalid-sensevoice"
            invalid_dir.mkdir(parents=True, exist_ok=True)

            with patch.dict(
                os.environ,
                {
                    "SENSEVOICE_SMALL_MODEL_DIR": str(invalid_dir),
                    "LOCALAPPDATA": str(Path(temp_dir) / "LocalAppData"),
                    "USERPROFILE": str(Path(temp_dir) / "UserProfile"),
                },
                clear=False,
            ):
                with self.assertRaisesRegex(ValueError, "SENSEVOICE_SMALL_MODEL_DIR"):
                    asr.resolve_streaming_model_source()


if __name__ == "__main__":
    unittest.main()
