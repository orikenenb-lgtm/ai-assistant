# תוצאות סימולציית הלוגיקה

> **מה זה ומה זה לא.** זו סימולציה של **לוגיקת הבקרה בלבד** שרצה ב-Python.
> היא לא EduVolt, לא Zelio Soft 2 ולא בדיקה של חומרה או חיווט.
> לפני כל שימוש יש להריץ את אותן בדיקות בסימולציה של Zelio Soft 2 (לפי TEST_PLAN.md).
> הקובץ נוצר אוטומטית על ידי `07_Simulation/run_simulation.py` — לא לערוך ידנית.

## איך בודקים

- **ladder-immediate** — הלדר מ-`ladder_program.json` רץ כמו שהוא; תוצאת סליל נראית מיד לשורות שאחריו.
- **ladder-deferred** — אותו לדר, אבל כל הכתיבות נכנסות לתוקף רק בסוף הסריקה (מבחן עמידות).
- **reference** — מודל ייחוס שנכתב ישירות מהמפרט, בלי קשר לשורות הלדר.
- **בדיקה השוואתית** — קלטים אקראיים לאורך זמן; הלדר ומודל הייחוס חייבים לתת יציאות זהות בכל סריקה.

ערכי טיימרים בסימולציה (ערכי דמה — הערכים האמיתיים TBD):

| טיימר | תפקיד | ערך בסימולציה | סטטוס |
|---|---|---|---|
| `T1` | זמן חימום אחרי עליית מתח | 30.0 s | PLACEHOLDER_FOR_SIMULATION — real value TBD from MQ-2 datasheet and smoke detector manual |
| `T2` | פקודה בלי משוב = מגען לא נסגר | 1.0 s | PLACEHOLDER — TBD |
| `T3` | משוב בלי פקודה = מגע מרותך | 1.0 s | PLACEHOLDER — TBD |
| `T4` | מתנד הבהוב — חצי ראשון | 0.5 s | DESIGN_CHOICE |
| `T5` | מתנד הבהוב — חצי שני | 0.5 s | DESIGN_CHOICE |
| `T6` | משך ניתוק המתח לגלאי | 3.0 s | PLACEHOLDER — TBD from smoke detector manual |
| `T7` | ניתוק + זמן התייצבות הגלאי | 15.0 s | PLACEHOLDER — TBD from smoke detector manual; must be > T6 |

## סיכום

- תרחישים: 20 × 3 מנועים = 60 הרצות; עברו: **60/60**.
- בדיקה השוואתית: 12 הרצות אקראיות, 481,120 סריקות; **אין אף הבדל** בין הלדר למודל הייחוס.

| תרחיש | נושא | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| S01 | עליית מתח — מצב INIT | ✅ | ✅ | ✅ |
| S02 | איפוס מבוקר מעביר ל-READY | ✅ | ✅ | ✅ |
| S03 | הפעלה ועצירה רגילה | ✅ | ✅ | ✅ |
| S04 | איפוס אינו הפעלה | ✅ | ✅ | ✅ |
| S05 | START ו-STOP יחד | ✅ | ✅ | ✅ |
| S06 | אזהרת טמפרטורה (סף ראשון) | ✅ | ✅ | ✅ |
| S07 | התראת טמפרטורה (סף שני) באזור A | ✅ | ✅ | ✅ |
| S08 | גלאי עשן שננעל — רצף איפוס | ✅ | ✅ | ✅ |
| S09 | עשן שנמשך אחרי איפוס הגלאי | ✅ | ✅ | ✅ |
| S10 | גז — הסתרה בזמן חימום והתראה אחריו | ✅ | ✅ | ✅ |
| S11 | עומס יתר במנוע | ✅ | ✅ | ✅ |
| S12 | מגען שלא נסגר | ✅ | ✅ | ✅ |
| S13 | מגע מרותך ב-KM1 | ✅ | ✅ | ✅ |
| S14 | עצירת חירום | ✅ | ✅ | ✅ |
| S15 | חירום כשיציאת ה-PLC תקועה | ✅ | ✅ | ✅ |
| S16 | הפסקת מתח בזמן ריצה | ✅ | ✅ | ✅ |
| S17 | קרע בחוט לחצן STOP | ✅ | ✅ | ✅ |
| S18 | RESET לא מפעיל ולא עוצר | ✅ | ✅ | ✅ |
| S19 | כמה תקלות ברצף | ✅ | ✅ | ✅ |
| S20 | סכנה בזמן החימום | ✅ | ✅ | ✅ |

