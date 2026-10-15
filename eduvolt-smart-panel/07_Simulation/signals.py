"""שמות משותפים, גזירת מצב המערכת ומיפוי כתובות Zelio לשמות קריאים."""

from __future__ import annotations

STATES = [
    "INIT",
    "READY",
    "RUNNING",
    "WARNING",
    "ALARM",
    "TRIP",
    "FAULT_LATCHED",
    "RESET",
    "EMERGENCY_STOP",
]

OUTPUT_NAMES = {
    "Q1": "KM1_CMD",
    "Q2": "KM2",
    "Q3": "GREEN",
    "Q4": "WHITE",
    "Q5": "YELLOW",
    "Q6": "AMBER",
    "Q7": "RED",
    "Q8": "BUZZER",
    "Q9": "SMOKE_RESET",
}


def derive_state(s: dict[str, bool]) -> str:
    """מצב לוגי לפי סדר עדיפויות קבוע (המצב החמור ביותר מנצח).

    RESET הוא מצב חולף של סריקה אחת: לחיצת RESET שבה אין אף סיבת תקלה
    פעילה, ולכן הנעילות משתחררות או שהמערכת מאותחלת.
    """
    if s["estop_active"]:
        return "EMERGENCY_STOP"
    if s["hazard_active"]:
        return "ALARM"
    if s["motor_fault_active"]:
        return "TRIP"
    if s["reset_edge"] and s["warm_done"]:
        return "RESET"
    if not s["armed"]:
        return "INIT"
    if s["any_latch"]:
        return "FAULT_LATCHED"
    if s["warning"]:
        return "WARNING"
    if s["run"]:
        return "RUNNING"
    return "READY"
