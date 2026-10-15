"""מודל פשוט של הציוד בשטח: לחצנים, חיווט קשיח, מגענים וחיישנים.

המודל מאפשר לבדוק גם את מה שה-PLC לא רואה: שמפסק החירום וממסר
עומס היתר מנתקים את סליל KM1 בחיווט קשיח, גם כשיציאת ה-PLC תקועה.
זה מודל לימודי — אין בו זמני תגובה אמיתיים של רכיבים.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Plant:
    # מצב פיזי שהתרחיש קובע
    start_pressed: bool = False
    stop_pressed: bool = False
    reset_pressed: bool = False
    estop_pressed: bool = False
    ol_tripped: bool = False
    ts1_warn: bool = False
    ts2_alarm: bool = False
    ts3_warn: bool = False
    ts4_alarm: bool = False
    smoke_present: bool = False
    gas_present: bool = False
    control_power: bool = True
    # תקלות מוזרקות והגדרות
    stop_wire_broken: bool = False
    km1_fail_to_close: bool = False
    km1_welded: bool = False
    plc_q1_stuck_on: bool = False
    smoke_detector_latching: bool = True
    ka1_installed: bool = True
    # מצב פנימי של הציוד
    km1_coil: bool = False
    km1_closed: bool = False
    km2_closed: bool = False
    smoke_alarm_relay: bool = False
    smoke_detector_powered: bool = True

    def plc_inputs(self) -> dict[str, bool]:
        return {
            "I1": self.start_pressed,
            "I2": not self.stop_pressed and not self.stop_wire_broken,
            "I3": self.reset_pressed,
            "I4": not self.estop_pressed,
            "I5": self.ol_tripped,
            "I6": self.km1_closed,
            "I7": self.ts1_warn,
            "I8": self.ts2_alarm,
            "I9": self.ts3_warn,
            "IA": self.ts4_alarm,
            "IB": self.smoke_alarm_relay,
            "IC": self.gas_present,
        }

    def apply(self, q: dict[str, bool]) -> None:
        if not self.control_power:
            q = {k: False for k in q}
        q1 = q["Q1"] or (self.plc_q1_stuck_on and self.control_power)
        # חיווט קשיח: Q1 → S0 (NC-1) → F4 (95-96) → KM1 A1
        self.km1_coil = q1 and not self.estop_pressed and not self.ol_tripped and self.control_power
        if self.km1_welded and self.km1_closed:
            pass  # מגע מרותך נשאר סגור
        elif self.km1_fail_to_close:
            self.km1_closed = False
        else:
            self.km1_closed = self.km1_coil
        self.km2_closed = q["Q2"]

        # הגלאי מוזן דרך מגע NC של KA1; Q9 פותח אותו
        self.smoke_detector_powered = self.control_power and not (self.ka1_installed and q["Q9"])
        if not self.smoke_detector_powered:
            self.smoke_alarm_relay = False
        elif self.smoke_present:
            self.smoke_alarm_relay = True
        elif not self.smoke_detector_latching:
            self.smoke_alarm_relay = False
