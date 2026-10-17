"""Mixing and mastering: summing, sidechain-style ducking, true lookahead limiter,
loudness normalization to -14 LUFS without clipping."""
from __future__ import annotations

import numpy as np
from numba import njit
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import resample_poly

from .analysis import loudness
from .audio_io import SR

TARGET_LUFS = -14.0
CEILING_DB = -1.2  # true-peak ceiling; leaves headroom for MP3 encoding overshoot


def db_to_gain(db: float) -> float:
    return float(10 ** (db / 20))


def fit_length(x: np.ndarray, n: int) -> np.ndarray:
    """Pad/trim the last axis to n samples."""
    if x.shape[-1] >= n:
        return x[..., :n]
    pad = [(0, 0)] * (x.ndim - 1) + [(0, n - x.shape[-1])]
    return np.pad(x, pad)


def to_stereo(x: np.ndarray) -> np.ndarray:
    return np.stack([x, x]) if x.ndim == 1 else x


def ducking_envelope(times: np.ndarray, n: int, depth_db: float = 4.0, attack: float = 0.004,
                     release: float = 0.16, sr: int = SR) -> np.ndarray:
    """Gain curve that dips by depth_db at each kick (sidechain pumping)."""
    env = np.ones(n, dtype=np.float32)
    if depth_db <= 0 or len(times) == 0:
        return env
    floor = db_to_gain(-depth_db)
    a, r = int(attack * sr), int(release * sr)
    shape = np.concatenate([np.linspace(1, floor, max(1, a)), floor + (1 - floor) * (1 - np.exp(-np.arange(r) / (r / 4)))])
    for t in times:
        s = int(round(t * sr)) - a  # dip starts just before the hit (lookahead)
        if s >= n:
            continue
        lo = max(0, s)
        seg = shape[lo - s:]
        e = min(n, lo + len(seg))
        env[lo:e] = np.minimum(env[lo:e], seg[: e - lo])
    return env


@njit(cache=True)
def _release_smooth(gr_db, release_coef):
    out = np.empty_like(gr_db)
    prev = 0.0
    for i in range(gr_db.shape[0]):
        g = gr_db[i]
        prev = g if g > prev else prev * release_coef
        out[i] = prev
    return out


def limit(audio: np.ndarray, ceiling_db: float = CEILING_DB, lookahead_ms: float = 3.0,
          release_ms: float = 80.0, sr: int = SR) -> np.ndarray:
    """Stereo-linked lookahead brickwall limiter. Guarantees |out| <= ceiling."""
    x = to_stereo(audio).astype(np.float32)
    ceiling = db_to_gain(ceiling_db)
    peak = true_peak_envelope(x)
    if peak.max() <= ceiling:
        return x
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-12))
    gr_db = -20 * np.log10(need)                         # >= 0 dB of reduction needed
    la = max(1, int(lookahead_ms / 1000 * sr))
    # Hold the max reduction over the lookahead window (centered so it starts early).
    gr_db = -minimum_filter1d(-gr_db, size=2 * la + 1, mode="nearest")
    coef = np.exp(-1.0 / (release_ms / 1000 * sr))
    gr_db = _release_smooth(gr_db.astype(np.float64), coef)
    # Smooth the attack; the 2*la hold window guarantees the average never undershoots.
    gr_db = uniform_filter1d(gr_db, size=la, mode="nearest")
    gain = (10 ** (-gr_db / 20)).astype(np.float32)
    y = x * gain[None, :]
    return np.clip(y, -ceiling, ceiling)  # numerical safety; should be a no-op


def true_peak_envelope(x: np.ndarray, oversample: int = 4, chunk: int = 1 << 20) -> np.ndarray:
    """Per-sample max |x| over channels, including inter-sample peaks (4x oversampling)."""
    n = x.shape[-1]
    out = np.empty(n, dtype=np.float32)
    pad = 64
    for s in range(0, n, chunk):
        a, b = max(0, s - pad), min(n, s + chunk + pad)
        up = np.abs(resample_poly(x[:, a:b], oversample, 1, axis=1))
        up = up.max(axis=0)[: (b - a) * oversample].reshape(-1, oversample).max(axis=1)
        out[s:min(n, s + chunk)] = np.maximum(up[s - a: s - a + min(chunk, n - s)], np.abs(x[:, s:s + chunk]).max(axis=0))
    return out


def normalize_loudness(audio: np.ndarray, target_lufs: float = TARGET_LUFS,
                       ceiling_db: float = CEILING_DB, sr: int = SR) -> np.ndarray:
    """Gain to target loudness, then limit; iterate because limiting lowers loudness."""
    x = to_stereo(audio).astype(np.float32)
    cur = loudness(x, sr)
    if not np.isfinite(cur):
        return x
    gain_db = target_lufs - cur
    y = x
    for _ in range(10):
        y = limit(x * db_to_gain(gain_db), ceiling_db, sr=sr)
        cur = loudness(y, sr)
        err = target_lufs - cur
        if abs(err) < 0.25:
            break
        # Under heavy limiting extra gain yields less loudness, so overshoot the step a bit.
        gain_db = min(gain_db + err * (1.6 if err > 0 else 1.0), 60.0)
    return y


def peak_db(audio: np.ndarray) -> float:
    p = float(np.max(np.abs(audio)))
    return 20 * np.log10(p) if p > 0 else -np.inf
