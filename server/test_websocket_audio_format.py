import unittest

from main import detect_realtime_audio_suffix


class WebsocketAudioFormatTest(unittest.TestCase):
    def test_detect_realtime_audio_suffix_prefers_webm_for_unknown_header(self):
        self.assertEqual(detect_realtime_audio_suffix(b"OggS\x00\x02"), ".ogg")
        self.assertEqual(detect_realtime_audio_suffix(b"RIFF\x24\x80"), ".wav")
        self.assertEqual(detect_realtime_audio_suffix(bytes.fromhex("1A45DFA301020304")), ".webm")
        self.assertEqual(detect_realtime_audio_suffix(b"\x00\x11\x22\x33\x44"), ".webm")


if __name__ == "__main__":
    unittest.main()
