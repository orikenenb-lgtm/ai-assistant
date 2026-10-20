# תוכנית Ladder ל-Zelio SR3B261BD

> נוצר אוטומטית מ-`ladder_program.json` על ידי `tools/render_ladder_doc.py`. לא לערוך ידנית —
> לערוך את ה-JSON, להריץ את הסימולציה, ואז ליצור מחדש את המסמך.

גרסה: `v0.1` · תאריך: `2026-10-15`

## סטטוס

הלוגיקה נבדקה רק בסימולציית Python (ראו `08_Test_Reports/SIMULATION_RESULTS.md`).
היא **לא** נבדקה עדיין ב-Zelio Soft 2 ולא על בקר אמיתי.

## איך מקלידים ב-Zelio Soft 2

1. פרויקט חדש ← בוחרים את הדגם `SR3B261BD` ← שפת תכנות `Ladder`.
2. מקלידים את השורות לפי הסדר בטבלה. **הסדר חשוב** — הלוגיקה תוכננה לסריקה מלמעלה למטה.
3. בשורה עם כמה ענפים: כל ענף הוא שורת מגעים נפרדת, והענפים מחוברים במקביל לפני הסליל (OR).
4. מגע באות קטנה (`i4`, `m8`, `t1`) הוא מגע הפוך של אותה כתובת בתוכנה.
   זה לא קשור לסוג הלחצן בשטח: למשל `i4` פירושו 'ESTOP_OK כבוי', כלומר החירום לחוץ.
5. כל טיימר מוגדר כסוג `A` (השהיית הפעלה) עם הערך מטבלת הטיימרים.
6. ממלאים את התגובות (comments) של כל כתובת לפי טבלת הסמלים.
7. עוברים למצב סימולציה ב-Zelio Soft 2 ומריצים את הבדיקות מ-`08_Test_Reports/TEST_PLAN.md`.

**לאמת בתוכנה עצמה** (לא אומת מכאן): שמות הממסרים העזר הזמינים (`M1`–`M9`, `MA`…),
מספר השורות המרבי, סוגי הטיימרים, והאם תוצאת סליל זמינה מיד לשורות שאחריו באותה סריקה.
הלוגיקה נבדקה בשני מצבי סריקה כדי לא להיות תלויה בהנחה האחרונה.

## שורות התוכנית

