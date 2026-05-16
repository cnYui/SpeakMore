import unittest

from refiner import SYSTEM_PROMPTS


class RefinerPromptTest(unittest.TestCase):
    def test_transcript_prompt_uses_requested_chinese_rules(self):
        prompt = SYSTEM_PROMPTS["transcript"]

        self.assertIn("你是一个专业的文本清洗与校对助手", prompt)
        self.assertIn("智能符号与格式转换", prompt)
        self.assertIn("保持原语言不变", prompt)
        self.assertIn("信息与语气绝对无损", prompt)
        self.assertIn("零干扰输出", prompt)

    def test_ask_anything_prompt_covers_voice_agent_scenarios(self):
        prompt = SYSTEM_PROMPTS["ask_anything"]

        self.assertIn("专业、可靠的语音任务助手", prompt)
        self.assertIn("选中文本上下文", prompt)
        self.assertIn("翻译请求", prompt)
        self.assertIn("题目解答", prompt)
        self.assertIn("实时信息", prompt)
        self.assertIn("当前没有工具结果", prompt)
        self.assertIn("禁止编造实时信息", prompt)
        self.assertIn("不要用“好的”", prompt)

    def test_other_prompts_are_localized_to_chinese(self):
        ask_prompt = SYSTEM_PROMPTS["ask_anything"]
        translation_prompt = SYSTEM_PROMPTS["translation"]

        self.assertIn("使用与用户主要输入相同的语言回复", ask_prompt)
        self.assertNotIn("You are a helpful AI assistant", ask_prompt)

        self.assertIn("你是一个翻译助手", translation_prompt)
        self.assertIn("仅输出翻译结果", translation_prompt)
        self.assertNotIn("You are a translator", translation_prompt)


if __name__ == "__main__":
    unittest.main()
