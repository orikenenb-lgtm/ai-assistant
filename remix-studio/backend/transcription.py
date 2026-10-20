"""Speech/lyrics transcription with faster-whisper (large-v3 on GPU).

Hebrew is the default; if the audio is clearly another language, that language is used.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

WHISPER_SR = 16000


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    language: str
    language_probability: float
    segments: list[Segment]

    @property
    def text(self) -> str:
        return "\n".join(s.text for s in self.segments if s.text)


def choose_language(detected: str, prob: float, default: str = "he") -> str:
    """Keep Hebrew unless another language is detected with confidence."""
    if detected == default or prob < 0.6:
        return default
    return detected


class Transcriber:
    def __init__(self, model: str = "large-v3", device: str = "cuda", compute_type: str = "float16",
                 download_root: str | None = None):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model, device=device, compute_type=compute_type, download_root=download_root)

    def transcribe(self, audio16k: np.ndarray, default_language: str = "he") -> Transcript:
        audio16k = np.ascontiguousarray(audio16k, dtype=np.float32)
        detected, prob, _ = self.model.detect_language(audio16k, vad_filter=True, language_detection_segments=3)
        lang = choose_language(detected, prob, default_language)
        segments, _info = self.model.transcribe(
            audio16k, language=lang, beam_size=5, vad_filter=True, word_timestamps=True,
            condition_on_previous_text=False,
        )
        out = [Segment(float(s.start), float(s.end), s.text.strip()) for s in segments if s.text.strip()]
        return Transcript(lang, float(prob), out)


def _ts(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def to_srt(segments: list[Segment], max_chars: int = 84) -> str:
    blocks = []
    for i, s in enumerate(segments, 1):
        text = s.text if len(s.text) <= max_chars else _wrap(s.text, max_chars // 2)
        blocks.append(f"{i}\n{_ts(s.start)} --> {_ts(max(s.end, s.start + 0.3))}\n{text}\n")
    return "\n".join(blocks)


def _wrap(text: str, width: int) -> str:
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def to_txt(t: Transcript) -> str:
    return t.text + "\n"
