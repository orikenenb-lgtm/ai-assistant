"""תרחישי הבדיקה — כל תרחיש מקביל לבדיקה ב-08_Test_Reports/TEST_PLAN.md.

זמנים בשניות מרגע עליית המתח. ערכי הטיימרים בסימולציה הם ערכי דמה
(למשל חימום 30 שניות) — הערכים האמיתיים TBD.
"""

from __future__ import annotations

from dataclasses import dataclass, field

PRESS = 0.2  # משך לחיצה על לחצן


@dataclass
class Check:
    t: float
    expect: dict
    note: str = ""
    kind: str = "requirement"  # requirement | limitation


@dataclass
class Scenario:
    sid: str
    title: str
    goal: str
    duration: float
    events: list = field(default_factory=list)  # (t, field, value, note)
    checks: list = field(default_factory=list)
    blink_windows: list = field(default_factory=list)  # (t0, t1, output)
    setup: dict = field(default_factory=dict)


def press(t: float, button: str, note: str = "") -> list:
    f = f"{button}_pressed"
    label = note or f"לחיצה על {button.upper()}"
    return [(t, f, True, label), (t + PRESS, f, False, "")]


def hold(t: float, fld: str, value: bool, note: str) -> list:
    return [(t, fld, value, note)]


ARM = press(31.0, "reset", "RESET ראשון אחרי החימום")
START = press(33.0, "start", "START")


