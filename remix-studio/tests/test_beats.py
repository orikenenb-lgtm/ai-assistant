import numpy as np
import pytest

from backend import beats as B
from backend.analysis import analyze
from synth import click_track

SR = 44100


@pytest.fixture(scope="module")
def grid():
    audio, true_beats, _ = click_track(120, 30, offset=0.5)
    an = analyze(audio)
    return an, audio.shape[1]


@pytest.mark.parametrize("style", list(B.STYLES))
def test_every_style_renders_and_locks_to_beats(grid, style):
    an, n = grid
    first = an.first_downbeat_index(0.4)
    tr = B.build_drums(an.beats, first, end_time=n / SR, n_samples=n, style_name=style,
                       song_bpm=an.bpm, intensity=0.8, feel="normal", add_808=True)
    assert np.all(np.isfinite(tr.audio)) and np.abs(tr.audio).max() > 0.05
    # Every hit that is on a quarter-note step (unswung) lands within 20 ms of a detected beat.
    on_beats = [h.time for h in tr.hits if h.inst in ("kick", "doum") ]
    assert on_beats
    d = np.array([np.min(np.abs(an.beats - t)) for t in on_beats])
    quarter = d[d < 0.06]  # kicks on 8th/16th offbeats are excluded
    assert quarter.size and quarter.max() < 0.020


def test_rendered_kicks_are_audibly_on_the_beat(grid):
    """Measure in the rendered audio itself: re-detect the beat of the new drum track
    (with the same calibrated tracker) and compare against the song's grid."""
    an, n = grid
    tr = B.build_drums(an.beats, an.first_downbeat_index(0.4), n / SR, n, "house", an.bpm, intensity=0.6)
    drums_an = analyze(np.stack([tr.audio, tr.audio]))
    assert abs(drums_an.bpm - an.bpm) < 1
    inside = drums_an.beats[(drums_an.beats > tr.start_time + 0.2) & (drums_an.beats < n / SR - 1)]
    d = np.array([np.min(np.abs(an.beats - b)) for b in inside])
    assert np.median(d) < 0.010 and d.max() < 0.020


def test_tempo_multiplier():
    trap = B.STYLES["trap"]
    assert B.tempo_multiplier(70, trap) == 2.0
    assert B.tempo_multiplier(140, trap) == 1.0
    assert B.tempo_multiplier(140, B.STYLES["lofi"]) == 0.5
    assert B.tempo_multiplier(140, trap, "half") == 0.5


def test_drop_at_bar_delays_drums(grid):
    an, n = grid
    first = an.first_downbeat_index(0.4)
    tr = B.build_drums(an.beats, first, n / SR, n, "trap", an.bpm, drop_at_bar=4, feel="normal")
    bar_len = 4 * 60 / an.bpm
    assert tr.start_time >= an.beats[first] + 4 * bar_len - 0.03


def test_808_is_tuned_to_key():
    y = B.synth_808(55.0, 0.8)
    f = np.fft.rfftfreq(len(y), 1 / SR)[np.argmax(np.abs(np.fft.rfft(y)))]
    assert abs(f - 55.0) < 3
