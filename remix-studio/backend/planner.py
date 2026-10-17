"""Hebrew free text -> RemixPlan.

Order of preference:
1. Claude API with a strict JSON schema (structured outputs), validated by Pydantic.
2. If there is no API key or the call fails: a keyword parser over the Hebrew text,
   applied on top of the selected preset.
Every value is clamped to its range, so a bad plan can never crash the pipeline.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from .beats import STYLE_NAMES_HE, STYLES

log = logging.getLogger(__name__)

PLANNER_MODEL = "claude-sonnet-5-5"
StyleName = Literal["trap", "house", "reggaeton", "mizrahi", "boom_bap", "afro", "drill", "lofi"]


def _clamp(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return lo if lo > 0 else 0.0
    return max(lo, min(hi, v))


class Stems(BaseModel):
    vocals: bool = True
    drums: bool = False
    bass: bool = True
    other: bool = True


class StemGains(BaseModel):
    vocals: float = 0.0
    drums: float = 0.0
    bass: float = 0.0
    other: float = 0.0

    @field_validator("*", mode="before")
    @classmethod
    def _c(cls, v):
        return _clamp(v, -24, 12)


class Drums(BaseModel):
    style: StyleName = "trap"
    intensity: float = 0.7
    swing: float | None = None          # None = the style's own swing
    drop_at_bar: int | None = None
    feel: Literal["auto", "half", "normal", "double"] = "auto"

    @field_validator("intensity", mode="before")
    @classmethod
    def _i(cls, v):
        return _clamp(v, 0, 1)

    @field_validator("swing", mode="before")
    @classmethod
    def _s(cls, v):
        return None if v is None else _clamp(v, 0, 1)

    @field_validator("drop_at_bar", mode="before")
    @classmethod
    def _d(cls, v):
        if v in (None, 0, "0", ""):
            return None
        return int(_clamp(v, 1, 64))


class VocalFx(BaseModel):
    reverb: float = 0.0
    delay: float = 0.0
    autotune: bool = False              # not supported in v1 (forced False, explained in notes)
    distortion: float = 0.0
    chorus: float = 0.0
    telephone_filter: bool = False

    @field_validator("reverb", "delay", "distortion", "chorus", mode="before")
    @classmethod
    def _c(cls, v):
        return _clamp(v, 0, 1)


class MasterFx(BaseModel):
    lowpass_sweep_intro: bool = False
    compression: float = 0.3

    @field_validator("compression", mode="before")
    @classmethod
    def _c(cls, v):
        return _clamp(v, 0, 1)


class RemixPlan(BaseModel):
    mode: Literal["remix"] = "remix"
    keep_stems: Stems = Field(default_factory=Stems)
    stem_gain_db: StemGains = Field(default_factory=StemGains)
    add_drums: Drums | None = Field(default_factory=Drums)
    add_808: bool = False
    tempo_change_pct: float = 0.0
    pitch_shift_semitones: int = 0
    vocal_fx: VocalFx = Field(default_factory=VocalFx)
    master_fx: MasterFx = Field(default_factory=MasterFx)
    output_format: Literal["mp3", "wav"] = "mp3"
    notes_he: str = ""
    label: str = "remix"                # short ascii tag for file names

    @field_validator("tempo_change_pct", mode="before")
    @classmethod
    def _t(cls, v):
        return round(_clamp(v, -30, 30), 1)

    @field_validator("pitch_shift_semitones", mode="before")
    @classmethod
    def _p(cls, v):
        return int(round(_clamp(v, -6, 6)))

    @field_validator("label", mode="before")
    @classmethod
    def _l(cls, v):
        s = re.sub(r"[^a-z0-9_]+", "_", str(v or "remix").lower()).strip("_")
        return s[:24] or "remix"

    @model_validator(mode="after")
    def _autotune(self):
        if self.vocal_fx.autotune:
            self.vocal_fx.autotune = False
            msg = "אוטו-טיון עדיין לא נתמך בגרסה הזו."
            if msg not in self.notes_he:
                self.notes_he = (self.notes_he + " " + msg).strip()
        return self


# ------------------------------------------------------------------ presets

PRESETS: dict[str, dict] = {
    "trap": {"label_he": "טראפ", "plan": {"add_drums": {"style": "trap", "intensity": 0.75}, "add_808": True,
                                         "vocal_fx": {"reverb": 0.25, "delay": 0.2}, "label": "trap"}},
    "house": {"label_he": "האוס", "plan": {"add_drums": {"style": "house", "intensity": 0.75},
                                          "vocal_fx": {"reverb": 0.3}, "master_fx": {"lowpass_sweep_intro": True}, "label": "house"}},
    "reggaeton": {"label_he": "רגאטון", "plan": {"add_drums": {"style": "reggaeton", "intensity": 0.7}, "add_808": True,
                                               "vocal_fx": {"reverb": 0.2}, "label": "reggaeton"}},
    "mizrahi": {"label_he": "מזרחית קצבית", "plan": {"add_drums": {"style": "mizrahi", "intensity": 0.8},
                                                   "vocal_fx": {"reverb": 0.3, "delay": 0.15}, "tempo_change_pct": 4, "label": "mizrahi"}},
    "lofi": {"label_he": "לופיי רגוע", "plan": {"add_drums": {"style": "lofi", "intensity": 0.5}, "tempo_change_pct": -8,
                                              "vocal_fx": {"reverb": 0.4}, "stem_gain_db": {"other": -2}, "label": "lofi"}},
    "vocal_fx": {"label_he": "רק אפקטים על הקול", "plan": {"keep_stems": {"vocals": True, "drums": True, "bass": True, "other": True},
                                                          "add_drums": None, "vocal_fx": {"reverb": 0.45, "delay": 0.3}, "label": "vocalfx"}},
    "acapella": {"label_he": "אקפלה (רק קול)", "plan": {"keep_stems": {"vocals": True, "drums": False, "bass": False, "other": False},
                                                     "add_drums": None, "master_fx": {"compression": 0.2}, "label": "acapella"}},
}

DEFAULT_PRESET = "trap"


def preset_plan(name: str | None, output_format: str = "mp3") -> RemixPlan:
    p = PRESETS.get(name or DEFAULT_PRESET, PRESETS[DEFAULT_PRESET])
    plan = RemixPlan.model_validate({**p["plan"], "output_format": output_format})
    if not plan.notes_he:
        plan.notes_he = f"פריסט: {p['label_he']}."
    return plan


# ------------------------------------------------------------------ Claude

_SYSTEM = f"""You turn a Hebrew (or English) remix instruction into a JSON remix plan for an audio app.
The app separates a song into stems (vocals/drums/bass/other), can mute or re-balance stems, add
synthesized drums in one style ({", ".join(STYLES)}), add a tuned 808 bass, change tempo
(-30..+30 %, pitch preserved), shift pitch (-6..+6 semitones), and apply vocal effects
(reverb, delay, distortion, chorus, telephone filter - amounts 0..1) and master compression /
an intro low-pass sweep.

