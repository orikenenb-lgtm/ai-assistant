"""Audio decoding/encoding via ffmpeg.

Everything inside the pipeline is float32, shape (channels=2, samples), 44.1 kHz.
Input validation is done by actually probing/decoding the file, never by extension.
"""
from __future__ import annotations

import json
import re
import subprocess
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from .errors import UserError

SR = 44100
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
MAX_DURATION_SEC = 10 * 60
MIN_DURATION_SEC = 0.5
# Small tolerance so a file that is "exactly 10:00" by the user's player is accepted.
_DURATION_TOLERANCE = 1.0

ALLOWED_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".webm",
    ".flac", ".mp4", ".mov", ".3gp", ".caf",
}


@dataclass
class ProbeInfo:
    duration: float
    codec: str
    has_video: bool


def safe_stem(filename: str, max_len: int = 60) -> str:
    """Turn a user filename into a safe base name (keeps Hebrew letters)."""
    stem = Path(filename or "").stem
    stem = unicodedata.normalize("NFC", stem)
    # Keep letters (any script), digits, space, dash, underscore.
    stem = re.sub(r"[^\w\- ]+", "", stem, flags=re.UNICODE)
    stem = re.sub(r"\s+", "-", stem).strip("-_.")
    return (stem[:max_len] or "audio")


def probe(path: str | Path) -> ProbeInfo:
    """Inspect a file with ffprobe. Raises UserError if it is not usable audio."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_entries", "format=duration:stream=codec_type,codec_name,duration",
                str(path),
            ],
            capture_output=True, check=True, timeout=60,
        ).stdout
        info = json.loads(out or b"{}")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        raise UserError("הקובץ לא נקרא כקובץ שמע תקין. נסה קובץ אחר.") from e

    streams = info.get("streams", [])
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if not audio:
        raise UserError("לא נמצא שמע בקובץ הזה.")
    duration = _to_float(info.get("format", {}).get("duration")) or _to_float(audio[0].get("duration"))
    return ProbeInfo(
        duration=duration or 0.0,
        codec=audio[0].get("codec_name", "?"),
        has_video=any(s.get("codec_type") == "video" for s in streams),
    )


def _to_float(v) -> float | None:
    try:
        f = float(v)
        return f if np.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def decode(path: str | Path, sr: int = SR, max_duration: float = MAX_DURATION_SEC) -> np.ndarray:
    """Decode any supported input to float32 stereo (2, N) at `sr`.

    Duration limits are enforced on the decoded result (container metadata can lie,
    e.g. browser webm recordings often have no duration header).
    """
    probe(path)
    # Read at most max_duration + tolerance; if we got more than that, the file is too long.
    limit = max_duration + _DURATION_TOLERANCE + 0.5
    try:
        proc = subprocess.run(
            [
                "ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-t", f"{limit:.2f}",
                "-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "-acodec", "pcm_f32le", "pipe:1",
            ],
            capture_output=True, check=True, timeout=300,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        raise UserError("לא הצלחתי לפענח את הקובץ. ייתכן שהוא פגום.") from e

    data = np.frombuffer(proc.stdout, dtype=np.float32)
    if data.size < 2:
        raise UserError("הקובץ ריק או פגום.")
    audio = data[: data.size - data.size % 2].reshape(-1, 2).T.copy()
    audio = np.nan_to_num(audio, nan=0.0, posinf=0.0, neginf=0.0)

    duration = audio.shape[1] / sr
    if duration > max_duration + _DURATION_TOLERANCE:
        raise UserError(f"הקובץ ארוך מדי. האורך המקסימלי הוא {int(max_duration // 60)} דקות.")
    if duration < MIN_DURATION_SEC:
        raise UserError("הקובץ קצר מדי (פחות מחצי שנייה).")
    return audio


def is_silent(audio: np.ndarray, threshold_db: float = -60.0) -> bool:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    return peak <= 10 ** (threshold_db / 20)


def write_wav(audio: np.ndarray, path: str | Path, sr: int = SR, subtype: str = "PCM_24") -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), _as_frames(audio), sr, subtype=subtype)
    return path


def encode(audio: np.ndarray, path: str | Path, fmt: str, sr: int = SR) -> Path:
    """Write `audio` as 'wav' (24-bit PCM) or 'mp3' (320 kbps CBR)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "wav":
        return write_wav(audio, path, sr)
    if fmt != "mp3":
        raise ValueError(f"unknown format {fmt}")
    frames = np.ascontiguousarray(_as_frames(audio), dtype=np.float32)
    channels = frames.shape[1]
    subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error", "-y",
            "-f", "f32le", "-ar", str(sr), "-ac", str(channels), "-i", "pipe:0",
            "-codec:a", "libmp3lame", "-b:a", "320k", str(path),
        ],
        input=frames.tobytes(), check=True, capture_output=True, timeout=600,
    )
    return path


def _as_frames(audio: np.ndarray) -> np.ndarray:
    """(C, N) -> (N, C) for soundfile/ffmpeg."""
    if audio.ndim == 1:
        return audio[:, None]
    return audio.T


def to_mono(audio: np.ndarray) -> np.ndarray:
    return audio.mean(axis=0) if audio.ndim == 2 else audio