| # | ענפים (OR) — מגעים בטור (AND) | סליל | הסבר |
|---|---|---|---|
| 1 | `I3` RESET · `m2` (הפוך) RST_PREV | `[M1` סליל RST_EDGE | זיהוי עלייה של RESET |
| 2 | `I3` RESET | `[M2` סליל RST_PREV | שמירת מצב RESET לסריקה הבאה |
| 3 | `I1` START · `m4` (הפוך) START_PREV | `[M3` סליל START_EDGE | זיהוי עלייה של START |
| 4 | `I1` START | `[M4` סליל START_PREV | שמירת מצב START לסריקה הבאה |
| 5 | `mK` (הפוך) ALWAYS_OFF | `TT1` פקודת טיימר WARMUP | טיימר חימום רץ מרגע עליית המתח |
| 6 | `IC` GAS · `T1` WARMUP | `[M6` סליל GAS_EFF | התראת גז נלקחת בחשבון רק אחרי החימום |
| 7 | `I8` TS2_ALARM<br>**או** `IA` TS4_ALARM<br>**או** `IB` SMOKE<br>**או** `M6` GAS_EFF | `[M5` סליל HAZ_ACTIVE | סכנה: TS2 או TS4 או עשן או גז |
| 8 | `i7` (הפוך) TS1_WARN · `i9` (הפוך) TS3_WARN | `[MH` סליל WARN_NONE | אין אזהרת טמפרטורה |
| 9 | `MD` RUN · `i6` (הפוך) KM1_FB | `TT2` פקודת טיימר FB_FAIL_CLOSE | יש פקודה ואין משוב |
| 10 | `mD` (הפוך) RUN · `I6` KM1_FB | `TT3` פקודת טיימר FB_WELDED | אין פקודה ויש משוב |
| 11 | `I5` OL_TRIPPED<br>**או** `T2` FB_FAIL_CLOSE<br>**או** `T3` FB_WELDED | `[M7` סליל MOT_FAULT | תקלת מנוע: עומס יתר או משוב שגוי |
| 12 | `i4` (הפוך) ESTOP_OK · `m8` (הפוך) L_ESTOP<br>**או** `M5` HAZ_ACTIVE · `m9` (הפוך) L_HAZ<br>**או** `M7` MOT_FAULT · `mA` (הפוך) L_MOT | `SME` SET BUZ | תקלה חדשה מפעילה את הזמזם |
| 13 | `i4` (הפוך) ESTOP_OK | `SM8` SET L_ESTOP | נעילת חירום |
| 14 | `M5` HAZ_ACTIVE | `SM9` SET L_HAZ | נעילת סכנה |
| 15 | `M7` MOT_FAULT | `SMA` SET L_MOT | נעילת תקלת מנוע |
| 16 | `M1` RST_EDGE · `IB` SMOKE · `mF` (הפוך) SRST_REQ | `SMF` SET SRST_REQ | RESET כשהגלאי עדיין מתריע: התחלת רצף איפוס הגלאי |
| 17 | `MF` SRST_REQ | `TT6` פקודת טיימר SRST_PULSE | משך ניתוק המתח לגלאי |
| 18 | `MF` SRST_REQ | `TT7` פקודת טיימר SRST_SETTLE | ניתוק + התייצבות |
| 19 | `MF` SRST_REQ · `t6` (הפוך) SRST_PULSE | `[Q9` סליל SMOKE_RESET | פולס ל-KA1 (המגע NC שלו מנתק את הגלאי) |
| 20 | `T7` SRST_SETTLE | `RMF` RESET SRST_REQ | סיום רצף איפוס הגלאי |
| 21 | `I4` ESTOP_OK · `m5` (הפוך) HAZ_ACTIVE · `m7` (הפוך) MOT_FAULT · `mF` (הפוך) SRST_REQ | `[MC` סליל ALL_CLEAR | אין אף סיבת תקלה פעילה |
| 22 | `M1` RST_EDGE · `I4` ESTOP_OK | `RM8` RESET L_ESTOP | שחרור נעילת חירום — רק אם החירום שוחרר |
| 23 | `M1` RST_EDGE · `m5` (הפוך) HAZ_ACTIVE · `mF` (הפוך) SRST_REQ | `RM9` RESET L_HAZ | שחרור נעילת סכנה — רק אם הסכנה חלפה |
| 24 | `M1` RST_EDGE · `m7` (הפוך) MOT_FAULT | `RMA` RESET L_MOT | שחרור נעילת מנוע — רק אם התקלה חלפה |
| 25 | `M1` RST_EDGE | `RME` RESET BUZ | RESET מאשר ומשתיק את הזמזם |
| 26 | `M1` RST_EDGE · `T1` WARMUP · `MC` ALL_CLEAR | `SMB` SET ARMED | אתחול המערכת: רק באיפוס מבוקר אחרי החימום |
| 27 | `m8` (הפוך) L_ESTOP · `m9` (הפוך) L_HAZ · `mA` (הפוך) L_MOT | `[MG` סליל NO_LATCH | אין תקלה נעולה |
| 28 | `MB` ARMED · `MG` NO_LATCH · `MC` ALL_CLEAR · `I2` STOP_OK | `[MJ` סליל READY | מוכן: מאותחל, בלי נעילות, בלי תקלות, STOP תקין |
| 29 | `M3` START_EDGE · `MJ` READY · `MH` WARN_NONE · `m1` (הפוך) RST_EDGE | `SMD` SET RUN | הפעלה: עלייה של START, מוכן, בלי אזהרה, לא בסריקת RESET |
| 30 | `mJ` (הפוך) READY | `RMD` RESET RUN | עצירה: STOP, תקלה, נעילה או חוסר אתחול (עדיפות לעצירה) |
| 31 | `MD` RUN | `[Q1` סליל KM1_CMD | פקודת KM1 (עוברת בחיווט קשיח דרך S0 ו-F4) |
| 32 | `MB` ARMED · `m8` (הפוך) L_ESTOP · `m9` (הפוך) L_HAZ · `I4` ESTOP_OK · `m5` (הפוך) HAZ_ACTIVE | `[Q2` סליל KM2_CMD | KM2 מוזן רק כשאין סכנה וחירום |
| 33 | `Q1` KM1_CMD · `I6` KM1_FB | `[Q3` סליל LAMP_GREEN | ירוק: פקודה + משוב |
| 34 | `t5` (הפוך) BLINK_OFF | `TT4` פקודת טיימר BLINK_ON | מתנד הבהוב |
| 35 | `T4` BLINK_ON | `TT5` פקודת טיימר BLINK_OFF | מתנד הבהוב |
| 36 | `MJ` READY<br>**או** `t1` (הפוך) WARMUP · `T4` BLINK_ON | `[Q4` סליל LAMP_WHITE | לבן: מוכן, או מהבהב בזמן חימום |
| 37 | `I7` TS1_WARN<br>**או** `I9` TS3_WARN | `[Q5` סליל LAMP_YELLOW | צהוב: אזהרת טמפרטורה |
| 38 | `M8` L_ESTOP<br>**או** `M9` L_HAZ<br>**או** `MA` L_MOT<br>**או** `mB` (הפוך) ARMED · `T1` WARMUP | `[Q6` סליל LAMP_AMBER | ענבר: תקלה נעולה או ממתין לאיפוס ראשון |
| 39 | `M5` HAZ_ACTIVE<br>**או** `i4` (הפוך) ESTOP_OK | `[Q7` סליל LAMP_RED | אדום: סכנה פעילה או חירום לחוץ |
| 40 | `ME` BUZ | `[Q8` סליל BUZZER | זמזם |

