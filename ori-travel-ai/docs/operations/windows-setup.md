# התקנה והרצה ב-Windows

מדריך זה מניח Windows 10/11 ו-PowerShell, בלי Docker ובלי GPU. אין צורך במפתחות API: ברירת המחדל היא ספקי DEMO.

> **שקיפות:** סקריפטי ה-PowerShell (`scripts\*.ps1`) נבדקו בקריאה קפדנית אבל **לא הורצו** בסביבת הפיתוח שלנו (Linux, בלי PowerShell).
> סקריפטי ה-bash המקבילים הורצו בפועל עם אותה לוגיקה. אם נתקלים בשגיאה, ראו [troubleshooting.md](troubleshooting.md) ודווחו.

## 1. דרישות מוקדמות

| כלי | גרסה | הערות |
|---|---|---|
| Python | 3.12 ומעלה | מ-[python.org](https://www.python.org/downloads/). בהתקנה לסמן **Add python.exe to PATH** ולהשאיר את ה-py launcher. |
| Node.js | 22 LTS (מינימום 20) | מ-[nodejs.org](https://nodejs.org/). מגיע עם npm. |
| Git | כל גרסה עדכנית | [git-scm.com](https://git-scm.com/) |

בדיקה (בחלון PowerShell חדש, אחרי ההתקנה):

```powershell
py -3 --version
node --version
npm --version
git --version
```

## 2. מדיניות הרצת סקריפטים (Execution Policy)

ברירת המחדל ב-Windows חוסמת הרצת קבצי `.ps1`. שתי אפשרויות:

הרשאה קבועה למשתמש הנוכחי בלבד (מומלץ):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

או הרצה חד-פעמית בלי לשנות הגדרות:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

אם הקבצים הורדו כ-ZIP, ייתכן שצריך גם: `Get-ChildItem -Recurse .\scripts | Unblock-File`

## 3. הרצה ראשונה, שלב אחר שלב

```powershell
git clone <כתובת-המאגר>
cd ai-assistant\ori-travel-ai
.\scripts\setup.ps1 -CreateOwner -OwnerEmail you@example.com -OwnerName "השם שלך"
```

מה הסקריפט עושה:

1. בודק Python 3.12+ ו-Node 20+.
2. יוצר `apps\api\.venv` ומתקין `requirements-dev.txt`.
3. יוצר `apps\api\.env` מתוך `.env.example` ומכניס `ORI_DATA_KEY` חדש (המפתח לא מודפס). **אם `.env` או המפתח כבר קיימים, לא נוגעים בהם.**
4. מריץ `python -m app.cli migrate` ליצירת/עדכון מסד הנתונים.
5. מריץ `npm ci` ב-`apps\web` (דילוג: `-SkipWeb`).
6. עם `-CreateOwner`: מבקש סיסמה בהקלדה מוסתרת, מעביר אותה ל-CLI דרך משתנה סביבה זמני `ORI_OWNER_PASSWORD` שנמחק מיד אחר כך.
7. עם `-SeedDemo`: מוסיף בני משפחה לדוגמה (נתוני דמו בלבד).

הרצה:

```powershell
.\scripts\start.ps1
```

ופתיחת `http://localhost:8000` בדפדפן. בהרצה הראשונה נבנה הממשק (`apps\web\dist`), ו-FastAPI מגיש אותו יחד עם ה-API מאותו מקור (בלי CORS). לבנייה מחדש אחרי עדכון: `.\scripts\start.ps1 -Rebuild`. לעצירה: `Ctrl+C`.

מצב פיתוח (hot reload, שני תהליכים: API על 8000 ו-Vite על 5173):

```powershell
.\scripts\start.ps1 -Dev
```

### למה רק 127.0.0.1?

כברירת מחדל השרת מאזין **רק למחשב הזה**. האפליקציה מכילה מידע משפחתי (ופרטי דרכון מוצפנים), ותעבורת HTTP מקומית אינה מוצפנת.
האזנה לרשת (`-Lan`) חושפת את מסך ההתחברות לכל מכשיר ברשת, בלי הצפנה. אם בכל זאת צריך (למשל טלפון באותה רשת ביתית מהימנה):

```powershell
.\scripts\start.ps1 -Lan
```

* חומת האש של Windows תבקש אישור; אשרו לרשת פרטית בלבד.
* עוגיות ההתחברות אינן מסומנות `Secure` ב-HTTP. הדרך הנכונה היא HTTPS דרך reverse proxy, ואז `ORI_COOKIE_SECURE=true` ב-`.env`.
* גישה מכתובת אחרת (`http://192.168.x.x:8000`) דורשת להוסיף אותה ל-`ORI_CORS_ORIGINS` (ראו troubleshooting).
* אל תחשפו את הפורט לאינטרנט.

## 4. יצירת בעל/ת החשבון

אם לא השתמשתם ב-`-CreateOwner`:

```powershell
.\scripts\create-owner.ps1 -Email you@example.com -Name "השם שלך"
```

אין הרשמה ציבורית; אפשר רק בעלים אחד כברירת מחדל. הסיסמה צריכה לעמוד בדרישות החוזק של המערכת (הודעת שגיאה בעברית תופיע אם לא).

## 5. הזמנת בני משפחה

1. נכנסים לאפליקציה כבעלים, למסך המשפחה.
2. יוצרים הזמנה (אימייל, שם, תפקיד). למבוגרים/בעלים יש לאשר שהם בגירים.
3. המערכת מציגה קישור הזמנה (`/invite/<token>`) **פעם אחת בלבד**. שולחים אותו לאדם; הקישור תקף 72 שעות.
4. האדם בוחר סיסמה ונכנס. הזמנה שלא נוצלה אפשר לבטל.

אם הקישור נשלח מחוץ למחשב הזה, צריך שהשרת יהיה נגיש לו (ראו `-Lan` למעלה) או לשתף מסך/להתקין אצלו.

## 6. עוזר AI (אופציונלי)

האפליקציה עובדת במלואה בלי AI (`ORI_AI_PROVIDER=none`).

**Ollama מקומי, חינם:**

1. התקנה מ-[ollama.com](https://ollama.com/) והורדת מודל: `ollama pull qwen2.5:7b-instruct`
2. ב-`apps\api\.env`: `ORI_AI_PROVIDER=ollama` (ואופציונלית `ORI_OLLAMA_MODEL`).
3. מפעילים מחדש את השרת. בלי GPU זה איטי אך עובד.

**ענן בתשלום (Anthropic):** כל שיחה עולה כסף.

```
ORI_AI_PROVIDER=anthropic
ORI_ANTHROPIC_API_KEY=<המפתח שלכם>
ORI_AI_ALLOW_PAID=true
```

בלי `ORI_AI_ALLOW_PAID=true` המערכת מסרבת לקרוא לענן, גם אם יש מפתח. לעולם לא מדביקים מפתחות בצ'אט או ב-git.

## 7. ספקים חיים

ברירת המחדל: DEMO. הצעות חיות מופיעות רק כשיש מפתחות של ספק **וגם** `ORI_LIVE_PROVIDERS_ENABLED=true`. הוראות לכל ספק (Duffel, Amadeus, Booking, Expedia, Viator), מגבלות ועלויות: [providers.md](../integrations/providers.md).
ספק בלי מפתחות מוצג "לא מחובר". ביצוע הזמנה אמיתית כבוי בקוד גם עם ספקים חיים.

## 8. גיבוי ומפתח ההצפנה

```powershell
.\scripts\backup-db.ps1
```

יוצר עותק עקבי של מסד ה-SQLite ב-`apps\api\data\backups\` עם חותמת זמן.

**חשוב:** פרטי הדרכון ותאריכי הלידה מוצפנים במפתח `ORI_DATA_KEY` שב-`apps\api\.env`. גיבוי המסד **בלי** המפתח = מידע מוצפן שאי אפשר לקרוא.
שמרו עותק של `.env` **בנפרד** מגיבוי המסד, במקום מאובטח (מנהל סיסמאות / כונן מוצפן). לעולם לא ב-git. ראו גם [threat-model.md](../security/threat-model.md).

שחזור: עוצרים את השרת, מעתיקים קובץ גיבוי על `apps\api\data\ori_travel.db`, מתחילים מחדש.

## 9. בדיקות

```powershell
.\scripts\test.ps1            # ruff + pytest + typecheck + lint + vitest + build
.\scripts\test.ps1 -ApiOnly
.\scripts\test.ps1 -E2E       # גם Playwright
```

ל-E2E בפעם הראשונה בלבד, התקנת הדפדפן:

```powershell
cd apps\web
npx playwright install chromium
```

הסקריפט מסתיים בקוד יציאה שונה מאפס אם שלב כלשהו נכשל, ומדפיס טבלת סיכום.

## 10. עדכון

```powershell
git pull
.\scripts\setup.ps1
.\scripts\start.ps1 -Rebuild
```

`setup.ps1` בטוח להרצה חוזרת: משתמש ב-venv הקיים, מתקין תלויות חדשות, מריץ מיגרציות חדשות ולא נוגע במפתח. גבו את המסד לפני עדכון גדול.

## 11. הסרה

1. עוצרים את השרת (`Ctrl+C`).
2. גיבוי אם רוצים לשמור: `.\scripts\backup-db.ps1` ושמירת `.env`.
3. מוחקים את תיקיית `ori-travel-ai` (כולל `apps\api\.venv`, `apps\web\node_modules`, `apps\api\data`). לא נוצרו שירותים, רישומי registry או משימות מתוזמנות.
4. אופציונלי: מסירים Ollama ו-Python/Node דרך "Apps" ב-Windows.