def all_scenarios() -> list[Scenario]:
    s = []

    s.append(Scenario(
        "S01", "עליית מתח — מצב INIT", "אחרי עליית מתח המנוע לא פועל, START לא עובד, הלבן מהבהב, ובסוף החימום הענבר מבקש איפוס",
        35.0,
        events=press(5.0, "start", "START בזמן החימום"),
        checks=[
            Check(1.0, {"state": "INIT", "KM1_CMD": False, "KM2": False, "AMBER": False, "RED": False, "BUZZER": False}),
            Check(5.5, {"state": "INIT", "KM1_CMD": False, "KM1_COIL": False}, "START מתעלם"),
            Check(30.5, {"state": "INIT", "AMBER": True, "WHITE": False, "KM2": False}, "סוף החימום: נדרש איפוס"),
        ],
        blink_windows=[(1.0, 4.0, "WHITE")],
    ))

    s.append(Scenario(
        "S02", "איפוס מבוקר מעביר ל-READY", "RESET לפני סוף החימום לא מאתחל; RESET אחרי החימום מעביר ל-READY בלי להפעיל מנוע",
        33.0,
        events=press(10.0, "reset", "RESET בזמן החימום") + ARM,
        checks=[
            Check(10.5, {"state": "INIT", "KM2": False}, "איפוס מוקדם לא מאתחל"),
            Check(31.5, {"state": "READY", "WHITE": True, "KM2": True, "KM1_CMD": False, "AMBER": False, "BUZZER": False, "RED": False}),
        ],
    ))

    s.append(Scenario(
        "S03", "הפעלה ועצירה רגילה", "START מפעיל את המנוע עם משוב, STOP עוצר וחוזרים ל-READY",
        37.0,
        events=ARM + START + press(35.0, "stop", "STOP"),
        checks=[
            Check(33.5, {"state": "RUNNING", "KM1_CMD": True, "KM1_COIL": True, "KM1_CLOSED": True, "GREEN": True, "WHITE": True}),
            Check(35.5, {"state": "READY", "KM1_CMD": False, "KM1_CLOSED": False, "GREEN": False}),
        ],
    ))

    s.append(Scenario(
        "S04", "איפוס אינו הפעלה", "START מוחזק בזמן RESET, או לחיצה בו־זמנית על שניהם, לא מפעילים את המנוע",
        41.0,
        events=hold(31.0, "start_pressed", True, "START נלחץ ומוחזק")
        + press(31.5, "reset", "RESET בזמן ש-START מוחזק")
        + hold(32.5, "start_pressed", False, "שחרור START")
        + press(33.5, "start", "לחיצת START חדשה")
        + hold(36.0, "estop_pressed", True, "חירום")
        + hold(37.0, "estop_pressed", False, "שחרור חירום")
        + press(38.0, "reset", "RESET ו-START באותו רגע")
        + press(38.0, "start", ""),
        checks=[
            Check(32.0, {"state": "READY", "KM1_CMD": False}),
            Check(33.2, {"KM1_CMD": False}),
            Check(34.0, {"state": "RUNNING", "KM1_CMD": True}),
            Check(38.5, {"state": "READY", "KM1_CMD": False}, "לחיצה בו־זמנית לא מפעילה"),
        ],
    ))

    s.append(Scenario(
        "S05", "START ו-STOP יחד", "כש-STOP לחוץ, START לא מפעיל — לעצירה יש עדיפות",
        35.0,
        events=ARM + hold(33.0, "stop_pressed", True, "STOP ו-START יחד") + hold(33.0, "start_pressed", True, "")
        + hold(33.3, "stop_pressed", False, "שחרור שניהם") + hold(33.3, "start_pressed", False, ""),
        checks=[
            Check(33.2, {"KM1_CMD": False, "KM1_COIL": False}),
            Check(33.6, {"state": "READY", "KM1_CMD": False}),
        ],
    ))

    s.append(Scenario(
        "S06", "אזהרת טמפרטורה (סף ראשון)", "אזהרה מדליקה צהוב ולא עוצרת מנוע שפועל, אבל חוסמת התנעה חדשה",
        40.0,
        events=ARM + START + hold(35.0, "ts1_warn", True, "TS1 — אזור A עבר סף אזהרה")
        + press(36.0, "stop", "STOP") + press(37.0, "start", "START בזמן אזהרה")
        + hold(38.0, "ts1_warn", False, "הטמפרטורה ירדה") + press(39.0, "start", "START"),
        checks=[
            Check(35.5, {"state": "WARNING", "YELLOW": True, "KM1_CMD": True, "GREEN": True, "BUZZER": False, "RED": False, "AMBER": False, "KM2": True}),
            Check(36.5, {"state": "WARNING", "KM1_CMD": False}),
            Check(37.5, {"KM1_CMD": False}, "התנעה חסומה באזהרה"),
            Check(38.5, {"state": "READY", "YELLOW": False}),
            Check(39.5, {"state": "RUNNING", "KM1_CMD": True}),
        ],
    ))

    s.append(Scenario(
        "S07", "התראת טמפרטורה (סף שני) באזור A", "ניתוק KM1 ו-KM2, אדום+ענבר+זמזם, אישור משתיק, נעילה עד איפוס, אין חזרה אוטומטית",
        42.0,
        events=ARM + START + hold(35.0, "ts2_alarm", True, "TS2 — אזור A עבר סף התראה")
        + press(36.0, "reset", "RESET בזמן שהסכנה פעילה (אישור)")
        + hold(38.0, "ts2_alarm", False, "הטמפרטורה ירדה")
        + press(39.0, "start", "START לפני איפוס") + press(40.0, "reset", "RESET") + press(41.0, "start", "START"),
        checks=[
            Check(35.5, {"state": "ALARM", "KM1_CMD": False, "KM1_COIL": False, "KM2": False, "RED": True, "AMBER": True, "BUZZER": True, "GREEN": False}),
            Check(36.5, {"state": "ALARM", "BUZZER": False, "RED": True, "KM2": False}, "אישור משתיק בלבד"),
            Check(38.5, {"state": "FAULT_LATCHED", "RED": False, "AMBER": True, "KM2": False, "KM1_CMD": False}),
            Check(39.5, {"state": "FAULT_LATCHED", "KM1_CMD": False}, "אין התנעה לפני איפוס"),
            Check(40.5, {"state": "READY", "KM2": True, "KM1_CMD": False, "AMBER": False}, "איפוס לא מפעיל מנוע"),
            Check(41.5, {"state": "RUNNING", "KM1_CMD": True}),
        ],
    ))

    s.append(Scenario(
        "S08", "גלאי עשן שננעל — רצף איפוס", "RESET כשהגלאי נעול מנתק לו מתח (Q9), איפוס הנעילה חסום עד סוף ההתייצבות",
        56.0,
        setup={"smoke_detector_latching": True, "ka1_installed": True},
        events=ARM + START + hold(35.0, "smoke_present", True, "עשן בלוח")
        + hold(36.0, "smoke_present", False, "העשן התפזר (הגלאי נשאר נעול)")
        + press(38.0, "reset", "RESET — מתחיל רצף איפוס גלאי")
        + press(45.0, "reset", "RESET בזמן ההתייצבות")
        + press(54.0, "reset", "RESET אחרי ההתייצבות"),
        checks=[
            Check(35.5, {"state": "ALARM", "KM1_CMD": False, "KM2": False, "RED": True, "BUZZER": True}),
            Check(37.0, {"state": "ALARM", "RED": True}, "הגלאי נעול"),
            Check(38.5, {"SMOKE_RESET": True, "BUZZER": False}),
            Check(41.5, {"SMOKE_RESET": False}),
            Check(45.5, {"state": "FAULT_LATCHED", "AMBER": True, "RED": False}, "איפוס חסום בזמן ההתייצבות"),
            Check(54.5, {"state": "READY", "KM2": True, "AMBER": False, "KM1_CMD": False}),
        ],
    ))

    s.append(Scenario(
        "S09", "עשן שנמשך אחרי איפוס הגלאי", "אם העשן עדיין קיים, הגלאי מתריע שוב והמערכת נשארת בהתראה",
        60.0,
        setup={"smoke_detector_latching": True, "ka1_installed": True},
        events=ARM + hold(35.0, "smoke_present", True, "עשן מתמשך")
        + press(37.0, "reset", "RESET") + press(57.0, "reset", "RESET נוסף"),
        checks=[
            Check(37.5, {"SMOKE_RESET": True, "KM2": False}),
            Check(41.5, {"state": "ALARM", "RED": True, "KM2": False}, "הגלאי חזר להתריע"),
            Check(56.0, {"state": "ALARM", "KM2": False, "KM1_CMD": False}),
            Check(57.5, {"SMOKE_RESET": True, "KM2": False, "KM1_CMD": False}),
        ],
    ))

    s.append(Scenario(
        "S10", "גז — הסתרה בזמן חימום והתראה אחריו", "בזמן החימום MQ-2 לא אמין ולכן מוסתר (מגבלה מתועדת); אחרי החימום גז מפעיל התראה",
        40.0,
        events=hold(10.0, "gas_present", True, "גז בזמן החימום") + hold(12.0, "gas_present", False, "")
        + ARM + hold(35.0, "gas_present", True, "גז אחרי החימום") + hold(37.0, "gas_present", False, "הגז התפזר")
        + press(38.0, "reset", "RESET"),
        checks=[
            Check(11.0, {"state": "INIT", "RED": False, "BUZZER": False}, "מוסתר בזמן החימום", "limitation"),
            Check(35.5, {"state": "ALARM", "RED": True, "BUZZER": True, "KM2": False}),
            Check(38.5, {"state": "READY", "KM2": True}),
        ],
    ))

    s.append(Scenario(
        "S11", "עומס יתר במנוע", "ממסר עומס יתר מנתק בחיווט קשיח; TRIP; KM2 נשאר; איפוס רק אחרי שחרור ממסר העומס",
        42.0,
        events=ARM + START + hold(35.0, "ol_tripped", True, "F4 הופעל")
        + press(36.0, "reset", "RESET כש-F4 עדיין מנותק") + hold(37.0, "ol_tripped", False, "איפוס ידני של F4")
        + press(38.0, "start", "START לפני איפוס") + press(39.0, "reset", "RESET") + press(40.0, "start", "START"),
        checks=[
            Check(35.05, {"KM1_COIL": False, "KM1_CLOSED": False}, "ניתוק בחיווט קשיח"),
            Check(35.5, {"state": "TRIP", "KM1_CMD": False, "KM2": True, "AMBER": True, "BUZZER": True, "RED": False, "GREEN": False}),
            Check(36.5, {"state": "TRIP", "BUZZER": False, "AMBER": True}),
            Check(37.5, {"state": "FAULT_LATCHED"}),
            Check(38.5, {"KM1_CMD": False}),
            Check(39.5, {"state": "READY", "AMBER": False}),
            Check(40.5, {"state": "RUNNING", "KM1_CMD": True}),
        ],
    ))

    s.append(Scenario(
        "S12", "מגען שלא נסגר", "פקודה בלי משוב במשך T2 נועלת תקלת מנוע",
        37.0,
        setup={"km1_fail_to_close": True},
        events=ARM + START + press(35.0, "reset", "RESET"),
        checks=[
            Check(33.5, {"state": "RUNNING", "KM1_CMD": True, "KM1_CLOSED": False, "GREEN": False}),
            Check(34.5, {"state": "FAULT_LATCHED", "KM1_CMD": False, "AMBER": True, "BUZZER": True}),
            Check(35.5, {"state": "READY", "AMBER": False, "BUZZER": False}),
        ],
    ))

    s.append(Scenario(
        "S13", "מגע מרותך ב-KM1", "משוב בלי פקודה במשך T3 נועל תקלה, ואי אפשר לאפס כל עוד המגע סגור",
        40.0,
        setup={"km1_welded": True},
        events=ARM + START + press(35.0, "stop", "STOP") + press(37.0, "reset", "RESET") + press(38.0, "start", "START"),
        checks=[
            Check(33.5, {"state": "RUNNING", "KM1_CLOSED": True}),
            Check(35.5, {"KM1_CMD": False, "KM1_CLOSED": True, "GREEN": False}),
            Check(36.5, {"state": "TRIP", "AMBER": True, "BUZZER": True, "KM2": True}),
            Check(37.5, {"state": "TRIP", "AMBER": True, "BUZZER": False}, "אין איפוס כשהמגע מרותך"),
            Check(38.5, {"KM1_CMD": False}),
        ],
    ))

    s.append(Scenario(
        "S14", "עצירת חירום", "חירום מנתק את KM1 בחיווט קשיח ואת KM2 דרך ה-PLC; שחרור לא מחזיר הפעלה",
        41.0,
        events=ARM + START + hold(35.0, "estop_pressed", True, "S0 נלחץ")
        + press(36.0, "reset", "RESET כשהחירום לחוץ") + hold(37.0, "estop_pressed", False, "שחרור S0")
        + press(38.0, "reset", "RESET") + press(39.0, "start", "START"),
        checks=[
            Check(35.05, {"KM1_COIL": False}, "ניתוק בחיווט קשיח"),
            Check(35.5, {"state": "EMERGENCY_STOP", "KM1_CMD": False, "KM2": False, "RED": True, "AMBER": True, "BUZZER": True}),
            Check(36.5, {"state": "EMERGENCY_STOP", "BUZZER": False}),
            Check(37.5, {"state": "FAULT_LATCHED", "RED": False, "AMBER": True, "KM2": False, "KM1_CMD": False}, "אין חזרה אוטומטית"),
            Check(38.5, {"state": "READY", "KM2": True, "KM1_CMD": False}),
            Check(39.5, {"state": "RUNNING"}),
        ],
    ))

    s.append(Scenario(
        "S15", "חירום כשיציאת ה-PLC תקועה", "מדגים למה החירום מחווט קשיח — ומדגים גם את המגבלה של חירום חד־ערוצי",
        38.0,
        events=ARM + START + hold(34.0, "plc_q1_stuck_on", True, "תקלה מוזרקת: ממסר Q1 תקוע סגור")
        + hold(35.0, "estop_pressed", True, "S0 נלחץ") + hold(36.0, "estop_pressed", False, "שחרור S0"),
        checks=[
            Check(35.05, {"KM1_COIL": False, "KM1_CLOSED": False}, "החיווט הקשיח עוצר את המנוע למרות התקלה"),
            Check(36.5, {"KM1_COIL": True}, "מגבלה: שחרור החירום מחזיר מתח לסליל כשהיציאה תקועה — במתקן אמיתי נדרש ממסר בטיחות עם איפוס ידני", "limitation"),
        ],
    ))

    s.append(Scenario(
        "S16", "הפסקת מתח בזמן ריצה", "אחרי חזרת מתח: INIT, המנוע לא חוזר, נדרשים חימום, איפוס ו-START",
        70.0,
        events=ARM + START + hold(35.0, "control_power", False, "הפסקת מתח")
        + hold(36.0, "control_power", True, "חזרת מתח") + press(37.0, "start", "START מיד אחרי חזרת המתח")
        + press(67.0, "reset", "RESET") + press(68.0, "start", "START"),
        checks=[
            Check(35.5, {"state": "POWER_OFF", "KM1_COIL": False, "KM1_CLOSED": False, "KM2": False}),
            Check(36.5, {"state": "INIT", "KM1_CMD": False, "KM2": False}),
            Check(37.5, {"KM1_CMD": False, "KM1_COIL": False}, "אין התנעה אחרי חזרת מתח"),
            Check(66.5, {"state": "INIT", "AMBER": True}),
            Check(67.5, {"state": "READY"}),
            Check(68.5, {"state": "RUNNING", "KM1_CMD": True}),
        ],
        blink_windows=[(37.0, 40.0, "WHITE")],
    ))

    s.append(Scenario(
        "S17", "קרע בחוט לחצן STOP", "לחצן STOP מסוג NC: קרע בחוט עוצר את המנוע וחוסם התנעה",
        40.0,
        events=ARM + START + hold(35.0, "stop_wire_broken", True, "קרע בחוט STOP")
        + press(36.0, "start", "START") + hold(37.0, "stop_wire_broken", False, "תיקון החוט") + press(38.0, "start", "START"),
        checks=[
            Check(35.5, {"KM1_CMD": False, "WHITE": False}),
            Check(36.5, {"KM1_CMD": False}),
            Check(37.5, {"state": "READY", "WHITE": True}),
            Check(38.5, {"state": "RUNNING"}),
        ],
    ))

    s.append(Scenario(
        "S18", "RESET לא מפעיל ולא עוצר", "RESET במצב READY לא מפעיל מנוע; RESET בזמן ריצה לא עוצר אותו",
        38.0,
        events=ARM + press(33.0, "reset", "RESET ב-READY") + press(34.0, "start", "START") + press(36.0, "reset", "RESET בזמן ריצה"),
        checks=[
            Check(33.5, {"state": "READY", "KM1_CMD": False}),
            Check(34.5, {"state": "RUNNING"}),
            Check(36.5, {"state": "RUNNING", "KM1_CMD": True}),
        ],
    ))

    s.append(Scenario(
        "S19", "כמה תקלות ברצף", "אחרי אישור תקלה, תקלה חדשה מסוג אחר מפעילה שוב את הזמזם",
        43.0,
        setup={"smoke_detector_latching": False},
        events=ARM + START + hold(35.0, "ol_tripped", True, "עומס יתר") + press(36.0, "reset", "אישור")
        + hold(37.0, "smoke_present", True, "עשן") + hold(39.0, "smoke_present", False, "")
        + hold(40.0, "ol_tripped", False, "איפוס F4") + press(41.0, "reset", "RESET"),
        checks=[
            Check(35.5, {"state": "TRIP", "BUZZER": True}),
            Check(36.5, {"BUZZER": False}),
            Check(37.5, {"state": "ALARM", "BUZZER": True, "RED": True, "KM2": False}, "תקלה חדשה — זמזם שוב"),
            Check(39.5, {"state": "TRIP", "RED": False}),
            Check(40.5, {"state": "FAULT_LATCHED"}),
            Check(41.5, {"state": "READY", "KM2": True}),
        ],
    ))

    s.append(Scenario(
        "S20", "סכנה בזמן החימום", "החיישנים מנוטרים גם ב-INIT; התקלה ננעלת ומשתחררת באיפוס הראשון",
        33.0,
        events=hold(5.0, "ts4_alarm", True, "TS4 — אזור B עבר סף התראה") + hold(7.0, "ts4_alarm", False, "") + ARM,
        checks=[
            Check(5.5, {"state": "ALARM", "RED": True, "BUZZER": True, "KM2": False}),
            Check(7.5, {"state": "INIT", "AMBER": True, "RED": False, "BUZZER": True}),
            Check(31.5, {"state": "READY", "AMBER": False, "BUZZER": False, "KM2": True}),
        ],
    ))

    return s
