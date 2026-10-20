"""מנוע הרצה ללדר בסגנון Zelio — מריץ את ladder_program.json כפי שהוא.

המטרה: לבדוק את הלדר שיוקלד ידנית ל-Zelio Soft 2, ולא מודל אחר שלו.
זה אינו סימולטור של Zelio. ההנחות על סמנטיקת הסריקה מפורטות למטה,
ולכן הבדיקות רצות בשני מצבים:

- immediate: תוצאת סליל נראית מיד לשורות שאחריו באותה סריקה
  (ההתנהגות הנפוצה בבקרים, ומה שמניחים לגבי Zelio — לאמת ב-Zelio Soft 2).
- deferred: כל השורות קוראות את מצב סוף הסריקה הקודמת, והכתיבות
  נכנסות לתוקף רק בסוף הסריקה. זה מבחן עמידות: הלוגיקה צריכה להגיע
  לאותו מצב יציב גם כך.

טיימר מסוג A (השהיית הפעלה): כל עוד הפקודה פעילה הזמן נצבר, והמוצא
עולה כשמגיעים ל-preset. כשהפקודה נופלת, הטיימר מתאפס.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

PROGRAM_PATH = Path(__file__).resolve().parent.parent / "06_PLC_Logic" / "ladder_program.json"

INPUTS = ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "IA", "IB", "IC", "ID", "IE", "IF", "IG"]
OUTPUTS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "QA"]

_ADDR = re.compile(r"^[IQMT][1-9A-Z]$")
MAX_CONTACTS_PER_BRANCH = 5


def load_program(path: Path = PROGRAM_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@dataclass(frozen=True)
class Contact:
    address: str
    inverted: bool

    @classmethod
    def parse(cls, token: str) -> "Contact":
        inverted = token[0].islower()
        address = token[0].upper() + token[1:]
        if not _ADDR.match(address):
            raise ValueError(f"מגע לא חוקי: {token!r}")
        return cls(address, inverted)


@dataclass(frozen=True)
class Coil:
    kind: str  # "direct" | "set" | "reset" | "timer"
    address: str

    @classmethod
    def parse(cls, token: str) -> "Coil":
        if token.startswith("["):
            kind, address = "direct", token[1:]
        elif token.startswith("TT"):
            kind, address = "timer", "T" + token[2:]
        elif token[0] in "SR":
            kind, address = ("set" if token[0] == "S" else "reset"), token[1:]
        else:
            raise ValueError(f"סליל לא חוקי: {token!r}")
        if not _ADDR.match(address):
            raise ValueError(f"כתובת סליל לא חוקית: {token!r}")
        if kind == "timer" and address[0] != "T":
            raise ValueError(f"סליל טיימר חייב להיות TTn: {token!r}")
        if kind != "timer" and address[0] not in "QM":
            raise ValueError(f"סליל חייב להיות על Q או M: {token!r}")
        if address[0] == "Q" and address not in OUTPUTS:
            raise ValueError(f"יציאה לא קיימת: {token!r}")
        return cls(kind, address)


@dataclass(frozen=True)
class Rung:
    n: int
    branches: tuple[tuple[Contact, ...], ...]
    coil: Coil


def compile_rungs(program: dict) -> list[Rung]:
    rungs = []
    for r in program["rungs"]:
        branches = []
        for br in r["branches"]:
            if not br or len(br) > MAX_CONTACTS_PER_BRANCH:
                raise ValueError(f"שורה {r['n']}: ענף עם {len(br)} מגעים (מותר 1-{MAX_CONTACTS_PER_BRANCH})")
            branches.append(tuple(Contact.parse(t) for t in br))
        rungs.append(Rung(r["n"], tuple(branches), Coil.parse(r["coil"])))
    return rungs


class LadderPLC:
    """מריץ את הלדר. כל המצב הפנימי (M, T, Q) מתאפס בכיבוי — כמו Zelio בלי שמירת זיכרון."""

    def __init__(self, program: dict | None = None, mode: str = "immediate"):
        if mode not in ("immediate", "deferred"):
            raise ValueError(mode)
        self.program = program or load_program()
        self.rungs = compile_rungs(self.program)
        self.mode = mode
        self.presets = {t: float(v["preset_s"]) for t, v in self.program["timers"].items()}
        self.power_cycle()

    def power_cycle(self) -> None:
        self.bits: dict[str, bool] = {}
        self.timer_acc: dict[str, float] = {t: 0.0 for t in self.presets}
        for q in OUTPUTS:
            self.bits[q] = False
        for sym in self.program["symbols"]:
            if sym[0] == "M":
                self.bits[sym] = False
        for t in self.presets:
            self.bits[t] = False

    def _read(self, image: dict[str, bool], c: Contact) -> bool:
        v = image.get(c.address, False)
        return (not v) if c.inverted else v

    def scan(self, inputs: dict[str, bool], dt: float) -> dict[str, bool]:
        for k in inputs:
            if k not in INPUTS:
                raise KeyError(f"כניסה לא ידועה: {k}")
        current = dict(self.bits)
        for i in INPUTS:
            current[i] = bool(inputs.get(i, False))
        nxt = dict(current) if self.mode == "deferred" else current
        read_img = current

        for rung in self.rungs:
            power = any(all(self._read(read_img, c) for c in br) for br in rung.branches)
            coil = rung.coil
            if coil.kind == "direct":
                nxt[coil.address] = power
            elif coil.kind == "set":
                if power:
                    nxt[coil.address] = True
            elif coil.kind == "reset":
                if power:
                    nxt[coil.address] = False
            else:  # טיימר A
                t = coil.address
                if power:
                    self.timer_acc[t] = min(self.timer_acc[t] + dt, self.presets[t])
                    # epsilon מונע שגיאת נקודה צפה בצבירה של dt
                    nxt[t] = self.timer_acc[t] >= self.presets[t] - 1e-9
                else:
                    self.timer_acc[t] = 0.0
                    nxt[t] = False

        self.bits = {k: v for k, v in nxt.items() if k not in INPUTS}
        self.last_inputs = {i: current[i] for i in INPUTS}
        return {q: self.bits[q] for q in OUTPUTS}

    def signals(self) -> dict[str, bool]:
        """אותות בשמות משותפים לגזירת מצב (ראו signals.derive_state)."""
        b = self.bits
        i = self.last_inputs
        return {
            "estop_active": not i["I4"],
            "hazard_active": b["M5"],
            "motor_fault_active": b["M7"],
            "armed": b["MB"],
            "any_latch": b["M8"] or b["M9"] or b["MA"],
            "warm_done": b["T1"],
            "run": b["MD"],
            "warning": not b["MH"],
            "stop_ok": i["I2"],
            "reset_edge": b["M1"],
        }