## מגבלות שהסימולציה הדגימה

אלה לא באגים בלוגיקה אלא גבולות של התכנון הלימודי. הם מסומנים כבדיקות מסוג `limitation`:

- **S10** — מוסתר בזמן החימום
- **S15** — מגבלה: שחרור החירום מחזיר מתח לסליל כשהיציאה תקועה — במתקן אמיתי נדרש ממסר בטיחות עם איפוס ידני

## פירוט תרחישים

### S01 — עליית מתח — מצב INIT

**מטרה:** אחרי עליית מתח המנוע לא פועל, START לא עובד, הלבן מהבהב, ובסוף החימום הענבר מבקש איפוס

**אירועים:**

- `t=5s` — START בזמן החימום

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 1s | `state=INIT, KM1_CMD=0, KM2=0, AMBER=0, RED=0, BUZZER=0` | ✅ | ✅ | ✅ |
| 5.5s | `state=INIT, KM1_CMD=0, KM1_COIL=0` — START מתעלם | ✅ | ✅ | ✅ |
| 30.5s | `state=INIT, AMBER=1, WHITE=0, KM2=0` — סוף החימום: נדרש איפוס | ✅ | ✅ | ✅ |
| 1–4s | `WHITE` מהבהב | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s)

### S02 — איפוס מבוקר מעביר ל-READY

**מטרה:** RESET לפני סוף החימום לא מאתחל; RESET אחרי החימום מעביר ל-READY בלי להפעיל מנוע

**אירועים:**

- `t=10s` — RESET בזמן החימום
- `t=31s` — RESET ראשון אחרי החימום

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 10.5s | `state=INIT, KM2=0` — איפוס מוקדם לא מאתחל | ✅ | ✅ | ✅ |
| 31.5s | `state=READY, WHITE=1, KM2=1, KM1_CMD=0, AMBER=0, BUZZER=0, RED=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s)

### S03 — הפעלה ועצירה רגילה

**מטרה:** START מפעיל את המנוע עם משוב, STOP עוצר וחוזרים ל-READY

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — STOP

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 33.5s | `state=RUNNING, KM1_CMD=1, KM1_COIL=1, KM1_CLOSED=1, GREEN=1, WHITE=1` | ✅ | ✅ | ✅ |
| 35.5s | `state=READY, KM1_CMD=0, KM1_CLOSED=0, GREEN=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → READY (35.00s)

### S04 — איפוס אינו הפעלה

**מטרה:** START מוחזק בזמן RESET, או לחיצה בו־זמנית על שניהם, לא מפעילים את המנוע

**אירועים:**

- `t=31s` — START נלחץ ומוחזק
- `t=31.5s` — RESET בזמן ש-START מוחזק
- `t=32.5s` — שחרור START
- `t=33.5s` — לחיצת START חדשה
- `t=36s` — חירום
- `t=37s` — שחרור חירום
- `t=38s` — RESET ו-START באותו רגע
- `t=38s` — לחיצה על START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 32s | `state=READY, KM1_CMD=0` | ✅ | ✅ | ✅ |
| 33.2s | `KM1_CMD=0` | ✅ | ✅ | ✅ |
| 34s | `state=RUNNING, KM1_CMD=1` | ✅ | ✅ | ✅ |
| 38.5s | `state=READY, KM1_CMD=0` — לחיצה בו־זמנית לא מפעילה | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.50s) → READY (31.51s) → RUNNING (33.50s) → EMERGENCY_STOP (36.00s) → FAULT_LATCHED (37.00s) → RESET (38.00s) → READY (38.01s)

### S05 — START ו-STOP יחד

