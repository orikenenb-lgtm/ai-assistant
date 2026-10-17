"""Effect chains built on Spotify's pedalboard."""
from __future__ import annotations

import numpy as np
from pedalboard import (
    Chorus, Compressor, Delay, Distortion, Gain, HighpassFilter, HighShelfFilter,
    LowpassFilter, LowShelfFilter, Pedalboard, PeakFilter, Reverb,
)
from scipy import signal

from .audio_io import SR


def _run(board: Pedalboard, audio: np.ndarray, sr: int = SR) -> np.ndarray:
    return board(np.ascontiguousarray(audio, dtype=np.float32), sr)


def vocal_chain(audio: np.ndarray, *, reverb: float = 0.0, delay: float = 0.0, distortion: float = 0.0,
                telephone: bool = False, chorus: float = 0.0, beat_period: float = 0.5,
                sr: int = SR) -> np.ndarray:
    """Vocal processing. All amounts are 0..1. Delay is synced to 1/8 note (beat_period/2)."""
    fx = [HighpassFilter(90), Compressor(threshold_db=-20, ratio=3, attack_ms=5, release_ms=120)]
    if telephone:
        fx += [HighpassFilter(400), LowpassFilter(3200), PeakFilter(1500, 6, 1.0), Distortion(8)]
    if distortion > 0:
        fx += [Distortion(drive_db=4 + 26 * distortion), LowpassFilter(9000 - 4000 * distortion),
               Gain(-6 * distortion)]
    if chorus > 0:
        fx.append(Chorus(rate_hz=0.8, depth=0.2 + 0.3 * chorus, mix=0.25 + 0.35 * chorus))
    if delay > 0:
        fx.append(Delay(delay_seconds=float(np.clip(beat_period / 2, 0.05, 2.0)), feedback=0.15 + 0.35 * delay,
                        mix=0.12 + 0.3 * delay))
    if reverb > 0:
        fx.append(Reverb(room_size=0.35 + 0.6 * reverb, damping=0.5, wet_level=0.12 + 0.35 * reverb,
                         dry_level=1.0 - 0.3 * reverb, width=1.0))
    fx.append(HighShelfFilter(8000, 2.0))
    return _run(Pedalboard(fx), audio, sr)


def drum_bus(audio: np.ndarray, style: str, sr: int = SR) -> np.ndarray:
    """Glue + color for synthesized drums."""
    fx = [Compressor(threshold_db=-12, ratio=2.5, attack_ms=10, release_ms=80)]
    if style == "lofi":
        fx += [LowpassFilter(6500), Distortion(6), Gain(-3)]
    elif style == "boom_bap":
        fx += [LowpassFilter(11000), Distortion(4), Gain(-2)]
    elif style in ("trap", "drill"):
        fx += [LowShelfFilter(80, 2.0)]
    return _run(Pedalboard(fx), audio, sr)


def bass_bus(audio: np.ndarray, sr: int = SR) -> np.ndarray:
    return _run(Pedalboard([LowpassFilter(220), Compressor(threshold_db=-14, ratio=3, attack_ms=5, release_ms=150)]), audio, sr)


def master_compress(audio: np.ndarray, amount: float, sr: int = SR) -> np.ndarray:
    if amount <= 0:
        return audio
    board = Pedalboard([Compressor(threshold_db=-6 - 14 * amount, ratio=1.5 + 2.5 * amount, attack_ms=20, release_ms=200)])
    return _run(board, audio, sr)


def high_pass(audio: np.ndarray, hz: float, sr: int = SR) -> np.ndarray:
    return _run(Pedalboard([HighpassFilter(hz)]), audio, sr)


def lowpass_sweep(audio: np.ndarray, start: float, end: float, f_from: float = 300.0,
                  f_to: float = 18000.0, sr: int = SR) -> np.ndarray:
    """Low-pass filter opening exponentially from f_from to f_to between start..end seconds."""
    a, b = int(start * sr), int(end * sr)
    if b <= a + sr // 10:
        return audio
    out = audio.copy()
    seg = audio[:, a:b]
    block = 512
    n_blocks = int(np.ceil(seg.shape[1] / block))
    zi = None
    res = np.empty_like(seg)
    for i in range(n_blocks):
        frac = i / max(1, n_blocks - 1)
        fc = f_from * (f_to / f_from) ** frac
        sos = signal.butter(2, min(fc, sr * 0.45), btype="low", fs=sr, output="sos")
        if zi is None:
            zi = np.zeros((seg.shape[0], sos.shape[0], 2))
        s, e = i * block, min(seg.shape[1], (i + 1) * block)
        for c in range(seg.shape[0]):
            res[c, s:e], zi[c] = signal.sosfilt(sos, seg[c, s:e], zi=zi[c])
    out[:, a:b] = res
    # Before `start`, keep the filter closed for consistency.
    if a > 0:
        sos = signal.butter(2, f_from, btype="low", fs=sr, output="sos")
        out[:, :a] = signal.sosfiltfilt(sos, audio[:, :a], axis=1)
    return out
