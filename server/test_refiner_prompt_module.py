import unittest

from refiner_prompts import SYSTEM_PROMPTS, VOICE_INPUT_NORMALIZATION_PROMPT


class TestRefinerPromptModule(unittest.TestCase):
    def test_exports_static_prompts(self):
        self.assertEqual(set(SYSTEM_PROMPTS), {"transcript", "ask_anything", "translation", "custom_command", "meeting_notes"})
        self.assertTrue(
            VOICE_INPUT_NORMALIZATION_PROMPT.startswith("公共语音输入规范化与轻量条理化规则：")
        )

    def test_refiner_keeps_compat_exports(self):
        from refiner import SYSTEM_PROMPTS as refiner_system_prompts
        from refiner import VOICE_INPUT_NORMALIZATION_PROMPT as refiner_voice_input_normalization_prompt

        self.assertIs(refiner_system_prompts, SYSTEM_PROMPTS)
        self.assertIs(refiner_voice_input_normalization_prompt, VOICE_INPUT_NORMALIZATION_PROMPT)


if __name__ == "__main__":
    unittest.main()
