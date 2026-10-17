import json

import numpy as np
import pytest

from backend import audio_io, mixing, pipeline
from backend.analysis import analyze, loudness
from backend.errors import UserError
from backend.planner import RemixPlan, preset_plan
from backend.transcription import Segment, Transcript
from synth import click_track, free_singing, song


@pytest.fixture(scope="module")
def song120(tmp_path_factory):
    d = tmp_path_factory.mktemp("song")
    mix, stems, beats = song(120, 30)
    path = audio_io.write_wav(mix, d / "in.wav")
    return path, stems, beats


def _check_audio(path, expect_duration):
    y = audio_io.decode(path)
    assert mixing.peak_db(y) <= -0.3
    assert abs(loudness(y) + 14) <= 1.0
    assert abs(y.shape[1] / 44100 - expect_duration) < 0.15
    return y


def test_remix_trap_drums_locked_to_song(song120, tmp_path):
    path, stems, true_beats = song120
    calls = []
    res = pipeline.run("remix", path, tmp_path, base_name="שיר", plan=preset_plan("trap"),
                       separate=lambda a: calls.append(1) or stems, progress=lambda s, p: None,
                       stems_cache=tmp_path / "stems")
    assert res.files[0].name == "שיר_remix_trap.mp3"
    assert abs(res.bpm - 120) <= 2
    _check_audio(tmp_path / res.files[0].name, 30)
    hits = json.loads((tmp_path / "hits.json").read_text())
    kicks = [h["t"] for h in hits if h["i"] == "kick"]
    d = np.array([np.min(np.abs(true_beats - t)) for t in kicks])
    on_beat = d[d < 0.06]
    assert on_beat.size >= 12 and on_beat.max() < 0.020   # one per bar (step 1) in trap, locked to the real beat
    # Main snares land on beat 3 of each bar (trap backbeat) -> the bar grid is right too.
    # (Fill bars add extra 16th-note snares, so look at the snares that are on a beat.)
    snares = np.array([h["t"] for h in hits if h["i"] == "snare"])
    on = [t for t in snares if np.min(np.abs(true_beats - t)) < 0.02]
    assert len(on) >= 12
    third_beats = true_beats[2::4]
    on_third = [t for t in on if np.min(np.abs(third_beats - t)) < 0.02]
    assert len(on_third) >= 0.8 * len(on)   # the rest are fill hits on beat 4

    # "Another version" re-uses cached stems: no second separation.
    res2 = pipeline.run("remix", path, tmp_path / "v2", base_name="שיר", plan=preset_plan("house"),
                        separate=lambda a: calls.append(1) or stems, stems_cache=tmp_path / "stems")
    assert len(calls) == 1 and res2.stats["stems_cached"]


def test_remix_with_tempo_change(song120, tmp_path):
    path, stems, _ = song120
    plan = RemixPlan.model_validate({"add_drums": {"style": "house"}, "tempo_change_pct": 10})
    res = pipeline.run("remix", path, tmp_path, base_name="s", plan=plan, separate=lambda a: stems)
    y = _check_audio(tmp_path / res.files[0].name, 30 / 1.1)
    assert abs(res.bpm - 132) <= 2
    assert abs(analyze(y).bpm - 132) <= 2.5


def test_remix_acapella_free_tempo_warns(tmp_path):
    voc = free_singing(20)
    path = audio_io.write_wav(voc, tmp_path / "v.wav")
    stems = {"vocals": voc, "drums": voc * 0, "bass": voc * 0, "other": voc * 0}
    res = pipeline.run("remix", path, tmp_path, base_name="v", plan=preset_plan("trap"), separate=lambda a: stems)
    assert "קצב חופשי" in res.notes_he
    _check_audio(tmp_path / res.files[0].name, 20)


def test_separate_mode(song120, tmp_path):
    path, stems, _ = song120
    res = pipeline.run("separate", path, tmp_path, base_name="s", output_format="wav", separate=lambda a: stems)
    assert [f.name for f in res.files] == [f"s_{s}.wav" for s in ("vocals", "drums", "bass", "other")]
    for f in res.files:
        y = audio_io.decode(tmp_path / f.name)
        assert mixing.peak_db(y) <= -0.3


def test_transcribe_mode(song120, tmp_path):
    path, _, _ = song120
    fake = Transcript("he", 0.9, [Segment(0.5, 2.0, "שלום עולם"), Segment(2.2, 4.0, "בדיקה שתיים")])
    seen = {}

    def tr(y16):
        seen["sr_len"] = len(y16)
        return fake

    res = pipeline.run("transcribe", path, tmp_path, base_name="s", transcribe=tr)
    assert abs(seen["sr_len"] / 16000 - 30) < 0.1
    assert (tmp_path / "s.txt").read_text(encoding="utf-8").startswith("שלום עולם")
    srt = (tmp_path / "s.srt").read_text(encoding="utf-8")
    assert "00:00:00,500 --> 00:00:02,000" in srt and res.transcript


def test_convert_mode_short_file(tmp_path):
    audio, _, _ = click_track(120, 2.0, offset=0.1)
    path = audio_io.write_wav(audio * 0.05, tmp_path / "short.wav")
    res = pipeline.run("convert", path, tmp_path, base_name="short", output_format="mp3")
    _check_audio(tmp_path / res.files[0].name, 2.0)


def test_silent_file_is_rejected(tmp_path):
    path = audio_io.write_wav(np.zeros((2, 44100 * 3), np.float32), tmp_path / "s.wav")
    with pytest.raises(UserError, match="שקט"):
        pipeline.run("convert", path, tmp_path, base_name="s")


def test_corrupt_file_is_rejected(tmp_path):
    p = tmp_path / "bad.m4a"
    p.write_bytes(b"\x00\x00\x00\x18ftypM4A " + b"\x01" * 3000)
    with pytest.raises(UserError):
        pipeline.run("convert", p, tmp_path, base_name="b")
