"""Refiner 模块 - 使用 DeepSeek API 对 ASR 转写结果进行润色"""

import os
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

_client = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.getenv("DEEPSEEK_API_KEY"),
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        )
    return _client


# 根据 Typeless 逆向出的模式对应不同 prompt
SYSTEM_PROMPTS = {
    "transcript": """你是一个专业的文本清洗与校对助手。你的任务是对原始文本进行“无损清洗”、“语病纠错”和“术语校正”，在严控核心信息和原始语意完全不变的前提下，输出干净、通顺的纯文本。

执行标准(Standard Procedures)：

第一阶段：文本清洗（去噪）

剔除语气词：彻底删除“呃、嗯、啊、那、就是、某种程度上、到底”等无意义的口语填充词，除非它们对上下文逻辑有实际意义。

修复语病：消除口吃、复读现象（如“我...我看到”改为“我看到”）。

智能符号与格式转换：识别语音读出的符号名称（如“逗号”、“句号”、“斜杠”、“点”、“下划线”等），并严格根据上下文智能转换：

常规标点：在句意停顿处转为正常的标点符号。

路径/网址/代码语境：当出现在文件路径、网址、文件后缀或代码变量中时，不仅要将其转换为对应的符号，还必须自动去除符号两侧的多余空格。例如：“doc 斜杠ai”转为“doc/ai”；“www 点baidu 点com”转为“www.baidu.com”；“index 点html”转为“index.html”。

第二阶段：规范化处理

数符转换：遵循“能数则数”原则。例：二十五→25；百分之十→10%；五块钱→5元。

标点修复：修复明显错误的标点断句，但必须遵循输入语言的标点习惯（如英文使用半角，中文使用全角）。

第三阶段：术语校正

同音修正：识别并修复由于语音识别（ASR）导致的同音异义词或专业术语错误。

大小写规范：常见的专有名词、品牌名、技术词汇等，请保持其标准的官方/行业惯用拼写和大小写。

核心禁令(Strict Constraints)：

保持原语言不变：绝对禁止翻译文本。输入的是什么语言，输出就必须是相同的语言。

信息与语气绝对无损：绝不允许删减、扩写、总结原文信息，绝不允许改变原文的视角（如第一人称/第二人称）或问答互动语气。仅做错别字级别的替换和语序微调。

零外部幻觉：禁止引入任何原始材料中未提及的概念或观点。

零干扰输出：禁止输出“好的”、“为您整理如下”等废话，仅返回最终处理完成的纯文本结果。""",

    "ask_anything": """你是一个有帮助的 AI 助手。用户通过语音输入提出了一个问题或命令。
理解他们的意图，并提供有帮助、简洁的回复。
如果输入不够清晰，请尽可能基于上下文进行理解。
使用与输入相同的语言回复。""",

    "translation": """你是一个翻译助手。请将下面的口述文本翻译成目标语言。
保持原始含义和语气。仅输出翻译结果，不要附加解释。""",
}


async def refine_text(
    raw_text: str,
    mode: str = "transcript",
    context: dict | None = None,
    parameters: dict | None = None,
) -> str:
    """使用 DeepSeek 对 ASR 原始文本进行润色
    
    Args:
        raw_text: ASR 转写的原始文本
        mode: 模式 - transcript/ask_anything/translation
        context: 音频上下文（当前 app、输入框内容等）
        parameters: 额外参数（如翻译目标语言）
    
    Returns:
        润色后的文本
    """
    if not raw_text or not raw_text.strip():
        return ""

    client = _get_client()
    system_prompt = SYSTEM_PROMPTS.get(mode, SYSTEM_PROMPTS["transcript"])

    # 构建上下文增强的 user message
    user_message = raw_text

    if mode == "transcript" and context:
        # 利用上下文信息帮助润色（模仿 Typeless 的上下文感知）
        app_info = context.get("active_application", {})
        text_point = context.get("text_insertion_point", {})
        cursor_state = text_point.get("cursor_state", {})

        context_parts = []
        if app_info.get("app_name"):
            context_parts.append(f"App: {app_info['app_name']}")
        if app_info.get("browser_context", {}).get("domain"):
            context_parts.append(f"Website: {app_info['browser_context']['domain']}")
        if cursor_state.get("text_before_cursor"):
            before = cursor_state["text_before_cursor"][-200:]
            context_parts.append(f"Text before cursor: {before}")

        if context_parts:
            user_message = f"[Context: {'; '.join(context_parts)}]\n\nTranscription to refine:\n{raw_text}"

    elif mode == "translation" and parameters:
        target_lang = parameters.get("output_language", "en")
        user_message = f"Translate to {target_lang}:\n{raw_text}"

    elif mode == "ask_anything" and parameters:
        selected_text = parameters.get("selected_text", "")
        if selected_text:
            user_message = f"[Selected text in editor: {selected_text}]\n\nUser's voice command:\n{raw_text}"

    try:
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            temperature=0.3,
            max_tokens=2048,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"[Refiner] DeepSeek API 调用失败: {e}")
        # fallback: 返回原始文本
        return raw_text
