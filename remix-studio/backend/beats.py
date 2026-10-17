"""Drum/beat engine: synthesized one-shots + 16-step patterns placed on the real beat grid.

No samples are used: every sound is generated with numpy. Hits are placed by
interpolating the song's own (regularized) beat times, so the beat follows the
song rather than assuming a constant BPM.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import signal

from .audio_io import SR

# ------------------------------------------------------------------ synthesis

_rng = np.random.default_rng(1234)


def _t(sec: float, sr: int = SR) -> np.ndarray:
    return np.arange(int(sec * sr)) / sr


def _bandpass(x: np.ndarray, lo: float, hi: float, sr: int = SR, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, [lo, min(hi, sr / 2 * 0.95)], btype="band", fs=sr, output="sos")
    return signal.sosfilt(sos, x)


def _highpass(x: np.ndarray, f: float, sr: int = SR, order: int = 2) -> np.ndarray:
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=sr, output="sos"), x)


def _norm(x: np.ndarray, peak: float = 0.9) -> np.ndarray:
    m = np.max(np.abs(x))
    return (x * (peak / m)).astype(np.float32) if m > 0 else x.astype(np.float32)


def _fade_in(x: np.ndarray, ms: float = 0.5) -> np.ndarray:
    n = min(len(x), int(ms / 1000 * SR))
    if n > 1:
        x[:n] *= np.linspace(0, 1, n)
    return x


def synth_kick(punch: float = 1.0, decay: float = 0.38) -> np.ndarray:
    t = _t(decay + 0.1)
    f = 48 + 110 * np.exp(-t * 28 * punch)            # pitch sweep ~158 Hz -> 48 Hz
    phase = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(phase) * np.exp(-t / decay * 3)
    click = _highpass(_rng.standard_normal(len(t)), 1500) * np.exp(-t * 900) * 0.35
    return _norm(_fade_in(np.tanh(1.6 * (body + click))))


def synth_snare(tone_hz: float = 185.0, decay: float = 0.17) -> np.ndarray:
    t = _t(decay + 0.12)
    noise = _bandpass(_rng.standard_normal(len(t)), 1200, 9000) * np.exp(-t / decay * 3.2)
    tone = (np.sin(2 * np.pi * tone_hz * t) + 0.5 * np.sin(2 * np.pi * tone_hz * 1.78 * t)) * np.exp(-t * 28)
    return _norm(_fade_in(0.75 * noise + 0.55 * tone))


def synth_clap() -> np.ndarray:
    t = _t(0.35)
    env = np.zeros_like(t)
    for d in (0.0, 0.011, 0.022, 0.031):                # several hands, slightly apart
        env += (t >= d) * np.exp(-np.maximum(0, t - d) * 180)
    env += (t >= 0.031) * np.exp(-np.maximum(0, t - 0.031) * 14) * 0.5
    return _norm(_fade_in(_bandpass(_rng.standard_normal(len(t)), 900, 3800) * env))


def _metallic(sec: float) -> np.ndarray:
    """808-style metal: six detuned square waves, high-passed."""
    t = _t(sec)
    freqs = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)
    x = sum(signal.square(2 * np.pi * f * 1.9 * t) for f in freqs) / len(freqs)
    return _highpass(_bandpass(x + 0.4 * _rng.standard_normal(len(t)), 6000, 16000), 7000)


def synth_hat_closed() -> np.ndarray:
    t = _t(0.07)
    return _norm(_fade_in(_metallic(0.07) * np.exp(-t * 70)), 0.6)


def synth_hat_open() -> np.ndarray:
    t = _t(0.45)
    return _norm(_fade_in(_metallic(0.45) * np.exp(-t * 7)), 0.55)


def synth_rim() -> np.ndarray:
    t = _t(0.06)
    x = np.sin(2 * np.pi * 1700 * t) * np.exp(-t * 120) + _bandpass(_rng.standard_normal(len(t)), 2000, 7000) * np.exp(-t * 300)
    return _norm(_fade_in(x), 0.6)


def synth_shaker() -> np.ndarray:
    t = _t(0.12)
    env = np.minimum(1, t / 0.02) * np.exp(-t * 35)
    return _norm(_bandpass(_rng.standard_normal(len(t)), 5000, 12000) * env, 0.4)


def synth_doum() -> np.ndarray:
    """Darbuka 'doum' (low open stroke), original synthesis."""
    t = _t(0.45)
    f = 95 + 40 * np.exp(-t * 40)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
    slap = _bandpass(_rng.standard_normal(len(t)), 300, 1500) * np.exp(-t * 90) * 0.3
    return _norm(_fade_in(body + slap))


def synth_tek() -> np.ndarray:
    """Darbuka 'tek' (bright rim stroke)."""
    t = _t(0.12)
    x = (np.sin(2 * np.pi * 620 * t) * 0.6 + _bandpass(_rng.standard_normal(len(t)), 2500, 9000)) * np.exp(-t * 55)
    return _norm(_fade_in(x), 0.75)


def synth_808(freq: float, length: float, glide_from: float = 0.0, drive: float = 1.4) -> np.ndarray:
    """Tuned 808 bass: sine with optional pitch glide and soft saturation."""
    t = _t(max(0.05, length))
    f = freq * 2 ** ((glide_from * np.exp(-t * 18)) / 12)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    env = np.minimum(1, t / 0.004) * np.exp(-t / max(0.15, length) * 1.6)
    rel = min(len(t), int(0.02 * SR))
    env[-rel:] *= np.linspace(1, 0, rel)
    return (np.tanh(drive * x) / np.tanh(drive) * env * 0.9).astype(np.float32)


def kit() -> dict[str, np.ndarray]:
    return {
        "kick": synth_kick(), "snare": synth_snare(), "clap": synth_clap(),
        "hat": synth_hat_closed(), "ohat": synth_hat_open(), "rim": synth_rim(),
        "shaker": synth_shaker(), "doum": synth_doum(), "tek": synth_tek(),
    }


# ------------------------------------------------------------------ patterns

# 16 steps per bar. x = accent (1.0), o = normal (0.7), - = ghost (0.35), . = rest.
_VEL = {"x": 1.0, "o": 0.7, "-": 0.35, ".": 0.0}


def _p(s: str) -> np.ndarray:
    s = s.replace(" ", "")
    assert len(s) == 16, s
    return np.array([_VEL[c] for c in s], dtype=np.float32)


@dataclass
class Style:
    name: str
    bpm_range: tuple[float, float]       # natural tempo of the groove (drum-beats/min)
    a: dict[str, str]                    # main pattern
    b: dict[str, str]                    # variation (every 4th bar)
    fill: dict[str, str]                 # bar before a section change
    swing: float = 0.0
    hat_rolls: bool = False
    bass_808: str | None = None          # 808 rhythm (steps); None -> style has no 808 by default
    gains: dict[str, float] = field(default_factory=dict)


STYLES: dict[str, Style] = {
    "trap": Style(
        "trap", (130, 160),
        a={"kick": "x.....x...o.....", "snare": "........x.......", "hat": "o.o.o.o.o.o.o.o.", "clap": "........o......."},
        b={"kick": "x.....x.o.....o.", "snare": "........x.......", "hat": "o.o.o.o.o.o.o.o.", "clap": "........o......."},
        fill={"kick": "x.....x.........", "snare": "........x...o-ox", "hat": "o.o.o.o.o.o.o.o."},
        hat_rolls=True, bass_808="x.....x...o.....",
        gains={"hat": 0.55, "clap": 0.6},
    ),
    "drill": Style(
        "drill", (135, 150),
        a={"kick": "x.........x.....", "snare": "......x.......x.", "hat": "o..o..o.o..o..o.", "rim": "...-......-....."},
        b={"kick": "x.....o...x..o..", "snare": "......x.......x.", "hat": "o..o..o.o..o.oo.", "rim": "...-......-....."},
        fill={"kick": "x.........x.....", "snare": "......x...o-x-xx", "hat": "o..o..o.o..o..o."},
        hat_rolls=True, bass_808="x.........x..o..",
        gains={"hat": 0.5, "rim": 0.5},
    ),
    "house": Style(
        "house", (118, 130),
        a={"kick": "x...x...x...x...", "clap": "....x.......x...", "hat": "..o...o...o...o.", "shaker": "-.-.-.-.-.-.-.-."},
        b={"kick": "x...x...x...x...", "clap": "....x.......x...", "hat": "..o...o...o...o.", "ohat": "..............o.", "shaker": "-.-.-.-.-.-.-.-."},
        fill={"kick": "x...x...x...x.x.", "clap": "....x.......x.xx", "hat": "..o...o...o...o."},
        swing=0.1, gains={"hat": 0.5, "ohat": 0.4, "shaker": 0.45},
    ),
    "reggaeton": Style(
        "reggaeton", (88, 100),
        a={"kick": "x...x...x...x...", "snare": "...o..o....o..o.", "hat": "o.o.o.o.o.o.o.o.", "rim": "......-.......-."},
        b={"kick": "x...x...x...x...", "snare": "...o..o....o..o.", "hat": "o.o.o.o.o.o.oooo", "rim": "......-.......-."},
        fill={"kick": "x...x...x...x...", "snare": "...o..o...o-o-xx", "hat": "o.o.o.o.o.o.o.o."},
        bass_808="x.....x.x.......", gains={"hat": 0.45, "rim": 0.5},
    ),
    "mizrahi": Style(
        # Maqsum-inspired: D T - T D - T -  (doum/tek) over a kick backbone.
        "mizrahi", (95, 130),
        a={"doum": "x.......x.......", "tek": "...o.o.....o.o..", "kick": "x.......x...o...", "clap": "....o.......o...", "shaker": "-.-.-.-.-.-.-.-."},
        b={"doum": "x.....o.x.......", "tek": "...o.o.....o.ooo", "kick": "x.......x...o...", "clap": "....o.......o...", "shaker": "-.-.-.-.-.-.-.-."},
        fill={"doum": "x.......x.o.o.o.", "tek": "...o.o.oo-o-oooo", "kick": "x.......x.......", "clap": "....o.......o.oo"},
        swing=0.08, gains={"tek": 0.6, "clap": 0.5, "shaker": 0.4, "kick": 0.85},
    ),
    "boom_bap": Style(
        "boom_bap", (85, 98),
        a={"kick": "x.........x.....", "snare": "....x.......x...", "hat": "o.o.o.o.o.o.o.o."},
        b={"kick": "x.....o...x..o..", "snare": "....x.......x...", "hat": "o.o.o.o.o.o.o.oo"},
        fill={"kick": "x.........x.....", "snare": "....x.......x-xx", "hat": "o.o.o.o.o.o.o.o."},
        swing=0.35, gains={"hat": 0.5},
    ),
    "afro": Style(
        "afro", (100, 115),
        a={"kick": "x..o..x...o..x..", "rim": "...x..x....x..x.", "shaker": "o-oo-oo-o-oo-oo-", "clap": "....x.......x..."},
        b={"kick": "x..o..x...o..x..", "rim": "...x..x..x.x..x.", "shaker": "o-oo-oo-o-oo-oo-", "clap": "....x.......x..."},
        fill={"kick": "x..o..x...o.....", "rim": "...x..x..x.x.xxx", "shaker": "o-oo-oo-o-oo-oo-", "clap": "....x.......x.x."},
        swing=0.15, gains={"rim": 0.55, "shaker": 0.45, "clap": 0.5},
    ),
    "lofi": Style(
        "lofi", (70, 90),
        a={"kick": "x......o..x.....", "snare": "....x.......x...", "hat": "o.-.o.-.o.-.o.-."},
        b={"kick": "x......o..x..o..", "snare": "....x.......x..-", "hat": "o.-.o.-.o.-.o.-."},
        fill={"kick": "x......o..x.....", "snare": "....x.......x.--", "hat": "o.-.o.-.o.-.o.-."},
        swing=0.4, gains={"hat": 0.4, "snare": 0.75, "kick": 0.85},
    ),
}

STYLE_NAMES_HE = {
    "trap": "טראפ", "drill": "דריל", "house": "האוס", "reggaeton": "רגאטון",
    "mizrahi": "מזרחית", "boom_bap": "בום-בפ", "afro": "אפרו", "lofi": "לו-פיי",
}


def tempo_multiplier(song_bpm: float, style: Style, feel: str = "auto") -> float:
    """Drum-beats per song-beat: 0.5 (half-time), 1, or 2 (double-time)."""
    if feel == "half":
        return 0.5
    if feel == "double":
        return 2.0
    if feel == "normal":
        return 1.0
    lo, hi = style.bpm_range
    mid = (lo + hi) / 2

    def cost(m):
        b = song_bpm * m
        return 0.0 if lo <= b <= hi else min(abs(b - lo), abs(b - hi)) / mid

    # Prefer 1.0 on ties.
    return min((1.0, 2.0, 0.5), key=cost)


# ------------------------------------------------------------------ placement

@dataclass
class Hit:
    time: float
    inst: str
    vel: float


@dataclass
class DrumTrack:
    audio: np.ndarray              # mono drums (N,)
    bass: np.ndarray               # mono 808 (N,) (zeros when unused)
    hits: list[Hit]
    kick_times: np.ndarray
    multiplier: float
    start_time: float


def _time_at(beats: np.ndarray, pos: np.ndarray) -> np.ndarray:
    """Time for fractional song-beat positions (linear interpolation, linear extrapolation)."""
    idx = np.arange(len(beats))
    t = np.interp(pos, idx, beats)
    p0 = beats[1] - beats[0]
    p1 = beats[-1] - beats[-2]
    t = np.where(pos < 0, beats[0] + pos * p0, t)
    t = np.where(pos > idx[-1], beats[-1] + (pos - idx[-1]) * p1, t)
    return t


def build_drums(
    beats: np.ndarray,
    first_downbeat: int,
    end_time: float,
    n_samples: int,
    style_name: str,
    song_bpm: float,
    intensity: float = 0.7,
    swing: float | None = None,
    drop_at_bar: int | None = None,
    feel: str = "auto",
    section_starts: list[int] | None = None,
    bass_pc_per_beat: np.ndarray | None = None,
    key_root: int = 9,
    add_808: bool = False,
    pitch_shift: int = 0,
    sr: int = SR,
) -> DrumTrack:
    """Render a drum (+ optional 808) track aligned to `beats`.

    first_downbeat: index into `beats` where bar 0 starts.
    section_starts: bar indices (relative to bar 0) where a new section begins;
                    the bar before each gets a fill.
    """
    style = STYLES[style_name]
    mult = tempo_multiplier(song_bpm, style, feel)
    swing = style.swing if swing is None else swing
    intensity = float(np.clip(intensity, 0, 1))
    sounds = kit()

    # A bar = 4 drum-beats = 4/mult song beats.
    song_beats_per_bar = 4.0 / mult
    t_first = beats[first_downbeat]
    n_bars = int(np.floor((len(beats) - 1 - first_downbeat) / song_beats_per_bar)) + 1
    sections = set(section_starts or [])
    for k in range(8, n_bars + 1, 8):
        sections.add(k)
    if drop_at_bar:
        sections.add(drop_at_bar)

    hits: list[Hit] = []
    bass_notes: list[tuple[float, float, int]] = []  # (time, vel, pitch class)
    for bar in range(n_bars):
        if drop_at_bar and bar < drop_at_bar:
            continue
        if bar + 1 in sections:
            pat = style.fill
        elif bar % 4 == 3:
            pat = style.b
        else:
            pat = style.a
        pos0 = first_downbeat + bar * song_beats_per_bar
        step_pos = pos0 + np.arange(16) * (song_beats_per_bar / 16)
        step_len_beats = song_beats_per_bar / 16
        # Swing delays every odd 16th by up to 1/3 of a 16th (triplet feel at swing=1).
        swung = step_pos + (np.arange(16) % 2) * swing * step_len_beats / 3
        times = _time_at(beats, swung)
        for inst, s in pat.items():
            vel = _p(s)
            for st in np.nonzero(vel)[0]:
                v = vel[st]
                if inst in ("hat", "shaker") and intensity < 0.35 and st % 4 != 0:
                    continue
                if v < 0.4 and intensity < 0.5:  # ghost notes only at higher intensity
                    continue
                hits.append(Hit(float(times[st]), inst, float(v)))
        if intensity >= 0.75 and "shaker" not in pat and style_name not in ("lofi",):
            for st in range(2, 16, 4):
                hits.append(Hit(float(times[st]), "shaker", 0.5))
        if style.hat_rolls and bar % 2 == 1 and pat is not style.fill:
            _hat_roll(hits, beats, pos0 + 3 * song_beats_per_bar / 4, song_beats_per_bar / 4, intensity)
        rhythm = style.bass_808 if style.bass_808 else "x.......x......."
        if add_808:
            vel = _p(rhythm)
            for st in np.nonzero(vel)[0]:
                bp = int(np.floor(step_pos[st] + 1e-6))
                pc = key_root
                if bass_pc_per_beat is not None and 0 <= bp < len(bass_pc_per_beat) and bass_pc_per_beat[bp] >= 0:
                    pc = int(bass_pc_per_beat[bp])
                bass_notes.append((float(times[st]), float(vel[st]), (pc + pitch_shift) % 12))

    hits = [h for h in hits if 0 <= h.time < end_time]
    hits.sort(key=lambda h: h.time)
    audio = np.zeros(n_samples, dtype=np.float32)
    for h in hits:
        s = int(round(h.time * sr))
        smp = sounds[h.inst] * (h.vel * style.gains.get(h.inst, 1.0))
        e = min(n_samples, s + len(smp))
        if e > s:
            audio[s:e] += smp[: e - s]
    audio = _apply_hat_choke(audio, hits, sounds, style, n_samples, sr)

    bass = _render_808(bass_notes, end_time, n_samples, sr) if add_808 else np.zeros(n_samples, dtype=np.float32)
    kicks = np.array([h.time for h in hits if h.inst in ("kick", "doum")])
    start = hits[0].time if hits else t_first
    return DrumTrack(audio=audio, bass=bass, hits=hits, kick_times=kicks, multiplier=mult, start_time=start)


def _apply_hat_choke(audio, hits, sounds, style, n, sr):
    """Re-render open hats truncated at the next closed hat (classic hi-hat choke)."""
    ohats = [h for h in hits if h.inst == "ohat"]
    if not ohats:
        return audio
    closed = np.array([h.time for h in hits if h.inst == "hat"])
    for h in ohats:
        s = int(round(h.time * sr))
        smp = sounds["ohat"] * (h.vel * style.gains.get("ohat", 1.0))
        nxt = closed[closed > h.time + 1e-4]
        if nxt.size:
            cut = int(round((nxt[0] - h.time) * sr))
            if cut < len(smp):
                tail = smp[cut:].copy()
                fade = np.linspace(1, 0, min(len(tail), int(0.01 * sr)))
                tail[: len(fade)] *= 1 - fade  # amount to remove: everything except a 10 ms fade
                e = min(n, s + cut + len(tail))
                audio[s + cut: e] -= tail[: e - s - cut]
    return audio


def _hat_roll(hits: list[Hit], beats: np.ndarray, pos: float, span: float, intensity: float) -> None:
    """Replace hats in the last beat with a 32nd (or triplet) roll."""
    t0, t1 = _time_at(beats, np.array([pos, pos + span]))
    hits[:] = [h for h in hits if not (h.inst == "hat" and t0 - 1e-4 <= h.time < t1)]
    n = 6 if intensity < 0.6 else 8
    for i in range(n):
        p = pos + span * i / n
        hits.append(Hit(float(_time_at(beats, np.array([p]))[0]), "hat", 0.45 + 0.4 * i / n))


def _render_808(notes, end_time, n, sr) -> np.ndarray:
    out = np.zeros(n, dtype=np.float32)
    notes = [x for x in notes if x[0] < end_time]
    for i, (t, v, pc) in enumerate(notes):
        nxt = notes[i + 1][0] if i + 1 < len(notes) else min(end_time, t + 1.0)
        length = max(0.08, min(1.2, nxt - t))
        freq = 440 * 2 ** ((pc - 9) / 12) / 8          # octave 1: A1 = 55 Hz
        if freq < 38:
            freq *= 2
        glide = 0.0 if i == 0 or notes[i - 1][2] == pc else (notes[i - 1][2] - pc)
        smp = synth_808(freq, length, glide_from=float(np.clip(glide, -7, 7))) * v
        s = int(round(t * sr))
        e = min(n, s + len(smp))
        if e > s:
            # Each note ends (with a release) where the next begins, so the line is monophonic.
            out[s:e] += smp[: e - s]
    return out
