"""Synthetic, copyright-free test signals."""
import numpy as np

SR = 44100


def click_track(bpm: float, seconds: float, sr: int = SR, offset: float = 0.5, accent: bool = True,
                tone: bool = True, seed: int = 0):
    """Kick-like clicks on every beat (accented downbeats) + a sustained chord tone.
    Returns (stereo audio (2, N), true beat times, true downbeat times)."""
    n = int(seconds * sr)
    y = np.zeros(n, dtype=np.float32)
    period = 60.0 / bpm
    beats = np.arange(offset, seconds - 0.2, period)
    t_hit = np.arange(int(0.12 * sr)) / sr
    for i, b in enumerate(beats):
        down = accent and i % 4 == 0
        f0 = 60 if down else 120
        hit = np.sin(2 * np.pi * f0 * t_hit * (1 + 2 * np.exp(-t_hit * 40))) * np.exp(-t_hit * 30)
        hit += 0.3 * np.random.default_rng(seed + i).standard_normal(len(t_hit)) * np.exp(-t_hit * 300)
        s = int(round(b * sr))
        e = min(n, s + len(hit))
        y[s:e] += (0.9 if down else 0.6) * hit[: e - s]
    if tone:
        t = np.arange(n) / sr
        # A minor chord, changing to F major every 2 bars, on bar boundaries.
        bar = 4 * period
        chord_a = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 261.63, 329.63))
        chord_f = sum(np.sin(2 * np.pi * f * t) for f in (174.61, 220.0, 261.63))
        which = (np.floor((t - offset) / (2 * bar)) % 2 == 0)
        y += 0.05 * np.where(which, chord_a, chord_f).astype(np.float32)
    stereo = np.stack([y, y]).astype(np.float32)
    return stereo, beats, beats[::4]


def free_singing(seconds: float, sr: int = SR, seed: int = 1):
    """Vocal-like notes at irregular times (no steady pulse)."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    y = np.zeros(n, dtype=np.float32)
    t = 0.3
    while t < seconds - 1:
        dur = rng.uniform(0.25, 1.1)
        f = 220 * 2 ** (rng.integers(0, 8) / 12)
        tt = np.arange(int(dur * sr)) / sr
        env = np.minimum(1, tt / 0.05) * np.exp(-tt * 1.5)
        vib = np.sin(2 * np.pi * 5.5 * tt) * 0.01
        note = env * (np.sin(2 * np.pi * f * tt * (1 + vib)) + 0.3 * np.sin(4 * np.pi * f * tt))
        s = int(t * sr)
        e = min(n, s + len(note))
        y[s:e] += 0.3 * note[: e - s]
        t += dur + rng.uniform(0.05, 0.6)
    return np.stack([y, y]).astype(np.float32)


def song(bpm: float = 120, seconds: float = 30, sr: int = SR, offset: float = 0.5):
    """A small synthetic 'song' with known stems. Returns (mix, stems, true_beats)."""
    drums, beats, _ = click_track(bpm, seconds, sr, offset=offset, tone=False)
    n = drums.shape[1]
    t = np.arange(n) / sr
    period = 60 / bpm
    bar = 4 * period
    # Bass: A1 / F1 alternating per 2 bars.
    which = (np.floor((t - offset) / (2 * bar)) % 2 == 0)
    bass = 0.25 * np.sin(2 * np.pi * np.where(which, 55.0, 43.65) * t) * (t > offset)
    other = 0.04 * sum(np.sin(2 * np.pi * f * t) for f in (220.0, 261.63, 329.63)) * (t > offset)
    voc = free_singing(seconds, sr, seed=3)[0] * 0.8
    stems = {
        "drums": drums.astype(np.float32),
        "bass": np.stack([bass, bass]).astype(np.float32),
        "other": np.stack([other, other]).astype(np.float32),
        "vocals": np.stack([voc, voc]).astype(np.float32),
    }
    mix = sum(stems.values()).astype(np.float32)
    return mix, stems, beats