**מטרה:** כש-STOP לחוץ, START לא מפעיל — לעצירה יש עדיפות

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — STOP ו-START יחד
- `t=33.3s` — שחרור שניהם

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 33.2s | `KM1_CMD=0, KM1_COIL=0` | ✅ | ✅ | ✅ |
| 33.6s | `state=READY, KM1_CMD=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s)

### S06 — אזהרת טמפרטורה (סף ראשון)

**מטרה:** אזהרה מדליקה צהוב ולא עוצרת מנוע שפועל, אבל חוסמת התנעה חדשה

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — TS1 — אזור A עבר סף אזהרה
- `t=36s` — STOP
- `t=37s` — START בזמן אזהרה
- `t=38s` — הטמפרטורה ירדה
- `t=39s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.5s | `state=WARNING, YELLOW=1, KM1_CMD=1, GREEN=1, BUZZER=0, RED=0, AMBER=0, KM2=1` | ✅ | ✅ | ✅ |
| 36.5s | `state=WARNING, KM1_CMD=0` | ✅ | ✅ | ✅ |
| 37.5s | `KM1_CMD=0` — התנעה חסומה באזהרה | ✅ | ✅ | ✅ |
| 38.5s | `state=READY, YELLOW=0` | ✅ | ✅ | ✅ |
| 39.5s | `state=RUNNING, KM1_CMD=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → WARNING (35.00s) → READY (38.00s) → RUNNING (39.00s)

### S07 — התראת טמפרטורה (סף שני) באזור A

**מטרה:** ניתוק KM1 ו-KM2, אדום+ענבר+זמזם, אישור משתיק, נעילה עד איפוס, אין חזרה אוטומטית

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — TS2 — אזור A עבר סף התראה
- `t=36s` — RESET בזמן שהסכנה פעילה (אישור)
- `t=38s` — הטמפרטורה ירדה
- `t=39s` — START לפני איפוס
- `t=40s` — RESET
- `t=41s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.5s | `state=ALARM, KM1_CMD=0, KM1_COIL=0, KM2=0, RED=1, AMBER=1, BUZZER=1, GREEN=0` | ✅ | ✅ | ✅ |
| 36.5s | `state=ALARM, BUZZER=0, RED=1, KM2=0` — אישור משתיק בלבד | ✅ | ✅ | ✅ |
| 38.5s | `state=FAULT_LATCHED, RED=0, AMBER=1, KM2=0, KM1_CMD=0` | ✅ | ✅ | ✅ |
| 39.5s | `state=FAULT_LATCHED, KM1_CMD=0` — אין התנעה לפני איפוס | ✅ | ✅ | ✅ |
| 40.5s | `state=READY, KM2=1, KM1_CMD=0, AMBER=0` — איפוס לא מפעיל מנוע | ✅ | ✅ | ✅ |
| 41.5s | `state=RUNNING, KM1_CMD=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → ALARM (35.00s) → FAULT_LATCHED (38.00s) → RESET (40.00s) → READY (40.01s) → RUNNING (41.00s)

### S08 — גלאי עשן שננעל — רצף איפוס

**מטרה:** RESET כשהגלאי נעול מנתק לו מתח (Q9), איפוס הנעילה חסום עד סוף ההתייצבות

**הגדרות ותקלות מוזרקות:** `smoke_detector_latching=1`, `ka1_installed=1`

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — עשן בלוח
- `t=36s` — העשן התפזר (הגלאי נשאר נעול)
- `t=38s` — RESET — מתחיל רצף איפוס גלאי
- `t=45s` — RESET בזמן ההתייצבות
- `t=54s` — RESET אחרי ההתייצבות

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.5s | `state=ALARM, KM1_CMD=0, KM2=0, RED=1, BUZZER=1` | ✅ | ✅ | ✅ |
| 37s | `state=ALARM, RED=1` — הגלאי נעול | ✅ | ✅ | ✅ |
| 38.5s | `SMOKE_RESET=1, BUZZER=0` | ✅ | ✅ | ✅ |
| 41.5s | `SMOKE_RESET=0` | ✅ | ✅ | ✅ |
| 45.5s | `state=FAULT_LATCHED, AMBER=1, RED=0` — איפוס חסום בזמן ההתייצבות | ✅ | ✅ | ✅ |
| 54.5s | `state=READY, KM2=1, AMBER=0, KM1_CMD=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → ALARM (35.01s) → FAULT_LATCHED (38.01s) → RESET (45.00s) → FAULT_LATCHED (45.01s) → RESET (54.00s) → READY (54.01s)

### S09 — עשן שנמשך אחרי איפוס הגלאי

