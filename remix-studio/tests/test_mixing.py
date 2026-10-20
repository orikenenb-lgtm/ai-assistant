import numpy as np
import pytest

from backend import audio_io, mixing, timestretch
from backend.analysis import loudness
from synth import click_track


def test_limiter_never_clips():
    rng = np.random.default_rng(0)
    x = rng.standard_normal((2, 44100 * 5)).astype(np.float32) * 0.8  # peaks way above 0 dBFS
    y = mixing.limit(x, ceiling_db=-1.0)
    assert mixing.peak_db(y) <= -0.99


@pytest.mark.parametrize("fmt", ["wav", "mp3"])
def test_normalize_to_minus_14_without_clipping(tmp_path, fmt):
    audio, _, _ = click_track(120, 20)
    for scale in (0.02, 1.5):  # very quiet and clipping-hot inputs
        y = mixing.normalize_loudness(audio * scale)
        p = audio_io.encode(y, tmp_path / f"o_{scale}.{fmt}", fmt)
        back = audio_io.decode(p)
        assert mixing.peak_db(back) <= -0.3
        assert abs(loudness(back) - (-14)) <= 1.0


@pytest.mark.parametrize("pct", [10, -20, 30])
def test_tempo_change_duration(pct):
    audio, _, _ = click_track(100, 10)
    rate = 1 + pct / 100
    y = timestretch.time_stretch(audio, rate)
    assert abs(y.shape[1] / 44100 - 10 / rate) < 0.05


def test_tempo_change_actually_changes_bpm():
    from backend.analysis import analyze
    audio, _, _ = click_track(100, 20)
    y = timestretch.time_stretch(audio, 1.1)
    assert abs(analyze(y).bpm - 110) <= 2


def test_ducking_envelope():
    env = mixing.ducking_envelope(np.array([1.0]), 44100 * 2, depth_db=6)
    assert env.min() < 0.55 and env[0] == 1.0 and env[-1] > 0.99
