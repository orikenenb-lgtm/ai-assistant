import subprocess

import numpy as np
import pytest

from backend import audio_io
from backend.errors import UserError
from synth import click_track


def _ff(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


@pytest.fixture
def wav(tmp_path):
    audio, _, _ = click_track(120, 4)
    return audio_io.write_wav(audio, tmp_path / "in.wav")


@pytest.mark.parametrize("ext,codec", [
    ("opus", ["-c:a", "libopus", "-b:a", "32k"]),             # WhatsApp voice note
    ("ogg", ["-c:a", "libopus"]),
    ("m4a", ["-c:a", "aac"]),                                  # iPhone
    ("webm", ["-c:a", "libopus"]),                             # browser recording
    ("mp3", ["-c:a", "libmp3lame"]),
    ("flac", ["-c:a", "flac"]),
])
def test_decodes_common_formats(tmp_path, wav, ext, codec):
    out = tmp_path / f"x.{ext}"
    _ff("-i", str(wav), *codec, str(out))
    a = audio_io.decode(out)
    assert a.shape[0] == 2 and abs(a.shape[1] / 44100 - 4) < 0.1


def test_video_container_audio_is_extracted(tmp_path, wav):
    out = tmp_path / "v.mp4"
    _ff("-f", "lavfi", "-i", "color=c=black:s=64x64:d=4", "-i", str(wav), "-shortest", "-c:v", "libx264",
        "-c:a", "aac", str(out))
    info = audio_io.probe(out)
    assert info.has_video
    assert audio_io.decode(out).shape[1] > 44100 * 3


def test_corrupt_file_raises_clean_error(tmp_path):
    p = tmp_path / "bad.mp3"
    p.write_bytes(b"ID3" + np.random.default_rng(0).bytes(5000))
    with pytest.raises(UserError):
        audio_io.decode(p)


def test_text_file_with_audio_extension(tmp_path):
    p = tmp_path / "fake.wav"
    p.write_text("hello")
    with pytest.raises(UserError):
        audio_io.decode(p)


def test_too_long_is_rejected(tmp_path):
    p = tmp_path / "long.opus"
    _ff("-f", "lavfi", "-i", "sine=f=220:d=610", "-c:a", "libopus", "-b:a", "16k", str(p))
    with pytest.raises(UserError, match="ארוך"):
        audio_io.decode(p)


def test_exactly_ten_minutes_is_accepted(tmp_path):
    p = tmp_path / "ten.opus"
    _ff("-f", "lavfi", "-i", "sine=f=220:d=600", "-c:a", "libopus", "-b:a", "16k", str(p))
    a = audio_io.decode(p)
    assert abs(a.shape[1] / 44100 - 600) < 1


def test_silence_detection(tmp_path):
    assert audio_io.is_silent(np.zeros((2, 44100), np.float32))


def test_safe_stem_keeps_hebrew_and_strips_paths():
    assert audio_io.safe_stem("../../etc/שיר שלי (רמיקס).mp3") == "שיר-שלי-רמיקס"
    assert audio_io.safe_stem("") == "audio"
    assert "/" not in audio_io.safe_stem("a/b\\c.wav")
