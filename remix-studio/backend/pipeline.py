"""Orchestrates each mode. Independent of Modal: heavy models are passed in as callables.

`separate(audio) -> {stem: audio}` and `transcribe(audio16k) -> Transcript` are injected,
so on Modal they call the GPU class, and in tests they can be fakes.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import librosa
import numpy as np

from . import analysis, audio_io, beats, effects, mixing, timestretch
from .audio_io import SR
from .errors import UserError
from .planner import RemixPlan
from .separation import STEMS
from .transcription import WHISPER_SR, to_srt, to_txt

log = logging.getLogger(__name__)

MODES = ("remix", "separate", "transcribe", "convert")

# Progress steps per mode: (key, Hebrew label).
STEPS = {
    "remix": [("upload", "מעלה"), ("separate", "מפריד שכבות"), ("analyze", "מנתח קצב"),
              ("beat", "בונה ביט"), ("mix", "מערבב"), ("done", "מוכן")],
    "separate": [("upload", "מעלה"), ("separate", "מפריד שכבות"), ("encode", "מכין קבצים"), ("done", "מוכן")],
    "transcribe": [("upload", "מעלה"), ("transcribe", "מתמלל"), ("encode", "מכין קבצים"), ("done", "מוכן")],
    "convert": [("upload", "מעלה"), ("analyze", "מנתח"), ("mix", "מנרמל עוצמה"), ("done", "מוכן")],
}

STEM_LABELS_HE = {"vocals": "קול", "drums": "תופים", "bass": "בס", "other": "שאר הכלים"}


@dataclass
class OutFile:
    name: str
    label_he: str
    kind: str          # "audio" | "text"

    def to_dict(self, size: int) -> dict:
        return {"name": self.name, "label_he": self.label_he, "kind": self.kind, "size": size}


@dataclass
class Result:
    files: list[OutFile] = field(default_factory=list)
    duration: float | None = None
    bpm: float | None = None
    key: str | None = None
    notes_he: str = ""
    transcript: str | None = None
    plan: dict | None = None
    stats: dict = field(default_factory=dict)


Progress = Callable[[str, int], None]


def _noop(step: str, pct: int) -> None:
    pass


def run(mode: str, input_path: Path, out_dir: Path, *, base_name: str, output_format: str = "mp3",
        plan: RemixPlan | None = None, separate=None, transcribe=None, progress: Progress = _noop,
        stems_cache: Path | None = None) -> Result:
    if mode not in MODES:
        raise UserError("מצב לא מוכר.")
    if output_format not in ("mp3", "wav"):
        output_format = "mp3"
    out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    audio = audio_io.decode(input_path)
    if audio_io.is_silent(audio):
        raise UserError("הקובץ שקט לגמרי — אין מה לעבד.")
    progress("upload", 100)

    if mode == "convert":
        res = _convert(audio, out_dir, base_name, output_format, progress)
    elif mode == "separate":
        res = _separate(audio, out_dir, base_name, output_format, separate, progress, stems_cache)
    elif mode == "transcribe":
        res = _transcribe(audio, out_dir, base_name, transcribe, progress)
    else:
        res = _remix(audio, out_dir, base_name, plan or RemixPlan(output_format=output_format),
                     separate, progress, stems_cache)
    res.duration = round(res.duration or audio.shape[1] / SR, 2)
    res.stats["seconds_total"] = round(time.time() - t0, 2)
    progress("done", 100)
    return res


# ------------------------------------------------------------------ modes

def _convert(audio, out_dir, base, fmt, progress) -> Result:
    an = analysis.analyze(audio)
    progress("analyze", 100)
    y = mixing.normalize_loudness(audio)
    name = f"{base}_clean.{fmt}"
    audio_io.encode(y, out_dir / name, fmt)
    progress("mix", 100)
    return Result(
        files=[OutFile(name, "הקובץ הנקי", "audio")], bpm=an.bpm if an.steady else None,
        key=an.key_name_he if an.steady else None,
        notes_he=f"הומר ל-{fmt.upper()} ונורמל לעוצמה אחידה (‎-14 LUFS), בלי שינויים מוזיקליים.",
    )


def _get_stems(audio, separate, progress, stems_cache: Path | None) -> tuple[dict[str, np.ndarray], bool]:
    """Separate (or load cached stems from a previous job on the same upload)."""
    if stems_cache is not None and all((stems_cache / f"{s}.npy").exists() for s in STEMS):
        stems = {s: np.load(stems_cache / f"{s}.npy").astype(np.float32) for s in STEMS}
        if all(v.shape[-1] == audio.shape[-1] for v in stems.values()):
            progress("separate", 100)
            return stems, True
    if separate is None:
        raise UserError("הפרדת שכבות לא זמינה כרגע.")
    progress("separate", 10)
    stems = separate(audio)
    stems = {s: mixing.fit_length(np.asarray(stems[s], dtype=np.float32), audio.shape[-1]) for s in STEMS}
    if stems_cache is not None:
        stems_cache.mkdir(parents=True, exist_ok=True)
        for s, v in stems.items():
            if not (stems_cache / f"{s}.npy").exists():  # the GPU worker may have written them already
                np.save(stems_cache / f"{s}.npy", v.astype(np.float16))  # half the volume space
    progress("separate", 100)
    return stems, False


def _separate(audio, out_dir, base, fmt, separate, progress, stems_cache) -> Result:
    stems, cached = _get_stems(audio, separate, progress, stems_cache)
    files = []
    for s in STEMS:
        name = f"{base}_{s}.{fmt}"
        # Keep the stems' relative balance; only protect against clipping.
        audio_io.encode(mixing.limit(stems[s]), out_dir / name, fmt)
        files.append(OutFile(name, STEM_LABELS_HE[s], "audio"))
    progress("encode", 100)
    an = analysis.analyze(audio, beat_source=stems["drums"] + stems["bass"])
    return Result(files=files, bpm=an.bpm if an.steady else None, key=an.key_name_he,
                  notes_he="השיר הופרד ל-4 שכבות: קול, תופים, בס ושאר הכלים.",
                  stats={"stems_cached": cached})


def _transcribe(audio, out_dir, base, transcribe, progress) -> Result:
    if transcribe is None:
        raise UserError("תמלול לא זמין כרגע.")
    progress("transcribe", 10)
    y16 = librosa.resample(audio_io.to_mono(audio), orig_sr=SR, target_sr=WHISPER_SR).astype(np.float32)
    tr = transcribe(y16)
    progress("transcribe", 100)
    if not tr.segments:
        raise UserError("לא זוהה דיבור או שירה בקובץ.")
    (out_dir / f"{base}.txt").write_text(to_txt(tr), encoding="utf-8")
    (out_dir / f"{base}.srt").write_text(to_srt(tr.segments), encoding="utf-8")
    progress("encode", 100)
    lang_he = {"he": "עברית", "en": "אנגלית", "ar": "ערבית", "ru": "רוסית", "fr": "צרפתית", "es": "ספרדית", "am": "אמהרית"}
    lang = lang_he.get(tr.language, tr.language)
    return Result(files=[OutFile(f"{base}.txt", "תמלול (טקסט)", "text"), OutFile(f"{base}.srt", "כתוביות SRT", "text")],
                  transcript=tr.text, notes_he=f"תומלל בשפה: {lang}.", stats={"language": tr.language})


def _remix(audio, out_dir, base, plan: RemixPlan, separate, progress, stems_cache) -> Result:
    fmt = plan.output_format
    notes: list[str] = [plan.notes_he] if plan.notes_he else []
    stems, cached = _get_stems(audio, separate, progress, stems_cache)
    n0 = audio.shape[-1]

    an = analysis.analyze(audio, beat_source=stems["drums"] + stems["bass"] + stems["other"])
    progress("analyze", 60)
    # Bass line per beat index (index-aligned, so valid after any tempo change).
    bass_pc = analysis.bass_notes_per_beat(stems["bass"], an.beats) if plan.add_808 and plan.add_drums else None

    # Tempo/pitch on the stems (drums are synthesized later, already at the new tempo).
    rate = 1.0 + plan.tempo_change_pct / 100.0
    semis = plan.pitch_shift_semitones
    keep = plan.keep_stems.model_dump()
    gains = plan.stem_gain_db.model_dump()
    for s in STEMS:
        if keep[s] and (abs(rate - 1) > 1e-3 or semis):
            y = timestretch.time_stretch(stems[s], rate)
            if semis and s != "drums":
                y = timestretch.pitch_shift(y, semis)
            stems[s] = y
    n = int(round(n0 / rate))
    beat_times = an.beats / rate
    bpm = an.bpm * rate
    progress("analyze", 100)

    # Vocal processing.
    vocals = stems["vocals"]
    if keep["vocals"]:
        v = plan.vocal_fx
        if v.reverb or v.delay or v.distortion or v.chorus or v.telephone_filter:
            vocals = effects.vocal_chain(vocals, reverb=v.reverb, delay=v.delay, distortion=v.distortion,
                                         telephone=v.telephone_filter, chorus=v.chorus, beat_period=60 / bpm)

    mix = np.zeros((2, n), dtype=np.float32)
    if keep["vocals"]:
        mix += mixing.fit_length(vocals, n) * mixing.db_to_gain(gains["vocals"])

    drum_track = None
    instrumental = np.zeros((2, n), dtype=np.float32)
    for s in ("drums", "bass", "other"):
        if keep[s]:
            instrumental += mixing.fit_length(stems[s], n) * mixing.db_to_gain(gains[s])

    stats = {"stems_cached": cached, "steady_tempo": an.steady, "grid_residual_ms": an.grid_residual_ms}
    if plan.add_drums is not None:
        d = plan.add_drums
        if not an.steady:
            # Free-tempo material: don't warp the voice; lay a steady grid from the first vocal onset.
            beat_times, bpm = _free_grid(vocals, n, an.bpm * rate, d.style)
            notes.append("שים לב: הקלטה בקצב חופשי (בלי מטרונום) — התופים לא תמיד יינעלו בדיוק על השירה.")
            first_db = 0
            start_t = beat_times[0]
        else:
            start_t = max(an.music_start / rate, 0.0)
            first_db = _first_strong_downbeat(an, beat_times, mix + instrumental, start_t)
        sections = _section_starts(audio, an, first_db) if an.steady else []
        if not an.steady:
            bass_pc = None
        drum_track = beats.build_drums(
            beat_times, first_db, end_time=min(n / SR, an.music_end / rate + 0.05), n_samples=n,
            style_name=d.style, song_bpm=bpm, intensity=d.intensity, swing=d.swing,
            drop_at_bar=d.drop_at_bar, feel=d.feel, section_starts=sections,
            bass_pc_per_beat=bass_pc, key_root=an.key_root, add_808=plan.add_808,
            pitch_shift=semis,
        )
        progress("beat", 70)
        drums_st = effects.drum_bus(mixing.to_stereo(drum_track.audio), d.style)
        # Sidechain-style ducking of the music under the new kicks keeps the low end clean.
        duck = mixing.ducking_envelope(drum_track.kick_times, n, depth_db=2.5 + 3 * d.intensity)
        instrumental *= duck[None, :]
        # Level the drums relative to the music so they sit in the mix, not on top of it.
        drums_st *= _relative_gain(drums_st, mix + instrumental, target_db=-1.5)
        mix += instrumental + drums_st
        if plan.add_808 and np.any(drum_track.bass):
            b808 = effects.bass_bus(mixing.to_stereo(drum_track.bass))
            b808 *= _relative_gain(b808, mix, target_db=-5.0)
            mix += b808
        stats.update({"drum_hits": len(drum_track.hits), "drum_multiplier": drum_track.multiplier,
                      "drums_start": round(drum_track.start_time, 3)})
        notes.append(f"נוסף ביט {beats.STYLE_NAMES_HE[d.style]} שנעול על הקצב של השיר.")
    else:
        mix += instrumental
    progress("beat", 100)

    if plan.master_fx.lowpass_sweep_intro and drum_track is not None and drum_track.start_time > 2.0:
        mix = effects.lowpass_sweep(mix, max(0.0, drum_track.start_time - 8 * 60 / bpm), drum_track.start_time)
    mix = effects.master_compress(mix, plan.master_fx.compression)
    mix = mixing.normalize_loudness(mix)
    progress("mix", 80)

    tag = plan.label or (plan.add_drums.style if plan.add_drums else "remix")
    name = f"{base}_remix_{tag}.{fmt}"
    audio_io.encode(mix, out_dir / name, fmt)
    files = [OutFile(name, "הרמיקס", "audio")]
    # Also expose the new drums alone (useful for checking / re-using the beat).
    if drum_track is not None:
        dname = f"{base}_beat_{plan.add_drums.style}.{fmt}"
        audio_io.encode(mixing.limit(mixing.to_stereo(drum_track.audio + drum_track.bass) * 0.8), out_dir / dname, fmt)
        files.append(OutFile(dname, "הביט לבד", "audio"))
        (out_dir / "hits.json").write_text(json.dumps(
            [{"t": round(h.time, 4), "i": h.inst} for h in drum_track.hits]), encoding="utf-8")
    progress("mix", 100)

    if abs(plan.tempo_change_pct) >= 0.5:
        notes.append(f"קצב: {an.bpm:.0f} → {bpm:.0f} BPM.")
    if semis:
        notes.append(f"גובה הוזז ב-{semis:+d} חצאי טונים.")
    return Result(files=files, duration=n / SR, bpm=round(bpm, 1), key=_shift_key(an, semis),
                  notes_he=" ".join(dict.fromkeys(x for x in notes if x)), plan=plan.model_dump(), stats=stats)


# ------------------------------------------------------------------ helpers

def _relative_gain(x: np.ndarray, ref: np.ndarray, target_db: float) -> float:
    """Gain so that x's loudness sits `target_db` relative to ref's loudness."""
    lx, lr = analysis.loudness(x), analysis.loudness(ref)
    if not np.isfinite(lx):
        return 1.0
    if not np.isfinite(lr):
        lr = -16.0
    return float(np.clip(mixing.db_to_gain(lr + target_db - lx), 0.05, 8.0))


def _first_strong_downbeat(an: analysis.Analysis, beat_times: np.ndarray, mix: np.ndarray, start_t: float) -> int:
    """First downbeat where the music is actually playing (skips silence / fade-in)."""
    rms = librosa.feature.rms(y=audio_io.to_mono(mix), hop_length=1024)[0]
    if rms.max() <= 0:
        return an.downbeat_phase
    thresh = np.percentile(rms[rms > 0], 60) * 0.35
    idx = np.arange(an.downbeat_phase, len(beat_times), 4)
    for i in idx:
        if beat_times[i] < start_t - 0.05:
            continue
        a = int(beat_times[i] * SR / 1024)
        b = a + max(1, int(2 * (beat_times[min(i + 4, len(beat_times) - 1)] - beat_times[i]) * SR / 1024))
        if rms[a:b].size and rms[a:b].mean() >= thresh:
            return int(i)
    return int(idx[0]) if idx.size else 0


def _free_grid(vocals: np.ndarray, n: int, bpm_guess: float, style: str) -> tuple[np.ndarray, float]:
    lo, hi = beats.STYLES[style].bpm_range
    bpm = bpm_guess if lo * 0.75 <= bpm_guess <= hi * 1.25 else (lo + hi) / 2
    y = audio_io.to_mono(vocals)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    on = np.nonzero(rms > rms.max() * 0.1)[0] if rms.max() > 0 else np.array([0])
    start = float(on[0] * 512 / SR) if on.size else 0.0
    period = 60 / bpm
    return np.arange(start, n / SR + period, period), bpm


def _section_starts(audio: np.ndarray, an: analysis.Analysis, first_db: int) -> list[int]:
    """Bars (relative to first_db) where the song changes character (chroma/timbre novelty)."""
    try:
        y = librosa.resample(audio_io.to_mono(audio), orig_sr=SR, target_sr=11025)
        hop = 512
        feat = np.vstack([
            librosa.feature.chroma_stft(y=y, sr=11025, hop_length=hop),
            librosa.util.normalize(librosa.feature.mfcc(y=y, sr=11025, hop_length=hop, n_mfcc=13), axis=1),
        ])
        bar_idx = np.arange(first_db, len(an.beats), 4)
        frames = np.clip((an.beats[bar_idx] * 11025 / hop).astype(int), 0, feat.shape[1] - 1)
        bars = np.array([feat[:, frames[i]:max(frames[i] + 1, frames[i + 1])].mean(axis=1)
                         for i in range(len(frames) - 1)])
        if len(bars) < 12:
            return []
        out = []
        for k in range(4, len(bars) - 4, 4):
            prev, nxt = bars[k - 4:k].mean(0), bars[k:k + 4].mean(0)
            out.append((k, float(np.linalg.norm(prev - nxt))))
        vals = np.array([v for _, v in out])
        thr = vals.mean() + 0.75 * vals.std()
        return [k for k, v in out if v > thr]
    except Exception:  # sections are a nicety; never fail a job for them
        log.exception("section detection failed")
        return []


def _shift_key(an: analysis.Analysis, semis: int) -> str:
    root = (an.key_root + semis) % 12
    return f"{analysis.NOTE_NAMES_HE[root]} {'מז׳ור' if an.key_mode == 'major' else 'מינור'}"
