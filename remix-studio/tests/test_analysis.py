import numpy as np
import pytest

from backend.analysis import analyze
from synth import click_track, free_singing


@pytest.mark.parametrize("bpm", [120, 95, 140, 82])
def test_bpm_and_beat_positions(bpm):
    audio, beats, downs = click_track(bpm, 40, offset=0.37)
    an = analyze(audio)
    assert abs(an.bpm - bpm) <= 2
    err = np.array([np.min(np.abs(an.beats - b)) for b in beats])
    assert err.max() < 0.020, f"max beat error {err.max()*1000:.1f} ms"
    assert an.steady
    # Downbeat (bar start) found on the accented beat.
    assert abs(an.beats[an.first_downbeat_index(0.3)] - beats[0]) < 0.02


def test_free_tempo_is_flagged_unsteady():
    an = analyze(free_singing(30))
    assert not an.steady


def test_short_two_second_file():
    audio, _, _ = click_track(120, 2.0, offset=0.1)
    an = analyze(audio)
    assert len(an.beats) >= 3
    assert np.isfinite(an.loudness_lufs)
