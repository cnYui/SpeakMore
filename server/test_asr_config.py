import os
import tempfile
import unittest
from unittest.mock import patch

from asr import resolve_whisper_model_source
from main import should_enable_reload


class AsrConfigTest(unittest.TestCase):
    def test_resolve_whisper_model_source_prefers_local_env_path(self):
        with tempfile.NamedTemporaryFile(suffix=".bin") as model_file:
            with patch.dict(os.environ, {"WHISPER_MODEL_PATH": model_file.name}, clear=False):
                model_source, source_kind = resolve_whisper_model_source()

        self.assertEqual(model_source, model_file.name)
        self.assertEqual(source_kind, "local")

    def test_resolve_whisper_model_source_falls_back_to_base_when_path_invalid(self):
        with patch.dict(os.environ, {"WHISPER_MODEL_PATH": "Z:/missing/model.bin"}, clear=False):
            model_source, source_kind = resolve_whisper_model_source()

        self.assertEqual(model_source, "base")
        self.assertEqual(source_kind, "default")

    def test_should_enable_reload_defaults_to_false(self):
        with patch.dict(os.environ, {}, clear=False):
            self.assertFalse(should_enable_reload())

    def test_should_enable_reload_reads_truthy_env_value(self):
        with patch.dict(os.environ, {"UVICORN_RELOAD": "true"}, clear=False):
            self.assertTrue(should_enable_reload())


if __name__ == "__main__":
    unittest.main()