### אותה תוכנית בכתיב מקוצר (להקלדה מהירה)

```text
 1: I3 m2  -->  [M1
 2: I3  -->  [M2
 3: I1 m4  -->  [M3
 4: I1  -->  [M4
 5: mK  -->  TT1
 6: IC T1  -->  [M6
 7: I8  |  IA  |  IB  |  M6  -->  [M5
 8: i7 i9  -->  [MH
 9: MD i6  -->  TT2
10: mD I6  -->  TT3
11: I5  |  T2  |  T3  -->  [M7
12: i4 m8  |  M5 m9  |  M7 mA  -->  SME
13: i4  -->  SM8
14: M5  -->  SM9
15: M7  -->  SMA
16: M1 IB mF  -->  SMF
17: MF  -->  TT6
18: MF  -->  TT7
19: MF t6  -->  [Q9
20: T7  -->  RMF
21: I4 m5 m7 mF  -->  [MC
22: M1 I4  -->  RM8
23: M1 m5 mF  -->  RM9
24: M1 m7  -->  RMA
25: M1  -->  RME
26: M1 T1 MC  -->  SMB
27: m8 m9 mA  -->  [MG
28: MB MG MC I2  -->  [MJ
29: M3 MJ MH m1  -->  SMD
30: mJ  -->  RMD
31: MD  -->  [Q1
32: MB m8 m9 I4 m5  -->  [Q2
33: Q1 I6  -->  [Q3
34: t5  -->  TT4
35: T4  -->  TT5
36: MJ  |  t1 T4  -->  [Q4
37: I7  |  I9  -->  [Q5
38: M8  |  M9  |  MA  |  mB T1  -->  [Q6
39: M5  |  i4  -->  [Q7
40: ME  -->  [Q8
```

## טבלת סמלים

