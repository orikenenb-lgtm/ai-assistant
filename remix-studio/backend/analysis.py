"""Musical analysis: tempo, regularized beat grid, downbeats, key, loudness.

The beat grid is the foundation for drum placement, so it is built carefully:
librosa beat tracking -> snap each beat to the nearest onset peak -> assign
integer beat indices (filling dropped beats) -> local robust linear regression
(follows slow tempo drift, removes jitter) -> extrapolate over the whole file.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import librosa
import numpy as np
import pyloudnorm as pyln

from .audio_io import SR, to_mono

ANALYSIS_SR = 22050
HOP = 256
BPM_MIN, BPM_MAX = 70.0, 180.0

NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
NOTE_NAMES_HE = ["דו", "דו דיאז", "רה", "מי במול", "מי", "פה", "פה דיאז", "סול", "לה במול", "לה", "סי במול", "סי"]

# Krumhansl-Kessler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass
class Analysis:
    duration: float
    bpm: float
    beats: np.ndarray                 # regularized beat times (s), covering the whole file
    downbeat_phase: int               # beats[i] is a downbeat iff (i - downbeat_phase) % 4 == 0
    steady: bool                      # False for free-tempo material (a cappella, speech)
    beat_salience: float
    grid_residual_ms: float
    key_root: int                     # pitch class 0..11
    key_mode: str                     # "major" | "minor"
    loudness_lufs: float
    music_start: float
    music_end: float
    notes: list[str] = field(default_factory=list)

    @property
    def key_name(self) -> str:
        return f"{NOTE_NAMES[self.key_root]} {self.key_mode}"

    @property
    def key_name_he(self) -> str:
        return f"{NOTE_NAMES_HE[self.key_root]} {'מז׳ור' if self.key_mode == 'major' else 'מינור'}"

    @property
    def downbeats(self) -> np.ndarray:
        return self.beats[self.downbeat_phase::4]

    def first_downbeat_index(self, after: float) -> int:
        """Index (into beats) of the first downbeat at or after `after` seconds."""
        idx = np.arange(self.downbeat_phase, len(self.beats), 4)
        ok = idx[self.beats[idx] >= after - 0.05]
        return int(ok[0]) if ok.size else int(idx[-1])


def loudness(audio: np.ndarray, sr: int = SR) -> float:
    """Integrated loudness in LUFS (-inf for silence)."""
    data = audio.T if audio.ndim == 2 else audio
    if data.shape[0] < int(0.4 * sr):  # pyloudnorm needs >= one 400 ms block
        pad = np.zeros((int(0.4 * sr) - data.shape[0],) + data.shape[1:], dtype=data.dtype)
        data = np.concatenate([data, pad])
    return float(pyln.Meter(sr).integrated_loudness(data))


def analyze(audio: np.ndarray, sr: int = SR, beat_source: np.ndarray | None = None) -> Analysis:
    """Analyze `audio` (C, N). `beat_source` (e.g. the instrumental stem) is used for
    beat tracking when given and not silent; key/loudness always use `audio`."""
    duration = audio.shape[-1] / sr
    mono = to_mono(audio)
    y = librosa.resample(mono, orig_sr=sr, target_sr=ANALYSIS_SR).astype(np.float32)

    yb = y
    if beat_source is not None:
        cand = librosa.resample(to_mono(beat_source), orig_sr=sr, target_sr=ANALYSIS_SR).astype(np.float32)
        if np.sqrt(np.mean(cand ** 2)) > 0.1 * np.sqrt(np.mean(y ** 2)) + 1e-6:
            yb = cand

    music_start, music_end = _music_bounds(y)
    beats, salience, resid_ms, steady = _beat_grid(yb, duration)
    beats = beats + _phase_correction(yb, beats)
    period = float(np.median(np.diff(beats)))
    bpm = 60.0 / period

    # Normalize to the 70-180 range (plan can still pick half/double feel later).
    if bpm < BPM_MIN:
        beats = _double_grid(beats)
        bpm *= 2
    elif bpm > BPM_MAX:
        beats = _halve_grid(beats, yb)
        bpm /= 2

    phase = _downbeat_phase(yb, beats)
    root, mode = _estimate_key(y)
    notes = []
    if not steady:
        notes.append("unsteady_tempo")
    return Analysis(
        duration=duration, bpm=round(bpm, 2), beats=beats, downbeat_phase=phase,
        steady=steady, beat_salience=round(salience, 3), grid_residual_ms=round(resid_ms, 2),
        key_root=root, key_mode=mode, loudness_lufs=round(loudness(audio, sr), 2),
        music_start=music_start, music_end=music_end, notes=notes,
    )


# ---------------------------------------------------------------- beat grid

def _onset_env(y: np.ndarray) -> np.ndarray:
    return librosa.onset.onset_strength(y=y, sr=ANALYSIS_SR, hop_length=HOP)


def _beat_grid(y: np.ndarray, duration: float) -> tuple[np.ndarray, float, float, bool]:
    env = _onset_env(y)
    frame_t = librosa.frames_to_time(np.arange(len(env)), sr=ANALYSIS_SR, hop_length=HOP)
    tempo, frames = librosa.beat.beat_track(
        onset_envelope=env, sr=ANALYSIS_SR, hop_length=HOP, tightness=100, trim=False,
    )
    frames = np.asarray(frames, dtype=int)
    if frames.size < 4:
        # No usable pulse: fall back to librosa's tempo estimate on a constant grid.
        bpm = float(np.atleast_1d(tempo)[0]) or 120.0
        start = float(frame_t[int(np.argmax(env))]) if env.size else 0.0
        return _constant_grid(start, 60.0 / bpm, duration), 1.0, 999.0, False

    # Snap each beat to the strongest onset within +-35 ms (parabolic peak interpolation).
    radius = max(1, int(round(0.035 * ANALYSIS_SR / HOP)))
    snapped = []
    for f in frames:
        lo, hi = max(0, f - radius), min(len(env), f + radius + 1)
        k = lo + int(np.argmax(env[lo:hi]))
        snapped.append(_interp_peak(env, k))
    t = np.asarray(snapped) * HOP / ANALYSIS_SR
    t = np.unique(np.round(t, 4))

    mean_env = float(np.mean(env)) + 1e-9
    salience = float(np.mean([env[min(len(env) - 1, int(round(x * ANALYSIS_SR / HOP)))] for x in t])) / mean_env

    # Integer beat indices; IOIs that span several periods mean dropped beats.
    period0 = float(np.median(np.diff(t)))
    k = np.maximum(1, np.round(np.diff(t) / period0)).astype(int)
    idx = np.concatenate([[0], np.cumsum(k)])

    grid_at_idx, resid = _local_fit(idx, t, half_window=8)
    resid_ms = float(np.median(np.abs(resid)) * 1000)
    ioi = np.diff(t) / k
    cv = float(np.std(ioi) / (np.mean(ioi) + 1e-9))
    steady = salience >= 1.8 and resid_ms <= 20.0 and cv <= 0.12

    # Fill the full index range, then extrapolate to cover the whole file.
    full_idx = np.arange(idx[0], idx[-1] + 1)
    full_t = np.interp(full_idx, idx, grid_at_idx)
    p_start = float(np.median(np.diff(full_t[:9]))) if len(full_t) > 2 else period0
    p_end = float(np.median(np.diff(full_t[-9:]))) if len(full_t) > 2 else period0
    n_before = int(np.ceil(full_t[0] / p_start)) if full_t[0] > 0 else 0
    before = full_t[0] - p_start * np.arange(n_before, 0, -1)
    n_after = int(np.ceil((duration - full_t[-1]) / p_end)) + 1
    after = full_t[-1] + p_end * np.arange(1, n_after + 1)
    beats = np.concatenate([before, full_t, after])
    beats = beats[(beats >= -1e-6) & (beats < duration + p_end)]
    return beats.astype(np.float64), salience, resid_ms, steady


def _phase_correction(y: np.ndarray, beats: np.ndarray) -> float:
    """Global shift (s) that aligns the grid with actual attack starts.

    The spectral-flux envelope peaks ~10-15 ms after a transient starts. Here a
    fine log-energy derivative (1.5 ms resolution) finds the true attack near each
    beat; the median offset of salient attacks is the correction.
    """
    hop, frame = 32, 256
    rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop, center=True)[0]
    log_e = np.log(rms + 1e-6)
    rise = np.maximum(0.0, np.diff(log_e, prepend=log_e[0]))
    # Smooth a little so single-sample noise doesn't win.
    rise = np.convolve(rise, np.ones(3) / 3, mode="same")
    fps = ANALYSIS_SR / hop
    offs, weights = [], []
    for b in beats:
        lo, hi = int((b - 0.04) * fps), int((b + 0.03) * fps)
        if lo < 0 or hi >= len(rise):
            continue
        k = lo + int(np.argmax(rise[lo:hi]))
        w = rise[k]
        if w > 0:
            # Centered frames start "seeing" an attack half a frame before it happens.
            offs.append(k / fps + (frame / 2) / ANALYSIS_SR - b)
            weights.append(w)
    if len(offs) < 4:
        return 0.0
    offs, weights = np.asarray(offs), np.asarray(weights)
    keep = weights >= np.percentile(weights, 50)
    shift = float(np.median(offs[keep]))
    return float(np.clip(shift, -0.035, 0.035))


def _interp_peak(env: np.ndarray, k: int) -> float:
    if 0 < k < len(env) - 1:
        a, b, c = env[k - 1], env[k], env[k + 1]
        denom = a - 2 * b + c
        if denom < 0:
            return k + 0.5 * (a - c) / denom
    return float(k)


def _local_fit(idx: np.ndarray, t: np.ndarray, half_window: int) -> tuple[np.ndarray, np.ndarray]:
    """Robust local linear regression t ~ a + b*idx around each beat."""
    n = len(idx)
    out = np.empty(n)
    for i in range(n):
        lo, hi = max(0, i - half_window), min(n, i + half_window + 1)
        xi, ti = idx[lo:hi].astype(float), t[lo:hi]
        mask = np.ones_like(ti, dtype=bool)
        for _ in range(3):
            if mask.sum() < 2:
                break
            b, a = np.polyfit(xi[mask], ti[mask], 1)
            r = ti - (a + b * xi)
            new_mask = np.abs(r) < max(0.03, 2.5 * np.median(np.abs(r[mask])))
            if new_mask.sum() < 2 or np.array_equal(new_mask, mask):
                break
            mask = new_mask
        out[i] = a + b * idx[i]
    return out, t - out


def _constant_grid(start: float, period: float, duration: float) -> np.ndarray:
    first = start - period * np.floor(start / period)
    return np.arange(first, duration + period, period)


def _double_grid(beats: np.ndarray) -> np.ndarray:
    mids = (beats[:-1] + beats[1:]) / 2
    out = np.empty(len(beats) + len(mids))
    out[0::2], out[1::2] = beats, mids
    return out


def _halve_grid(beats: np.ndarray, y: np.ndarray) -> np.ndarray:
    env = _onset_env(y)
    fr = np.clip(np.round(beats * ANALYSIS_SR / HOP).astype(int), 0, len(env) - 1)
    s0, s1 = env[fr[0::2]].mean(), env[fr[1::2]].mean() if len(fr) > 1 else 0
    return beats[0::2] if s0 >= s1 else beats[1::2]


def _downbeat_phase(y: np.ndarray, beats: np.ndarray) -> int:
    """Choose which beat (mod 4) starts a bar: strong low-end onsets + harmonic changes."""
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=ANALYSIS_SR, n_fft=2048)
    low = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S[freqs < 180]), sr=ANALYSIS_SR)
    chroma = librosa.feature.chroma_stft(S=S ** 2, sr=ANALYSIS_SR, hop_length=HOP)
    n = S.shape[1]
    fr = np.clip(np.round(beats * ANALYSIS_SR / HOP).astype(int), 0, n - 1)

    def zs(x):
        return (x - x.mean()) / (x.std() + 1e-9)

    low_at = np.array([low[max(0, f - 1): f + 2].max() for f in fr])
    # Bass energy right after each beat (downbeats usually carry the strongest low end).
    low_pow = (S[freqs < 150] ** 2).sum(axis=0)
    w = max(1, int(0.1 * ANALYSIS_SR / HOP))
    bass_at = np.log(np.array([low_pow[f: f + w].mean() if f < n else 0.0 for f in fr]) + 1e-9)
    # Harmonic change: chroma difference between the beat before and after each beat.
    seg = np.array([chroma[:, fr[max(0, i - 1)]: max(fr[max(0, i - 1)] + 1, fr[i])].mean(axis=1) for i in range(len(fr))])
    change = np.r_[0, np.linalg.norm(np.diff(seg, axis=0), axis=1)]
    score_beat = zs(low_at) + zs(bass_at) + 0.75 * zs(change)
    scores = [score_beat[p::4].mean() if len(score_beat[p::4]) else -np.inf for p in range(4)]
    return int(np.argmax(scores))


def _estimate_key(y: np.ndarray) -> tuple[int, str]:
    if not np.any(y):
        return 0, "major"
    chroma = librosa.feature.chroma_cqt(y=y, sr=ANALYSIS_SR, hop_length=2048, tuning=0.0)
    prof = chroma.mean(axis=1)
    best = (-np.inf, 0, "major")
    for root in range(12):
        for mode, tmpl in (("major", _MAJOR), ("minor", _MINOR)):
            c = np.corrcoef(prof, np.roll(tmpl, root))[0, 1]
            if np.isfinite(c) and c > best[0]:
                best = (c, root, mode)
    return best[1], best[2]


def _music_bounds(y: np.ndarray) -> tuple[float, float]:
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    if rms.max() <= 0:
        return 0.0, len(y) / ANALYSIS_SR
    on = np.nonzero(rms > rms.max() * 10 ** (-40 / 20))[0]
    t = librosa.frames_to_time(on, sr=ANALYSIS_SR, hop_length=512)
    return float(t[0]), float(min(len(y) / ANALYSIS_SR, t[-1] + 0.1))


def bass_notes_per_beat(audio: np.ndarray, beats: np.ndarray, sr: int = SR) -> np.ndarray:
    """Dominant low pitch class for each beat (for tuning 808s to the real bass line).

    Returns an int array (len(beats)), -1 where nothing clear is playing.
    """
    y = librosa.resample(to_mono(audio), orig_sr=sr, target_sr=ANALYSIS_SR)
    if not np.any(y):
        return -np.ones(len(beats), dtype=int)
    chroma = librosa.feature.chroma_cqt(y=y, sr=ANALYSIS_SR, hop_length=HOP, fmin=librosa.note_to_hz("C1"), n_octaves=3, tuning=0.0)
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    n = chroma.shape[1]
    fr = np.clip(np.round(beats * ANALYSIS_SR / HOP).astype(int), 0, n)
    out = -np.ones(len(beats), dtype=int)
    thresh = rms.max() * 0.08
    for i in range(len(fr)):
        a, b = fr[i], fr[i + 1] if i + 1 < len(fr) else min(n, fr[i] + 8)
        if b <= a or rms[a:b].mean() < thresh:
            continue
        c = chroma[:, a:b].mean(axis=1)
        if c.max() > 1.4 * np.median(c):
            out[i] = int(np.argmax(c))
    return out
