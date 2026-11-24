"""长录音分段：识别会话每满 30 秒封口一段、在最安静的地方切、识别变慢时自动拉长间隔。"""

import unittest
from unittest.mock import patch

import asr

SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2


def silence(seconds: float) -> bytes:
    return bytes(int(seconds * BYTES_PER_SECOND) // 2 * 2)


def tone(seconds: float, amplitude: int = 8000) -> bytes:
    samples = int(seconds * SAMPLE_RATE)
    return (amplitude).to_bytes(2, "little", signed=True) * samples


def make_runtime(accumulate_audio: bool = True) -> asr.StreamingAsrRuntime:
    return asr.StreamingAsrRuntime(model=None, accumulate_audio=accumulate_audio, chunk_ms=1200)


class FakeDecoder:
    """代替真正的识别：记录每次送进来的音频长度，封口 / 收尾（is_final）时给出“甲乙丙…”。"""

    def __init__(self, clock_state: dict | None = None, cost_seconds: float = 0.0):
        self.calls: list[tuple[int, bool]] = []
        self.finals = 0
        self.clock_state = clock_state
        self.cost_seconds = cost_seconds

    def __call__(self, runtime, pcm_bytes, cache, is_final):
        self.calls.append((len(pcm_bytes), is_final))
        if self.clock_state is not None:
            self.clock_state["now"] += self.cost_seconds
        if is_final:
            label = "甲乙丙丁戊己"[self.finals]
            self.finals += 1
            return label
        return "草稿"


def feed(session: asr.StreamingAsrSession, audio: bytes, chunk_seconds: float = 0.25):
    step = int(chunk_seconds * BYTES_PER_SECOND) // 2 * 2
    results = []
    for offset in range(0, len(audio), step):
        results.extend(session.append_pcm16(audio[offset : offset + step]))
    return results


class StreamingSegmentsTest(unittest.TestCase):
    def test_closes_a_segment_every_30_seconds_and_caps_decode_length(self):
        decoder = FakeDecoder()
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE)

        with patch("asr.generate_streaming_asr_chunk", side_effect=decoder):
            results = feed(session, silence(70))
            final = session.finalize()

        closed = [text for result in results for text in result.closed_segments]
        self.assertEqual(closed, ["甲", "乙"])
        self.assertEqual(final.closed_segments, ("丙",))
        self.assertEqual(final.text, "甲乙丙")
        # 任何一次识别送进去的音频都不超过 30 秒：成本封顶，和录音总长无关。
        self.assertLessEqual(max(length for length, _ in decoder.calls), 30 * BYTES_PER_SECOND)

    def test_partial_text_is_committed_segments_plus_current_draft(self):
        decoder = FakeDecoder()
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE)

        with patch("asr.generate_streaming_asr_chunk", side_effect=decoder):
            results = feed(session, silence(35))

        self.assertTrue(results)
        self.assertEqual(results[-1].text, "甲草稿")

    def test_segment_is_cut_at_the_quietest_spot_in_the_last_five_seconds(self):
        decoder = FakeDecoder()
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE)
        # 前 27 秒一直有声音，只在第 27 秒停顿 0.1 秒，然后继续说话。
        audio = tone(27) + silence(0.1) + tone(4.9)

        with patch("asr.generate_streaming_asr_chunk", side_effect=decoder):
            feed(session, audio)

        finals = [length for length, is_final in decoder.calls if is_final]
        self.assertEqual(len(finals), 1)
        self.assertAlmostEqual(finals[0] / BYTES_PER_SECOND, 27.05, delta=0.1)
        # 切点之后的声音留给下一段，一个采样都没丢。
        self.assertEqual(len(session.full_pcm), len(audio) - finals[0])

    def test_slow_decoding_stretches_the_interval_so_the_session_keeps_up(self):
        state = {"now": 0.0}
        # 每次识别要 3 秒：负载预算 50%，下一次至少隔 6 秒的音频。
        decoder = FakeDecoder(clock_state=state, cost_seconds=3.0)
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE, clock=lambda: state["now"])

        with patch("asr.generate_streaming_asr_chunk", side_effect=decoder):
            feed(session, silence(20))

        partial_decodes = [call for call in decoder.calls if not call[1]]
        # 20 秒的录音：间隔拉长到 6 秒后最多识别 4 次（原来固定 1.2 秒要 16 次）。
        self.assertLessEqual(len(partial_decodes), 4)
        self.assertGreaterEqual(session.decode_interval_bytes, 6 * BYTES_PER_SECOND)

    def test_fast_decoding_keeps_the_base_interval(self):
        state = {"now": 0.0}
        decoder = FakeDecoder(clock_state=state, cost_seconds=0.05)
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE, clock=lambda: state["now"])

        with patch("asr.generate_streaming_asr_chunk", side_effect=decoder):
            feed(session, silence(6))

        self.assertEqual(session.decode_interval_bytes, session.chunk_bytes)

    def test_short_recording_is_a_single_segment(self):
        decoder = FakeDecoder()
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE)

        with patch("asr.generate_streaming_asr_chunk", side_effect=decoder):
            results = feed(session, silence(5))
            final = session.finalize()

        self.assertEqual([r for r in results if r.closed_segments], [])
        self.assertEqual(final.closed_segments, ("甲",))
        self.assertEqual(final.text, "甲")

    def test_finalize_without_audio_is_empty(self):
        session = asr.StreamingAsrSession(make_runtime(), sample_rate=SAMPLE_RATE)
        self.assertEqual(session.finalize().text, "")

    def test_runtime_without_accumulation_is_not_segmented(self):
        calls = []

        def fake(runtime, pcm_bytes, cache, is_final):
            calls.append(len(pcm_bytes))
            return "字"

        session = asr.StreamingAsrSession(make_runtime(accumulate_audio=False), sample_rate=SAMPLE_RATE)
        with patch("asr.generate_streaming_asr_chunk", side_effect=fake):
            results = feed(session, silence(5))

        self.assertTrue(results)
        self.assertTrue(all(not result.closed_segments for result in results))


class FindSegmentCutTest(unittest.TestCase):
    def test_cut_is_sample_aligned_and_inside_the_audio(self):
        audio = tone(10) + silence(0.2) + tone(9.8)
        cut = asr.find_segment_cut(audio, SAMPLE_RATE)
        self.assertEqual(cut % 2, 0)
        self.assertGreater(cut, 0)
        self.assertLessEqual(cut, len(audio))

    def test_cut_prefers_the_latest_of_equally_quiet_frames(self):
        cut = asr.find_segment_cut(silence(30), SAMPLE_RATE)
        self.assertGreater(cut / BYTES_PER_SECOND, 29.9)

    def test_short_audio_is_cut_at_the_end(self):
        audio = tone(0.05)
        self.assertEqual(asr.find_segment_cut(audio, SAMPLE_RATE), len(audio))


class JoinSegmentTextsTest(unittest.TestCase):
    def test_chinese_segments_join_without_spaces(self):
        self.assertEqual(asr.join_segment_texts(["你好，", "今天天气不错。"]), "你好，今天天气不错。")

    def test_english_words_and_sentences_get_a_space(self):
        self.assertEqual(asr.join_segment_texts(["Hello world", "again"]), "Hello world again")
        self.assertEqual(asr.join_segment_texts(["Hello.", "World"]), "Hello. World")

    def test_empty_segments_are_skipped(self):
        self.assertEqual(asr.join_segment_texts(["", "你好", "  ", "再见"]), "你好再见")


if __name__ == "__main__":
    unittest.main()