| כתובת | שם | תיאור |
|---|---|---|
| `I1` | `START` | לחצן START (NO) |
| `I2` | `STOP_OK` | לחצן STOP (NC) — 1 = משוחרר ותקין |
| `I3` | `RESET` | לחצן RESET (NO) |
| `I4` | `ESTOP_OK` | חירום משוחרר (בלוק NC שני) |
| `I5` | `OL_TRIPPED` | ממסר עומס יתר הופעל (97-98) |
| `I6` | `KM1_FB` | משוב KM1 (13-14) |
| `I7` | `TS1_WARN` | אזור A — סף אזהרה |
| `I8` | `TS2_ALARM` | אזור A — סף התראה |
| `I9` | `TS3_WARN` | אזור B — סף אזהרה |
| `IA` | `TS4_ALARM` | אזור B — סף התראה |
| `IB` | `SMOKE` | גלאי עשן במצב התראה |
| `IC` | `GAS` | MQ-2 דרך ממסר 5V |
| `Q1` | `KM1_CMD` | פקודת מגען מנוע |
| `Q2` | `KM2_CMD` | פקודת מגען הזנה |
| `Q3` | `LAMP_GREEN` | מנוע פועל |
| `Q4` | `LAMP_WHITE` | מוכן / מהבהב בחימום |
| `Q5` | `LAMP_YELLOW` | אזהרת טמפרטורה |
| `Q6` | `LAMP_AMBER` | נדרש איפוס |
| `Q7` | `LAMP_RED` | סכנה / חירום |
| `Q8` | `BUZZER` | זמזם |
| `Q9` | `SMOKE_RESET` | פולס ניתוק מתח לגלאי עשן (מותנה) |
| `M1` | `RST_EDGE` | פולס סריקה אחת בלחיצת RESET |
| `M2` | `RST_PREV` | מצב RESET בסריקה הקודמת |
| `M3` | `START_EDGE` | פולס סריקה אחת בלחיצת START |
| `M4` | `START_PREV` | מצב START בסריקה הקודמת |
| `M5` | `HAZ_ACTIVE` | סכנה פעילה (טמפ' גבוהה/עשן/גז). לוגיקה חיובית: ברירת המחדל 0 בעליית מתח = אין תקלה מדומה |
| `M6` | `GAS_EFF` | גז פעיל אחרי זמן חימום |
| `M7` | `MOT_FAULT` | תקלת מעגל מנוע (עומס יתר / משוב). לוגיקה חיובית |
| `M8` | `L_ESTOP` | נעילת תקלה — חירום |
| `M9` | `L_HAZ` | נעילת תקלה — סכנה |
| `MA` | `L_MOT` | נעילת תקלה — מעגל מנוע |
| `MB` | `ARMED` | המערכת אותחלה באיפוס מבוקר אחרי עליית מתח |
| `MC` | `ALL_CLEAR` | אין אף סיבת תקלה פעילה |
| `MD` | `RUN` | פקודת ריצה למנוע (נעילה עצמית) |
| `ME` | `BUZ` | זמזם — תקלה חדשה שטרם אושרה |
| `MF` | `SRST_REQ` | רצף איפוס גלאי עשן פעיל |
| `MG` | `NO_LATCH` | אין תקלה נעולה |
| `MH` | `WARN_NONE` | אין אזהרת טמפרטורה |
| `MJ` | `READY` | מוכן להפעלה (בלי בדיקת אזהרה) |
| `MK` | `ALWAYS_OFF` | לא מופעל לעולם — המגע ההפוך mK משמש כ'תמיד 1' |

## טיימרים

| טיימר | שם | סוג | ערך בסימולציה | סטטוס הערך | תפקיד |
|---|---|---|---|---|---|
| `T1` | `WARMUP` | `A` | 30.0 s | PLACEHOLDER_FOR_SIMULATION — real value TBD from MQ-2 datasheet and smoke detector manual | זמן חימום אחרי עליית מתח |
| `T2` | `FB_FAIL_CLOSE` | `A` | 1.0 s | PLACEHOLDER — TBD | פקודה בלי משוב = מגען לא נסגר |
| `T3` | `FB_WELDED` | `A` | 1.0 s | PLACEHOLDER — TBD | משוב בלי פקודה = מגע מרותך |
| `T4` | `BLINK_ON` | `A` | 0.5 s | DESIGN_CHOICE | מתנד הבהוב — חצי ראשון |
| `T5` | `BLINK_OFF` | `A` | 0.5 s | DESIGN_CHOICE | מתנד הבהוב — חצי שני |
| `T6` | `SRST_PULSE` | `A` | 3.0 s | PLACEHOLDER — TBD from smoke detector manual | משך ניתוק המתח לגלאי |
| `T7` | `SRST_SETTLE` | `A` | 15.0 s | PLACEHOLDER — TBD from smoke detector manual; must be > T6 | ניתוק + זמן התייצבות הגלאי |

