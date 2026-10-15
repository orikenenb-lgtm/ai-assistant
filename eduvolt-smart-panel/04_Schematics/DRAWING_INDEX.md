# אינדקס דפי השרטוט (שלב 9)

כל הדפים: גרסה `v0.1`, תאריך `2026-10-15`. כל קובץ SVG כולל טבלת כותרת עם שם, מספר דף, תאריך, גרסה ותיאור.

השרטוטים כאן הם **שרטוטי ייחוס** שנוצרו בקוד (`tools/generate_drawings.py`) מתוך טבלאות הנתונים.
המטרה: לשמש בסיס לבנייה ב-EduVolt, וגם תיעוד גיבוי אם התוכנה לא תומכת במשהו.
**הם לא נבנו ב-EduVolt.**

| דף | כותרת | קובץ | תיאור |
|---|---|---|---|
| 01 | שער הפרויקט | `01_Project/PROJECT_DEFINITION.md` | שם, ייעוד, מטרות ומגבלות |
| 02 | תרשים בלוקים | `04_Schematics/02_block_diagram.svg` | זרימת האנרגיה והאותות בכל המערכת |
| 03 | חלוקת מעגלי כוח | `04_Schematics/03_power_distribution.svg` | L1-L2-L3-N-PE מההזנה ועד כל מעגל |
| 04 | הזנה והגנות | `04_Schematics/04_feed_and_protection.svg` | מפסק ראשי, פחת, פסי אפס והארקה |
| 05 | מעגל מנוע | `04_Schematics/05_motor_circuit.svg` | כוח: F3-KM1-F4-M1. פיקוד: שרשרת החיווט הקשיח לסליל |
| 06 | ספק 24V DC | `04_Schematics/06_power_supply_24v.svg` | G1, נתיכי ענפים F10-F13, ממיר 5V |
| 07 | כניסות PLC | `04_Schematics/07_plc_inputs.svg` | כל 16 הכניסות; טבלה: `06_PLC_Logic/IO_MAP.csv` |
| 08 | יציאות PLC | `04_Schematics/08_plc_outputs.svg` | כל 10 היציאות |
| 09 | חיישני טמפרטורה | `04_Schematics/09_temperature_sensors.svg` | B1-B4, שני אזורים × שני ספים |
| 10 | חיישני עשן וגז | `04_Schematics/10_smoke_gas.svg` | B5 + KA1, B6 + KA2 |
| 11 | מערכת התראות | `04_Schematics/11_alarm_system.svg` | נורות, זמזם ומשמעותם |
| 12 | לחצנים ועצירת חירום | `04_Schematics/12_buttons_estop.svg` | S0-S3 |
| 13 | טבלת מהדקים | `10_Documentation/TERMINALS.csv` | X1 כוח, X2 פיקוד 24V, X3 5V |
| 14 | פריסת רכיבים | `05_Panel_Layout/14_panel_layout.svg` | 3 פסים × 70 ס״מ, דלת, תקרה. נתונים: `LAYOUT.csv` |
| 15 | טבלת חיבורים | `10_Documentation/CONNECTIONS.csv` | כל מוליך: מקור, יעד, הדקים, מתח, צבע, סטטוס |
| 16 | לוגיקת PLC | `06_PLC_Logic/STATE_MACHINE.md`, `06_PLC_Logic/ZELIO_LADDER.md` | מכונת המצבים ותוכנית ה-Ladder |
| 17 | טבלת תקלות | `10_Documentation/FAULT_TABLE.md` | כל תקלה: זיהוי, תגובה, פעולת מפעיל |
| 18 | תוכנית בדיקות | `08_Test_Reports/TEST_PLAN.md` | שלבי בדיקה; תוצאות: `SIMULATION_RESULTS.md` |
| 19 | רשימת רכיבים | `10_Documentation/BOM.csv` | קיים / מתוכנן / מומלץ / מותנה, עם נימוק |
| 20 | סיכום הפרויקט | `10_Documentation/PROJECT_SUMMARY.md` | מה הושלם, מה פתוח, מה נלמד |

## סטטוס עמודת הדקים בשרטוטים

- סימון IEC סטנדרטי (למשל `A1/A2`, `95-96`, `13-14` במגען) — מוצג כמו שהוא.
- סימון "מקובל" שצריך אימות על הרכיב — מסומן כך ב-`CONNECTIONS.csv`.
- הדק לא ידוע — מופיע כ-`TBD`. לא הומצא.