**מטרה:** אם העשן עדיין קיים, הגלאי מתריע שוב והמערכת נשארת בהתראה

**הגדרות ותקלות מוזרקות:** `smoke_detector_latching=1`, `ka1_installed=1`

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=35s` — עשן מתמשך
- `t=37s` — RESET
- `t=57s` — RESET נוסף

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 37.5s | `SMOKE_RESET=1, KM2=0` | ✅ | ✅ | ✅ |
| 41.5s | `state=ALARM, RED=1, KM2=0` — הגלאי חזר להתריע | ✅ | ✅ | ✅ |
| 56s | `state=ALARM, KM2=0, KM1_CMD=0` | ✅ | ✅ | ✅ |
| 57.5s | `SMOKE_RESET=1, KM2=0, KM1_CMD=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → ALARM (35.01s) → FAULT_LATCHED (37.01s) → ALARM (40.00s) → FAULT_LATCHED (57.01s) → ALARM (60.00s)

### S10 — גז — הסתרה בזמן חימום והתראה אחריו

**מטרה:** בזמן החימום MQ-2 לא אמין ולכן מוסתר (מגבלה מתועדת); אחרי החימום גז מפעיל התראה

**אירועים:**

- `t=10s` — גז בזמן החימום
- `t=31s` — RESET ראשון אחרי החימום
- `t=35s` — גז אחרי החימום
- `t=37s` — הגז התפזר
- `t=38s` — RESET

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 11s | `state=INIT, RED=0, BUZZER=0` — מוסתר בזמן החימום *(מגבלה)* | ✅ | ✅ | ✅ |
| 35.5s | `state=ALARM, RED=1, BUZZER=1, KM2=0` | ✅ | ✅ | ✅ |
| 38.5s | `state=READY, KM2=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → ALARM (35.00s) → FAULT_LATCHED (37.00s) → RESET (38.00s) → READY (38.01s)

### S11 — עומס יתר במנוע

**מטרה:** ממסר עומס יתר מנתק בחיווט קשיח; TRIP; KM2 נשאר; איפוס רק אחרי שחרור ממסר העומס

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — F4 הופעל
- `t=36s` — RESET כש-F4 עדיין מנותק
- `t=37s` — איפוס ידני של F4
- `t=38s` — START לפני איפוס
- `t=39s` — RESET
- `t=40s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.05s | `KM1_COIL=0, KM1_CLOSED=0` — ניתוק בחיווט קשיח | ✅ | ✅ | ✅ |
| 35.5s | `state=TRIP, KM1_CMD=0, KM2=1, AMBER=1, BUZZER=1, RED=0, GREEN=0` | ✅ | ✅ | ✅ |
| 36.5s | `state=TRIP, BUZZER=0, AMBER=1` | ✅ | ✅ | ✅ |
| 37.5s | `state=FAULT_LATCHED` | ✅ | ✅ | ✅ |
| 38.5s | `KM1_CMD=0` | ✅ | ✅ | ✅ |
| 39.5s | `state=READY, AMBER=0` | ✅ | ✅ | ✅ |
| 40.5s | `state=RUNNING, KM1_CMD=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → TRIP (35.00s) → FAULT_LATCHED (37.00s) → RESET (39.00s) → READY (39.01s) → RUNNING (40.00s)

### S12 — מגען שלא נסגר

**מטרה:** פקודה בלי משוב במשך T2 נועלת תקלת מנוע

**הגדרות ותקלות מוזרקות:** `km1_fail_to_close=1`

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — RESET

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 33.5s | `state=RUNNING, KM1_CMD=1, KM1_CLOSED=0, GREEN=0` | ✅ | ✅ | ✅ |
| 34.5s | `state=FAULT_LATCHED, KM1_CMD=0, AMBER=1, BUZZER=1` | ✅ | ✅ | ✅ |
| 35.5s | `state=READY, AMBER=0, BUZZER=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → TRIP (34.00s) → FAULT_LATCHED (34.01s) → RESET (35.00s) → READY (35.01s)

### S13 — מגע מרותך ב-KM1

**מטרה:** משוב בלי פקודה במשך T3 נועל תקלה, ואי אפשר לאפס כל עוד המגע סגור