Rules:
- Start from the given base plan and change only what the instruction asks for (or clearly implies).
- When drums are added, the original drums stem is usually muted (keep_stems.drums=false) unless asked to keep it.
- "תאיץ קצת" is about +6..+10 %, "תאט" is about -8..-12 %. "מזרחית" = mizrahi, "לופי" = lofi, "רגאטון" = reggaeton.
- Vague requests ("תעשה את זה מגניב") -> pick a sensible tasteful plan.
- Not supported: autotune, voice cloning / making it sound like a specific real singer, generating new
  lyrics or melodies, adding real instruments. Never attempt these: leave them out, list them in
  unsupported_he, and do the rest.
- drop_at_bar: number of bars before the drums come in (null = from the first downbeat).
- notes_he: 1-2 short, friendly Hebrew sentences describing what will be done (and what was not possible).
- label: 1-2 lowercase ascii words for a file name, e.g. "trap_fast".
"""


def _schema() -> dict:
    num = {"type": "number"}
    boolean = {"type": "boolean"}

    def obj(props: dict) -> dict:
        return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}

    drums = obj({
        "style": {"type": "string", "enum": list(STYLES)},
        "intensity": num,
        "swing": {"anyOf": [num, {"type": "null"}]},
        "drop_at_bar": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "feel": {"type": "string", "enum": ["auto", "half", "normal", "double"]},
    })
    return obj({
        "keep_stems": obj({k: boolean for k in ("vocals", "drums", "bass", "other")}),
        "stem_gain_db": obj({k: num for k in ("vocals", "drums", "bass", "other")}),
        "add_drums": {"anyOf": [drums, {"type": "null"}]},
        "add_808": boolean,
        "tempo_change_pct": num,
        "pitch_shift_semitones": {"type": "integer"},
        "vocal_fx": obj({"reverb": num, "delay": num, "autotune": boolean, "distortion": num,
                         "chorus": num, "telephone_filter": boolean}),
        "master_fx": obj({"lowpass_sweep_intro": boolean, "compression": num}),
        "notes_he": {"type": "string"},
        "unsupported_he": {"type": "array", "items": {"type": "string"}},
        "label": {"type": "string"},
    })


def plan_with_claude(instruction: str, base: RemixPlan, api_key: str, timeout: float = 30.0) -> RemixPlan:
    import anthropic

    client = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=1)
    base_json = base.model_dump(exclude={"mode", "output_format", "notes_he"})
    response = client.messages.create(
        model=PLANNER_MODEL,
        max_tokens=4000,
        system=_SYSTEM,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": _schema()}},
        messages=[{
            "role": "user",
            "content": f"Base plan:\n{json.dumps(base_json, ensure_ascii=False)}\n\nInstruction:\n{instruction}",
        }],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"planner stop_reason={response.stop_reason}")
    text = next(b.text for b in response.content if b.type == "text")
    data = json.loads(text)
    unsupported = [s for s in data.pop("unsupported_he", []) if isinstance(s, str) and s.strip()]
    plan = RemixPlan.model_validate({**data, "output_format": base.output_format})
    if unsupported:
        extra = "לא בוצע: " + "; ".join(unsupported) + "."
        plan.notes_he = (plan.notes_he + " " + extra).strip()
    return plan


# ------------------------------------------------------------------ keyword fallback

_STYLE_WORDS = {
    "trap": ["טראפ", "trap"], "drill": ["דריל", "drill"], "house": ["האוס", "house", "דאנס", "מועדון"],
    "reggaeton": ["רגאטון", "reggaeton", "לטיני"], "mizrahi": ["מזרחי", "מזרחית", "ים תיכוני", "דרבוקה"],
    "boom_bap": ["בום באפ", "בום-באפ", "בום בפ", "boom bap", "היפ הופ ישן", "אולד סקול"],
    "afro": ["אפרו", "afro", "אפרוביט"], "lofi": ["לופי", "לופיי", "לו-פיי", "lofi", "lo-fi", "רגוע"],
}
_UNSUPPORTED = [
    (["זמר מפורסם", "קול של", "כמו הקול של", "שיישמע כמו", "תחליף את הקול", "שיבוט"], "שינוי הקול לקול של אדם אחר (לא נתמך)"),
    (["אוטוטיון", "אוטו-טיון", "אוטו טיון", "autotune"], "אוטו-טיון (לא נתמך בגרסה הזו)"),
    (["תוסיף גיטרה", "תוסיף פסנתר", "תוסיף כינור", "תוסיף סקסופון", "גיטרה חשמלית"], "הוספת כלים אמיתיים (לא נתמך)"),
    (["תכתוב מילים", "מילים חדשות", "בית חדש"], "כתיבת מילים חדשות (לא נתמך)"),
]


def _has(text: str, words) -> bool:
    return any(w in text for w in words)


def plan_with_keywords(instruction: str, base: RemixPlan) -> RemixPlan:
    t = (instruction or "").lower()
    d = base.model_dump()
    notes, unsupported = [], []

    for words, label in _UNSUPPORTED:
        if _has(t, words):
            unsupported.append(label)

    for style, words in _STYLE_WORDS.items():
        if _has(t, words):
            d["add_drums"] = {**(d["add_drums"] or Drums().model_dump()), "style": style}
            d["keep_stems"]["drums"] = False
            d["label"] = style
            d["add_808"] = style in ("trap", "drill", "reggaeton") or d["add_808"]
            notes.append(f"ביט {STYLE_NAMES_HE[style]}")
            break

    m = re.search(r"(\d+)\s*(?:%|אחוז)", t)
    pct = float(m.group(1)) if m else None
    if _has(t, ["תאיץ", "מהר", "יותר מהיר", "תזרז", "speed up", "faster"]):
        d["tempo_change_pct"] = pct if pct else (4 if _has(t, ["קצת", "טיפה"]) else 8)
        notes.append("הקצב הואץ")
    elif _has(t, ["תאט", "לאט", "יותר איטי", "slow", "סלואו"]):
        d["tempo_change_pct"] = -(pct if pct else (4 if _has(t, ["קצת", "טיפה"]) else 10))
        notes.append("הקצב הואט")

    vfx = d["vocal_fx"]
    if _has(t, ["ריוורב", "הד", "reverb", "אולם", "חלל"]):
        vfx["reverb"] = max(vfx["reverb"], 0.55)
        notes.append("ריוורב על הקול")
    if _has(t, ["דיליי", "delay", "אקו", "echo"]):
        vfx["delay"] = max(vfx["delay"], 0.45)
        notes.append("דיליי על הקול")
    if _has(t, ["טלפון", "רדיו ישן", "telephone"]):
        vfx["telephone_filter"] = True
        notes.append("פילטר טלפון")
    if _has(t, ["דיסטורשן", "מלוכלך", "distortion", "עיוות"]):
        vfx["distortion"] = 0.5
        notes.append("דיסטורשן")
    if _has(t, ["קורוס", "chorus", "רחב"]):
        vfx["chorus"] = 0.5

    only_fx = _has(t, ["רק ריוורב", "רק אפקט", "רק דיליי", "רק על הקול", "בלי תופים", "אל תוסיף תופים"])
    if only_fx:
        d["add_drums"] = None
        d["add_808"] = False
        d["keep_stems"] = {"vocals": True, "drums": True, "bass": True, "other": True}
        d["label"] = "vocalfx"
    if _has(t, ["רק הקול", "רק קול", "רק את הקול", "בלי מוזיקה", "אקפלה", "acapella", "a cappella"]):
        d["add_drums"], d["add_808"] = None, False
        d["keep_stems"] = {"vocals": True, "drums": False, "bass": False, "other": False}
        d["label"] = "acapella"
        notes.append("רק הקול")
    if _has(t, ["בלי בס", "תוריד בס", "תוריד את הבס"]):
        d["keep_stems"]["bass"] = False
    if _has(t, ["תשאיר את התופים", "תשאיר תופים", "עם התופים המקוריים"]):
        d["keep_stems"]["drums"] = True
    if d["add_drums"] and _has(t, ["חזק", "אנרגטי", "קצבי", "קצבית", "מקפיץ", "מפוצץ"]):
        d["add_drums"]["intensity"] = 0.9
    if d["add_drums"] and _has(t, ["עדין", "שקט", "רך", "רגוע"]):
        d["add_drums"]["intensity"] = 0.45
    if _has(t, ["808", "בס כבד", "סאב"]):
        d["add_808"] = True
    if _has(t, ["דרופ", "drop"]) and d["add_drums"]:
        d["add_drums"]["drop_at_bar"] = d["add_drums"].get("drop_at_bar") or 8
        d["master_fx"]["lowpass_sweep_intro"] = True
        notes.append("דרופ אחרי 8 תיבות")
    m = re.search(r"(?:תעלה|הגבה)\D{0,12}(\d)\s*(?:טון|חצאי)", t)
    if m:
        d["pitch_shift_semitones"] = int(m.group(1))
    m = re.search(r"(?:תוריד|הנמך)\D{0,12}(\d)\s*(?:טון|חצאי)", t)
    if m:
        d["pitch_shift_semitones"] = -int(m.group(1))

    plan = RemixPlan.model_validate(d)
    text = (base.notes_he if not notes else "בוצע: " + ", ".join(notes) + ".")
    if unsupported:
        text += " לא בוצע: " + "; ".join(unsupported) + "."
    plan.notes_he = text.strip()
    return plan


def make_plan(instruction: str | None, preset: str | None, output_format: str = "mp3",
              api_key: str | None = None) -> tuple[RemixPlan, str]:
    """Returns (plan, source) where source is 'claude' | 'keywords' | 'preset'."""
    base = preset_plan(preset, output_format)
    instruction = (instruction or "").strip()[:1000]
    if not instruction:
        return base, "preset"
    key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY")
    if key:
        try:
            return plan_with_claude(instruction, base, key), "claude"
        except Exception as e:  # network, auth, refusal, schema... never crash
            log.warning("planner: Claude failed (%s); using keyword fallback", type(e).__name__)
    return plan_with_keywords(instruction, base), "keywords"
