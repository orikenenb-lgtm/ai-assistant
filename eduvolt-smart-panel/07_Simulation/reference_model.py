"""מודל ייחוס של מכונת המצבים — כתוב ישירות מהמפרט (STATE_MACHINE.md), לא מהלדר.

הבדיקה ההשוואתית (differential) מריצה את המודל הזה ואת הלדר על אותם
קלטים ודורשת זהות מלאה של היציאות בכל סריקה. כך נתפסות טעויות העתקה
בלדר: מגע NO במקום NC, שורה בסדר שגוי, סליל שגוי וכדומה.
"""

from __future__ import annotations

from dataclasses import dataclass, field


class OnDelay:
    """טיימר השהיית הפעלה — אותה הגדרה כמו טיימר A בלדר."""

    def __init__(self, preset: float):
        self.preset = preset
        self.acc = 0.0
        self.done = False

    def run(self, command: bool, dt: float) -> bool:
        if command:
            self.acc = min(self.acc + dt, self.preset)
            self.done = self.acc >= self.preset - 1e-9
        else:
            self.acc = 0.0
            self.done = False
        return self.done


@dataclass
class Inputs:
    start: bool = False
    stop_ok: bool = True
    reset: bool = False
    estop_ok: bool = True
    ol_tripped: bool = False
    km1_fb: bool = False
    ts1_warn: bool = False
    ts2_alarm: bool = False
    ts3_warn: bool = False
    ts4_alarm: bool = False
    smoke: bool = False
    gas: bool = False

    @classmethod
    def from_zelio(cls, z: dict[str, bool]) -> "Inputs":
        return cls(
            start=z["I1"], stop_ok=z["I2"], reset=z["I3"], estop_ok=z["I4"],
            ol_tripped=z["I5"], km1_fb=z["I6"], ts1_warn=z["I7"], ts2_alarm=z["I8"],
            ts3_warn=z["I9"], ts4_alarm=z["IA"], smoke=z["IB"], gas=z["IC"],
        )


@dataclass
class ReferenceController:
    presets: dict[str, float]
    # זיכרון — מתאפס כולו בכיבוי
    prev_reset: bool = False
    prev_start: bool = False
    l_estop: bool = False
    l_haz: bool = False
    l_mot: bool = False
    armed: bool = False
    run: bool = False
    buzzer: bool = False
    smoke_reset_active: bool = False
    timers: dict[str, OnDelay] = field(default_factory=dict)
    sig: dict[str, bool] = field(default_factory=dict)

    def __post_init__(self):
        self.timers = {k: OnDelay(v) for k, v in self.presets.items()}

    def scan(self, z: dict[str, bool], dt: float) -> dict[str, bool]:
        x = Inputs.from_zelio(z)
        t = self.timers

        reset_edge = x.reset and not self.prev_reset
        self.prev_reset = x.reset
        start_edge = x.start and not self.prev_start
        self.prev_start = x.start

        warm_done = t["T1"].run(True, dt)
        gas_effective = x.gas and warm_done          # MQ-2 לא אמין בזמן חימום
        hazard = x.ts2_alarm or x.ts4_alarm or x.smoke or gas_effective
        warning = x.ts1_warn or x.ts3_warn

        # self.run כאן הוא הערך מהסריקה הקודמת
        fail_to_close = t["T2"].run(self.run and not x.km1_fb, dt)
        welded = t["T3"].run(not self.run and x.km1_fb, dt)
        motor_fault = x.ol_tripped or fail_to_close or welded
        estop = not x.estop_ok

        # תקלה חדשה (סיבה פעילה שעוד לא ננעלה) מפעילה זמזם
        if (estop and not self.l_estop) or (hazard and not self.l_haz) or (motor_fault and not self.l_mot):
            self.buzzer = True
        self.l_estop |= estop
        self.l_haz |= hazard
        self.l_mot |= motor_fault

        # איפוס גלאי עשן שננעל: RESET בזמן שהגלאי עדיין מתריע
        if reset_edge and x.smoke and not self.smoke_reset_active:
            self.smoke_reset_active = True
        pulse_done = t["T6"].run(self.smoke_reset_active, dt)
        settle_done = t["T7"].run(self.smoke_reset_active, dt)
        smoke_reset_out = self.smoke_reset_active and not pulse_done
        if settle_done:
            self.smoke_reset_active = False

        all_clear = not estop and not hazard and not motor_fault and not self.smoke_reset_active

        if reset_edge:
            # כל נעילה משתחררת רק אם הסיבה שלה כבר לא פעילה
            if not estop:
                self.l_estop = False
            if not hazard and not self.smoke_reset_active:
                self.l_haz = False
            if not motor_fault:
                self.l_mot = False
            self.buzzer = False  # RESET תמיד מאשר את הזמזם
            if warm_done and all_clear:
                self.armed = True

        no_latch = not (self.l_estop or self.l_haz or self.l_mot)
        ready = self.armed and no_latch and all_clear and x.stop_ok

        # איפוס אינו הפעלה: אין התנעה בסריקה של RESET
        if start_edge and ready and not warning and not reset_edge:
            self.run = True
        if not ready:
            self.run = False

        blink_on = t["T4"].run(not t["T5"].done, dt)
        t["T5"].run(blink_on, dt)

        q = {
            "Q1": self.run,
            "Q2": self.armed and not self.l_estop and not self.l_haz and not estop and not hazard,
            "Q3": self.run and x.km1_fb,
            "Q4": ready or (not warm_done and blink_on),
            "Q5": warning,
            "Q6": self.l_estop or self.l_haz or self.l_mot or (not self.armed and warm_done),
            "Q7": hazard or estop,
            "Q8": self.buzzer,
            "Q9": smoke_reset_out,
            "QA": False,
        }
        self.sig = {
            "estop_active": estop,
            "hazard_active": hazard,
            "motor_fault_active": motor_fault,
            "armed": self.armed,
            "any_latch": not no_latch,
            "warm_done": warm_done,
            "run": self.run,
            "warning": warning,
            "stop_ok": x.stop_ok,
            "reset_edge": reset_edge,
        }
        return q

    def signals(self) -> dict[str, bool]:
        return dict(self.sig)
