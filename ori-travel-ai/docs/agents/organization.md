# מבנה הארגון הרב-סוכני — Ori Travel AI

> המסמך מתעד את **מה שקרה בפועל**: 20 תפקידים מוגדרים, וכמה סוכנים נפרדים באמת הופעלו.
> שום ביצוע לא מוצג כנפרד אם הוא לא היה נפרד.

## איך זה עובד בסביבה הזו

* **המנהל (01 Project Director)** הוא סשן Claude Code הראשי. `get_session` החזיר שהמודל
  המוגדר הוא `claude-opus-5-5`, וזה גם המודל שהגיש את התשובות (`last_served_model`).
* **סוכנים נפרדים** מופעלים עם הכלי `Agent`, שתומך בבחירת מודל לכל סוכן דרך הפרמטר `model`.
  הערכים הנתמכים הם `opus`, `sonnet`, `haiku` ו-`fable`.
* **מגבלת אימות:** הסביבה קיבלה את פרמטר המודל, אבל מתוך סוכן-משנה אין דרך לאמת
  באופן עצמאי איזה מודל הגיש לו את התשובות. לכן הטבלה מתעדת את **המודל שנדרש**, ולא טוענת
  לאימות שלא בוצע.
* **בידוד קבצים:** כל סוכן מקבל רשימת קבצים בלעדית (file scope). כל הסוכנים עובדים על אותו עץ
  עבודה, בלי worktrees נפרדים (ההחלטה מנומקת ב-decisions.md, ד-004). לסוכנים אסור להריץ
  פקודות git שמשנות מצב. רק המנהל מבצע commit, אחרי סקירה ובדיקות.
* **מקביליות מוגבלת:** לכל היותר 4–5 סוכנים במקביל, כדי לא לשרוף מכסה ומשאבי מכונה
  (4 ליבות). אין "20 סוכנים בשביל המספר".

## 20 התפקידים ומי ביצע אותם בפועל

| # | תפקיד | צוות | בוצע בפועל ע״י | מודל שנדרש |
|---|---|---|---|---|
| 01 | Project Director | הנהלה | הסשן הראשי | Opus 5.5 (מאומת דרך get_session) |
| 02 | Deputy Director | הנהלה | הסשן הראשי (לוח משימות, אינטגרציה, חסמים) | Opus 5.5 |
| 03 | Backend Lead | Alpha | הסשן הראשי (ליבת ה-API, חוזים) + סוכן B2 (חיפוש) | Opus |
| 04 | Backend Engineer | Alpha | סוכן B1 | sonnet |
| 05 | Database Engineer | Alpha | הסשן הראשי (מודלים, Alembic) + סוכן B1 | Opus / sonnet |
| 06 | Frontend Lead | Beta | סוכן F1 | opus |
| 07 | Frontend Engineer | Beta | סוכנים F2, F3, F4 | sonnet |
| 08 | UX Designer | Beta | סוכן F1 (מערכת עיצוב RTL) | opus |
| 09 | Provider Lead | Gamma | סוכן R1 (מחקר) + סוכן B2 (ממשק מתאמים) | sonnet / opus |
| 10 | Flights Specialist | Gamma | סוכן R1 (היתכנות) + סוכן B6 (מתאמים חיים) | sonnet |
| 11 | Hotels Specialist | Gamma | סוכן R1 + סוכן B6 | sonnet |
| 12 | Cars & Activities Specialist | Gamma | סוכן R1 + סוכן B6 | sonnet |
| 13 | AI Lead | Delta | סוכן B5 | opus |
| 14 | AI Orchestration Engineer | Delta | סוכן B5 | opus |
| 15 | Comparison Engineer | Delta | סוכן B2 | opus |
| 16 | Security Lead | Epsilon | הסשן הראשי (מודל איומים, ליבת אבטחה) + סוכן ביקורת | Opus / fable |
| 17 | Booking Safety Engineer | Epsilon | סוכן B4 | fable |
| 18 | QA Engineer | Epsilon | סוכן QA | sonnet |
| 19 | DevOps Engineer | Epsilon | סוכן D1 | sonnet |
| 20 | Independent Auditor | Epsilon | סוכן AUD נפרד, שלא כתב קוד במערכת | fable |

## גלי ביצוע (מתעדכן תוך כדי)

| גל | סוכנים שהופעלו בפועל | סטטוס |
|---|---|---|
| 0 | המנהל בלבד: סביבה, חוזים, ליבת API, אימות | ✅ הושלם, 17/17 בדיקות עוברות |
| 1 | B1, B2, F1, R1 (4 במקביל) | בביצוע |
| 2 | B3, B4, B5, B6, F2 (מתוכנן) | ממתין |
| 3 | F3, F4, D1 (מתוכנן) | ממתין |
| 4 | QA, AUD (מתוכנן) | ממתין |
| 5 | המנהל: תיקונים, אימות סופי, תיעוד | ממתין |

הספירה הסופית של הסוכנים שהופעלו בפועל מופיעה בסוף [agent-activity-log.md](agent-activity-log.md).
