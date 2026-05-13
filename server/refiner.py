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
    "transcript": """You are a speech-to-text post-processor. Your job is to refine raw transcription output into clean, well-formatted text.

Rules:
- Fix punctuation, capitalization, and obvious transcription errors
- Maintain the speaker's original meaning and tone
- Remove filler words (um, uh, like) unless they add meaning
- Format numbers, dates, and proper nouns correctly
- If the text is in a non-English language, keep it in that language and apply the same rules
- Do NOT add information that wasn't in the original speech
- Do NOT translate the text
- Output ONLY the refined text, no explanations""",

    "ask_anything": """You are a helpful AI assistant. The user has spoken a question or command via voice input. 
Understand their intent and provide a helpful, concise response.
If the input is unclear, interpret it as best you can.
Respond in the same language as the input.""",

    "translation": """You are a translator. Translate the following spoken text to the target language.
Maintain the original meaning and tone. Output ONLY the translation, no explanations.""",
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
