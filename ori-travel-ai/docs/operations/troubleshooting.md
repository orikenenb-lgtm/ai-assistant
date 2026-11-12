# פתרון תקלות

פקודות מוצגות ל-PowerShell מתיקיית `ori-travel-ai`; ב-Linux/macOS השתמשו בסקריפטי `.sh`.

## הפורט תפוס (`Port 8000 is busy`)

מי משתמש בפורט:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
```

```powershell
Get-Process -Id <מספר-התהליך>
```

או הרצה על פורט אחר:

```powershell
.\scripts\start.ps1 -Port 8010
```

במצב `-Dev`, פורט Vite: `-WebPort 5180`.

## Python לא נמצא או גרסה ישנה

הודעה: `Python 3.12+ not found`. בדקו מה מותקן:

```powershell
py -0p
python --version
```

* מתקינים Python 3.12+ מ-python.org עם **Add python.exe to PATH**, ופותחים חלון PowerShell חדש.
* אם `python` פותח את Microsoft Store: Settings > Apps > Advanced app settings > App execution aliases, מכבים את `python.exe` ו-`python3.exe`.
* Python 3.11 ומטה אינו נתמך (`requires-python >=3.12`).

## חסימת Execution Policy

הודעה: `running scripts is disabled on this system` / `cannot be loaded because running scripts is disabled`.

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

או: `powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1`. אם הקבצים הורדו כ-ZIP: `Get-ChildItem -Recurse .\scripts | Unblock-File`.

## הטקסט העברי מוצג הפוך או כסימני שאלה

זו בעיית תצוגה של הקונסולה, לא של האפליקציה. השתמשו ב-Windows Terminal. הסקריפטים שומרים כל הודעה גם באנגלית.

## `npm ci` נכשל

* `EBUSY` / `EPERM`: סוגרים עורכים/שרתי dev שמחזיקים את `node_modules`, או נוגדי וירוס שסורקים; מנסים שוב.
* `EINTEGRITY` / `ETIMEDOUT`: בעיית רשת. `npm cache verify` ואז שוב.
* `Unsupported engine`: גרסת Node ישנה. נדרש Node 22 LTS (`node --version`).
* מחיקה מלאה ובדיקה מחדש (מוחקת רק תלויות מותקנות):

```powershell
Remove-Item -Recurse -Force .\apps\web\node_modules
.\scripts\setup.ps1
```

## `ORI_DATA_KEY` חסר: שגיאה 503 `ENCRYPTION_UNAVAILABLE`

שמירת פרטי דרכון/תאריך לידה דורשת מפתח הצפנה. בדקו שב-`apps\api\.env` יש שורה `ORI_DATA_KEY=...` עם ערך.
אם אין `.env`, `.\scripts\setup.ps1` ייצור אותו בלי לפגוע בדבר.

אם איבדתם את המפתח: נתונים שהוצפנו בו **לא ניתנים לשחזור**. מפתח חדש מאפשר רק נתונים חדשים. לכן מגבים את `.env` בנפרד ([windows-setup.md](windows-setup.md)).

## שגיאות CSRF / `ORIGIN_REJECTED` (403)

השרת בודק שהבקשות המשנות נתונים מגיעות מאותו מקור. מופיע כשפותחים את האפליקציה מכתובת/פורט שונים מהצפוי.

* השתמשו באותה כתובת שבה השרת רץ (`http://localhost:8000`), לא לערבב `localhost` ו-`127.0.0.1` באותו הסשן.
* במצב `-Dev` יש לפתוח את `http://localhost:5173` (Vite עושה proxy ל-API).
* כתובת אחרת (LAN, פורט אחר): מוסיפים אותה ב-`apps\api\.env` ומפעילים מחדש. ללא כוכביות:

```
ORI_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.20:8000
ORI_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.20
```

## `Invalid host header` (400)

השרת מקבל רק שמות מארח שמופיעים ב-`ORI_ALLOWED_HOSTS`. ברירת המחדל היא `localhost,127.0.0.1`. אם פותחים
את האפליקציה בשם מחשב או בכתובת IP ברשת, צריך להוסיף אותם לרשימה (בלי כוכביות) ולהפעיל מחדש.

* אם הכניסה "נתקעת" אחרי שינוי, מוחקים עוגיות של האתר או מתנתקים ונכנסים שוב.
* מאחורי HTTPS: `ORI_COOKIE_SECURE=true`; ב-HTTP רגיל חייב להיות `false` או שהעוגיות לא יישמרו.

## ננעלתי אחרי כמה ניסיונות כניסה

אחרי 5 ניסיונות כושלים החשבון ננעל זמנית ל-**15 דקות**. ממתינים ואז מנסים שוב. אין עקיפה בכוונה.
אם שכחתם סיסמה, ראו את אפשרויות האיפוס בממשק או ב-[api-contract.md](../architecture/api-contract.md); ל-V1 לא מובטח איפוס בדוא"ל, וכשאין חלופה יש לגבות את המסד ולתקן ידנית.

## אזור זמן: `ZoneInfoNotFoundError` ב-Windows

ל-Windows אין מסד אזורי זמן מערכתי ל-`zoneinfo`. החבילה `tzdata` **כבר ברשימת התלויות** (`requirements.txt`), ולכן `setup.ps1` מתקין אותה.
אם בכל זאת מופיעה השגיאה (venv ישן):

```powershell
.\apps\api\.venv\Scripts\python -m pip install -r .\apps\api\requirements.txt
```

## Playwright: דפדפן חסר

הודעה: `Executable doesn't exist ... playwright install`. פעם אחת:

```powershell
cd apps\web
npx playwright install chromium
```

ב-Linux ללא ספריות מערכת: `npx playwright install --with-deps chromium`. אחרי עדכון גרסת `@playwright/test` מריצים שוב.

## איפוס בטוח של מסד הפיתוח

המסד הוא `apps\api\data\ori_travel.db`. **קודם גיבוי** (מוחק את כל הנתונים!):

```powershell
.\scripts\backup-db.ps1
```

```powershell
Remove-Item .\apps\api\data\ori_travel.db*
.\scripts\setup.ps1 -SkipWeb -CreateOwner -OwnerEmail you@example.com -OwnerName "השם שלך" -SeedDemo
```

לא מוחקים את `.env` (המפתח!). לניסוי חד-פעמי בלי לגעת במסד האמיתי, מצביעים על מסד זמני:

```powershell
$env:ORI_DATABASE_URL = "sqlite:///C:/Temp/ori-test.db"
.\scripts\start.ps1
```

(`Remove-Item Env:\ORI_DATABASE_URL` כדי לחזור.)

## איפה הלוגים?

* ההודעות מודפסות לחלון שבו רץ השרת (stdout): בקשות (`GET /api/... -> 200`) ושגיאות. אין קובץ לוג כברירת מחדל.
* לשמירה לקובץ: `.\scripts\start.ps1 *> ori.log` (הקובץ ייווצר בתיקייה הנוכחית; לא בתוך git).
* לוגים מצונזרים: לא אמורים להופיע בהם סיסמאות, מפתחות או פרטי דרכון. אם ראיתם כאלה, דווחו כבאג אבטחה.

## `/api/docs` או `/api/openapi.json` מחזירים 404

בכוונה כבויים כש-`ORI_ENV=production`. בפיתוח (`development`) הם זמינים.

## עדיין תקוע?

מריצים `.\scripts\test.ps1 -ApiOnly` כדי לבדוק שההתקנה תקינה, ובודקים ש-`apps\api\.env` קיים. שגיאות בדוח: מצרפים את הודעת השגיאה (בלי מפתחות וסיסמאות).
