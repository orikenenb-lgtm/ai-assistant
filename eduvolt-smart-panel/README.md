# לוח חשמל חכם תלת־פאזי — חבילת התכנון

פרויקט גמר בחשמל: לוח 400/230V לימודי עם פיקוד 24V DC, בקר Zelio SR3B261BD, ניטור טמפרטורה, גילוי עשן וגז, בקרת מנוע ועצירת חירום.

> **לתכנון וללימוד בלבד.** אין לחווט מתח רשת, להפעיל ציוד או לאשר בטיחות על סמך החבילה הזאת.
> כל מעגלי הכוח טעונים בדיקה של מורה ושל חשמלאי מוסמך.

## מאיפה מתחילים

1. **`PROJECT_STATUS.md`** — מה הושלם, מה אומת, מה פתוח ומה הצעד הבא.
2. **`01_Project/PROJECT_DEFINITION.md`** — שער הפרויקט והמטרות.
3. **`04_Schematics/DRAWING_INDEX.md`** — כל 20 הדפים ואיפה כל אחד נמצא.

## המבנה

| תיקייה | תוכן |
|---|---|
| `01_Project` | הגדרת הפרויקט, דוח סביבה |
| `02_Backups` | גיבויים (במחשב שלך) |
| `03_Custom_Components` | ביקורת רכיבים מול הספרייה, מפרט לרכיבי EVC |
| `04_Schematics` | שרטוטי ייחוס SVG ואינדקס הדפים |
| `05_Panel_Layout` | פריסת שלושת הפסים, הדלת והתקרה |
| `06_PLC_Logic` | מיפוי I/O, מכונת מצבים, תוכנית Ladder ל-Zelio |
| `07_Simulation` | סימולציית הלוגיקה ובדיקות אוטומטיות (Python) |
| `08_Test_Reports` | תוכנית בדיקות ותוצאות |
| `09_Exports` | ייצואים מ-EduVolt ומ-Zelio Soft 2 |
| `10_Documentation` | רכיבים, חיבורים, מהדקים, בדיקה חשמלית, תקלות, צבעים, סיכום |
| `11_References` | מקורות ורמת האימות שלהם |
| `tools` | סקריפט Windows, פרומפט ל-Claude Code מקומי, מחוללי מסמכים |

## על המחשב שלך (Windows)

ב-PowerShell, מתוך התיקייה `eduvolt-smart-panel` של המאגר.
קודם בדיקה יבשה — מה הסקריפט היה עושה:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\Setup-EduVoltWorkspace.ps1 -WhatIf
```

ואם הכול נראה תקין — הרצה אמיתית:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\Setup-EduVoltWorkspace.ps1
```

אחר כך פותחים Claude Code על המחשב ומדביקים את התוכן של `tools/LOCAL_CLAUDE_CODE_PROMPT.md`.

## הרצת הבדיקות

```bash
cd 07_Simulation
python3 -m unittest -v test_logic
python3 run_simulation.py
```
