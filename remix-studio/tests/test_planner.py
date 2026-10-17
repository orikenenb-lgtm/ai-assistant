import pytest

from backend import planner
from backend.planner import RemixPlan, make_plan, preset_plan


def kw(text, preset=None):
    plan, source = make_plan(text, preset, api_key="")
    assert source == "keywords"
    return plan


def test_clamping_never_crashes():
    p = RemixPlan.model_validate({
        "tempo_change_pct": 500, "pitch_shift_semitones": -99, "stem_gain_db": {"vocals": 80},
        "add_drums": {"style": "trap", "intensity": 7, "swing": -3, "drop_at_bar": 9999},
        "vocal_fx": {"reverb": 2, "autotune": True}, "label": "Trap Fast!!",
    })
    assert p.tempo_change_pct == 30 and p.pitch_shift_semitones == -6
    assert p.stem_gain_db.vocals == 12 and p.add_drums.intensity == 1 and p.add_drums.swing == 0
    assert p.add_drums.drop_at_bar == 64 and p.vocal_fx.reverb == 1
    assert p.vocal_fx.autotune is False and "אוטו-טיון" in p.notes_he
    assert p.label == "trap_fast"


def test_all_presets_are_valid():
    for name in planner.PRESETS:
        assert isinstance(preset_plan(name), RemixPlan)


def test_empty_instruction_uses_preset():
    plan, source = make_plan("", "house", api_key="")
    assert source == "preset" and plan.add_drums.style == "house"


# Ten+ Hebrew phrasings handled by the offline parser (used when Claude is unavailable).
@pytest.mark.parametrize("text,check", [
    ("תוסיף תופים טראפ ותאיץ קצת", lambda p: p.add_drums.style == "trap" and 0 < p.tempo_change_pct <= 10),
    ("תעשה מזה מזרחית קצבית", lambda p: p.add_drums.style == "mizrahi" and p.add_drums.intensity >= 0.85),
    ("רק ריוורב על הקול", lambda p: p.add_drums is None and p.vocal_fx.reverb > 0.4),
    ("תעשה האוס עם דרופ", lambda p: p.add_drums.style == "house" and p.add_drums.drop_at_bar == 8),
    ("לופי רגוע ותאט", lambda p: p.add_drums.style == "lofi" and p.tempo_change_pct < 0),
    ("רגאטון עם 808", lambda p: p.add_drums.style == "reggaeton" and p.add_808),
    ("תשאיר רק את הקול", lambda p: p.add_drums is None and not p.keep_stems.other and p.keep_stems.vocals),
    ("תאיץ ב-15 אחוז", lambda p: p.tempo_change_pct == 15),
    ("קול כמו בטלפון עם דיליי", lambda p: p.vocal_fx.telephone_filter and p.vocal_fx.delay > 0),
    ("תעשה את זה מגניב", lambda p: p.add_drums is not None),                     # vague -> preset
    ("תחליף את הקול לקול של זמר מפורסם", lambda p: "לא נתמך" in p.notes_he),   # impossible -> refused
    ("תוסיף אוטוטיון וטראפ", lambda p: p.add_drums.style == "trap" and "אוטו-טיון" in p.notes_he),
    ("דריל כבד", lambda p: p.add_drums.style == "drill"),
    ("אפרוביט עדין", lambda p: p.add_drums.style == "afro" and p.add_drums.intensity < 0.5),
])
def test_keyword_phrasings(text, check):
    assert check(kw(text))


def test_claude_failure_falls_back(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("network down")
    monkeypatch.setattr(planner, "plan_with_claude", boom)
    plan, source = make_plan("תוסיף תופים טראפ", "house", api_key="sk-test")
    assert source == "keywords" and plan.add_drums.style == "trap"


def test_claude_response_is_validated(monkeypatch):
    """A (fake) Claude response with out-of-range values is clamped, unsupported parts noted."""
    import json
    import types

    payload = {
        "keep_stems": {"vocals": True, "drums": False, "bass": True, "other": True},
        "stem_gain_db": {"vocals": 0, "drums": 0, "bass": 0, "other": 0},
        "add_drums": {"style": "trap", "intensity": 3, "swing": None, "drop_at_bar": None, "feel": "auto"},
        "add_808": True, "tempo_change_pct": 99, "pitch_shift_semitones": 0,
        "vocal_fx": {"reverb": 0.2, "delay": 0, "autotune": False, "distortion": 0, "chorus": 0, "telephone_filter": False},
        "master_fx": {"lowpass_sweep_intro": False, "compression": 0.3},
        "notes_he": "טראפ מהיר.", "unsupported_he": ["שיבוט קול"], "label": "trap",
    }

    class FakeMessages:
        def create(self, **kw):
            assert kw["model"] == "claude-sonnet-5-5"
            assert kw["output_config"]["format"]["type"] == "json_schema"
            block = types.SimpleNamespace(type="text", text=json.dumps(payload))
            return types.SimpleNamespace(stop_reason="end_turn", content=[block])

    class FakeClient:
        def __init__(self, **kw):
            self.messages = FakeMessages()

    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", FakeClient)
    plan, source = make_plan("טראפ מהיר מאוד", None, api_key="sk-test")
    assert source == "claude"
    assert plan.tempo_change_pct == 30 and plan.add_drums.intensity == 1
    assert "שיבוט קול" in plan.notes_he


def test_schema_is_strict():
    s = planner._schema()
    assert s["additionalProperties"] is False and set(s["required"]) == set(s["properties"])