**הגדרות ותקלות מוזרקות:** `km1_welded=1`

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — STOP
- `t=37s` — RESET
- `t=38s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 33.5s | `state=RUNNING, KM1_CLOSED=1` | ✅ | ✅ | ✅ |
| 35.5s | `KM1_CMD=0, KM1_CLOSED=1, GREEN=0` | ✅ | ✅ | ✅ |
| 36.5s | `state=TRIP, AMBER=1, BUZZER=1, KM2=1` | ✅ | ✅ | ✅ |
| 37.5s | `state=TRIP, AMBER=1, BUZZER=0` — אין איפוס כשהמגע מרותך | ✅ | ✅ | ✅ |
| 38.5s | `KM1_CMD=0` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → READY (35.00s) → TRIP (36.00s)

### S14 — עצירת חירום

**מטרה:** חירום מנתק את KM1 בחיווט קשיח ואת KM2 דרך ה-PLC; שחרור לא מחזיר הפעלה

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — S0 נלחץ
- `t=36s` — RESET כשהחירום לחוץ
- `t=37s` — שחרור S0
- `t=38s` — RESET
- `t=39s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.05s | `KM1_COIL=0` — ניתוק בחיווט קשיח | ✅ | ✅ | ✅ |
| 35.5s | `state=EMERGENCY_STOP, KM1_CMD=0, KM2=0, RED=1, AMBER=1, BUZZER=1` | ✅ | ✅ | ✅ |
| 36.5s | `state=EMERGENCY_STOP, BUZZER=0` | ✅ | ✅ | ✅ |
| 37.5s | `state=FAULT_LATCHED, RED=0, AMBER=1, KM2=0, KM1_CMD=0` — אין חזרה אוטומטית | ✅ | ✅ | ✅ |
| 38.5s | `state=READY, KM2=1, KM1_CMD=0` | ✅ | ✅ | ✅ |
| 39.5s | `state=RUNNING` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → EMERGENCY_STOP (35.00s) → FAULT_LATCHED (37.00s) → RESET (38.00s) → READY (38.01s) → RUNNING (39.00s)

### S15 — חירום כשיציאת ה-PLC תקועה

**מטרה:** מדגים למה החירום מחווט קשיח — ומדגים גם את המגבלה של חירום חד־ערוצי

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=34s` — תקלה מוזרקת: ממסר Q1 תקוע סגור
- `t=35s` — S0 נלחץ
- `t=36s` — שחרור S0

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.05s | `KM1_COIL=0, KM1_CLOSED=0` — החיווט הקשיח עוצר את המנוע למרות התקלה | ✅ | ✅ | ✅ |
| 36.5s | `KM1_COIL=1` — מגבלה: שחרור החירום מחזיר מתח לסליל כשהיציאה תקועה — במתקן אמיתי נדרש ממסר בטיחות עם איפוס ידני *(מגבלה)* | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → EMERGENCY_STOP (35.00s) → FAULT_LATCHED (36.00s) → TRIP (37.00s)

### S16 — הפסקת מתח בזמן ריצה

**מטרה:** אחרי חזרת מתח: INIT, המנוע לא חוזר, נדרשים חימום, איפוס ו-START

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — הפסקת מתח
- `t=36s` — חזרת מתח
- `t=37s` — START מיד אחרי חזרת המתח
- `t=67s` — RESET
- `t=68s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.5s | `state=POWER_OFF, KM1_COIL=0, KM1_CLOSED=0, KM2=0` | ✅ | ✅ | ✅ |
| 36.5s | `state=INIT, KM1_CMD=0, KM2=0` | ✅ | ✅ | ✅ |
| 37.5s | `KM1_CMD=0, KM1_COIL=0` — אין התנעה אחרי חזרת מתח | ✅ | ✅ | ✅ |
| 66.5s | `state=INIT, AMBER=1` | ✅ | ✅ | ✅ |
| 67.5s | `state=READY` | ✅ | ✅ | ✅ |
| 68.5s | `state=RUNNING, KM1_CMD=1` | ✅ | ✅ | ✅ |
| 37–40s | `WHITE` מהבהב | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → POWER_OFF (35.00s) → INIT (36.00s) → RESET (67.00s) → READY (67.01s) → RUNNING (68.00s)

