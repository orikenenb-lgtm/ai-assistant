"""Tempo change without pitch change, and pitch shift without tempo change.

Uses Rubber Band (pyrubberband + rubberband CLI) when available - much better
quality - otherwise librosa's phase vocoder.
"""
from __future__ import annotations

import shutil

import librosa
import numpy as np

from .audio_io import SR


def _has_rubberband() -> bool:
    return shutil.which("rubberband") is not None


def backend_name() -> str:
    return "rubberband" if _has_rubberband() else "librosa"


def time_stretch(audio: np.ndarray, rate: float, sr: int = SR) -> np.ndarray:
    """rate > 1 = faster (shorter). Output length = round(N / rate)."""
    if abs(rate - 1.0) < 1e-4:
        return audio
    n_out = int(round(audio.shape[-1] / rate))
    if _has_rubberband():
        import pyrubberband as pyrb
        y = pyrb.time_stretch(audio.T, sr, rate, rbargs={"--fine": ""}).T
    else:
        y = np.stack([librosa.effects.time_stretch(ch, rate=rate) for ch in np.atleast_2d(audio)])
    return _fit(y.astype(np.float32), n_out)


def pitch_shift(audio: np.ndarray, semitones: float, sr: int = SR) -> np.ndarray:
    if abs(semitones) < 1e-3:
        return audio
    n = audio.shape[-1]
    if _has_rubberband():
        import pyrubberband as pyrb
        y = pyrb.pitch_shift(audio.T, sr, semitones, rbargs={"--formant": ""}).T
    else:
        y = np.stack([librosa.effects.pitch_shift(ch, sr=sr, n_steps=semitones) for ch in np.atleast_2d(audio)])
    return _fit(y.astype(np.float32), n)


def _fit(y: np.ndarray, n: int) -> np.ndarray:
    if y.shape[-1] >= n:
        return y[..., :n]
    return np.pad(y, [(0, 0)] * (y.ndim - 1) + [(0, n - y.shape[-1])])
