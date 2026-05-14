import unittest
from unittest.mock import call, patch

import asr


class AsrRuntimeTest(unittest.TestCase):
    def setUp(self):
        asr._model = None

    def test_preload_whisper_model_reuses_singleton(self):
        self.assertTrue(hasattr(asr, "preload_whisper_model"), "preload_whisper_model 尚未实现")
        self.assertTrue(
            hasattr(asr, "get_candidate_whisper_model_sources"),
            "get_candidate_whisper_model_sources 尚未实现",
        )
        if not hasattr(asr, "preload_whisper_model") or not hasattr(asr, "get_candidate_whisper_model_sources"):
            return

        source = asr.WhisperModelSource(kind=asr.DOWNLOAD_SOURCE, model_ref="base", download_root="C:/models")
        fake_model = object()

        with patch("asr.get_candidate_whisper_model_sources", return_value=[source]), patch(
            "asr.build_whisper_model",
            return_value=fake_model,
        ) as build:
            first = asr.preload_whisper_model()
            second = asr.preload_whisper_model()

        self.assertIs(first, fake_model)
        self.assertIs(second, fake_model)
        build.assert_called_once_with(source)

    def test_preload_whisper_model_falls_through_broken_cached_source(self):
        self.assertTrue(hasattr(asr, "preload_whisper_model"), "preload_whisper_model 尚未实现")
        self.assertTrue(
            hasattr(asr, "get_candidate_whisper_model_sources"),
            "get_candidate_whisper_model_sources 尚未实现",
        )
        if not hasattr(asr, "preload_whisper_model") or not hasattr(asr, "get_candidate_whisper_model_sources"):
            return

        bad_source = asr.WhisperModelSource(kind=asr.MANAGED_CACHE_SOURCE, model_ref="C:/managed")
        good_source = asr.WhisperModelSource(kind=asr.HF_CACHE_SOURCE, model_ref="C:/hf")
        fake_model = object()

        with patch("asr.get_candidate_whisper_model_sources", return_value=[bad_source, good_source]), patch(
            "asr.build_whisper_model",
            side_effect=[RuntimeError("broken managed cache"), fake_model],
        ) as build:
            model = asr.preload_whisper_model()

        self.assertIs(model, fake_model)
        self.assertEqual(build.call_args_list, [call(bad_source), call(good_source)])


if __name__ == "__main__":
    unittest.main()