### S17 — קרע בחוט לחצן STOP

**מטרה:** לחצן STOP מסוג NC: קרע בחוט עוצר את המנוע וחוסם התנעה

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — קרע בחוט STOP
- `t=36s` — START
- `t=37s` — תיקון החוט
- `t=38s` — START

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.5s | `KM1_CMD=0, WHITE=0` | ✅ | ✅ | ✅ |
| 36.5s | `KM1_CMD=0` | ✅ | ✅ | ✅ |
| 37.5s | `state=READY, WHITE=1` | ✅ | ✅ | ✅ |
| 38.5s | `state=RUNNING` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → READY (35.00s) → RUNNING (38.00s)

### S18 — RESET לא מפעיל ולא עוצר

**מטרה:** RESET במצב READY לא מפעיל מנוע; RESET בזמן ריצה לא עוצר אותו

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — RESET ב-READY
- `t=34s` — START
- `t=36s` — RESET בזמן ריצה

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 33.5s | `state=READY, KM1_CMD=0` | ✅ | ✅ | ✅ |
| 34.5s | `state=RUNNING` | ✅ | ✅ | ✅ |
| 36.5s | `state=RUNNING, KM1_CMD=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RESET (33.00s) → READY (33.01s) → RUNNING (34.00s) → RESET (36.00s) → RUNNING (36.01s)

### S19 — כמה תקלות ברצף

**מטרה:** אחרי אישור תקלה, תקלה חדשה מסוג אחר מפעילה שוב את הזמזם

**הגדרות ותקלות מוזרקות:** `smoke_detector_latching=0`

**אירועים:**

- `t=31s` — RESET ראשון אחרי החימום
- `t=33s` — START
- `t=35s` — עומס יתר
- `t=36s` — אישור
- `t=37s` — עשן
- `t=40s` — איפוס F4
- `t=41s` — RESET

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 35.5s | `state=TRIP, BUZZER=1` | ✅ | ✅ | ✅ |
| 36.5s | `BUZZER=0` | ✅ | ✅ | ✅ |
| 37.5s | `state=ALARM, BUZZER=1, RED=1, KM2=0` — תקלה חדשה — זמזם שוב | ✅ | ✅ | ✅ |
| 39.5s | `state=TRIP, RED=0` | ✅ | ✅ | ✅ |
| 40.5s | `state=FAULT_LATCHED` | ✅ | ✅ | ✅ |
| 41.5s | `state=READY, KM2=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → RESET (31.00s) → READY (31.01s) → RUNNING (33.00s) → TRIP (35.00s) → ALARM (37.01s) → TRIP (39.01s) → FAULT_LATCHED (40.00s) → RESET (41.00s) → READY (41.01s)

### S20 — סכנה בזמן החימום

**מטרה:** החיישנים מנוטרים גם ב-INIT; התקלה ננעלת ומשתחררת באיפוס הראשון

**אירועים:**

- `t=5s` — TS4 — אזור B עבר סף התראה
- `t=31s` — RESET ראשון אחרי החימום

| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |
|---|---|---|---|---|
| 5.5s | `state=ALARM, RED=1, BUZZER=1, KM2=0` | ✅ | ✅ | ✅ |
| 7.5s | `state=INIT, AMBER=1, RED=0, BUZZER=1` | ✅ | ✅ | ✅ |
| 31.5s | `state=READY, AMBER=0, BUZZER=0, KM2=1` | ✅ | ✅ | ✅ |

**מעברי מצב (ladder-immediate):** INIT (0.00s) → ALARM (5.00s) → INIT (7.00s) → RESET (31.00s) → READY (31.01s)

## בדיקה השוואתית אקראית

| seed | סריקות | תוצאה |
|---|---|---|
| 1 | 40,047 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 2 | 40,005 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 3 | 40,107 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 4 | 40,178 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 5 | 40,199 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 6 | 40,042 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 7 | 40,024 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, TRIP |
| 8 | 40,095 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 9 | 40,038 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 10 | 40,132 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 11 | 40,192 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |
| 12 | 40,061 | ✅ זהות מלאה; מצבים שנצפו: ALARM, EMERGENCY_STOP, FAULT_LATCHED, INIT, POWER_OFF, READY, RESET, RUNNING, TRIP, WARNING |

