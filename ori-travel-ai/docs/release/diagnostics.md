# אבחון ותמיכה

איך בודקים שהמערכת בריאה, איפה רואים מה קרה, ואיך אוספים מידע לדיווח תקלה **בלי לחשוף סודות**. הפקודות ל-PowerShell; ב-Linux/macOS השתמשו ב-`curl`.

## 1. נקודות בדיקה (ללא התחברות)

| כתובת | מה בודק | תשובה תקינה |
|---|---|---|
| `GET /api/health` | התהליך חי | `200` + `{"status":"ok","time":...}` |
| `GET /api/ready` | מוכנות: מסד, סכמה, הצפנה | `200` + `{"status":"ready",...}`; `503` + `not_ready` אם משהו ירד |

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod http://localhost:8000/api/ready | ConvertTo-Json -Depth 5
```

דוגמה לתשובה תקינה של `/api/ready` (נבדקה בהתקנה נקייה):

```json
{"status":"ready","env":"development","checks":{"database":{"ok":true},"schema":{"ok":true},"encryption":{"ok":true,"message":null}},"booking_live_execution":false}
```

פירוש הבדיקות:

* `database` לא תקין: קובץ המסד חסר/נעול/הרשאות. בדקו `ORI_DATABASE_URL` ושהתהליך יכול לכתוב ל-`apps\api\data\`.
* `schema` לא תקין: "הטבלאות לא נוצרו" > הריצו `.\scripts\migrate.ps1` (או `setup.ps1`).
* `encryption` לא תקין: `ORI_DATA_KEY` חסר/שגוי ב-`.env`. האפליקציה תעבוד, אך שמירת פרטי דרכון תיכשל (503 `ENCRYPTION_UNAVAILABLE`).
* `booking_live_execution` תמיד `false`. הזמנה אמיתית כבויה בקוד.

התשובות לא כוללות סודות, אך כן את `env` (development/production).

## 2. מסך "ספקים ואבחון" באפליקציה

בתפריט: **מערכת > ספקים ואבחון** (`/providers`). דורש משתמש עם הרשאת עריכה; הגדרת ספקים דורשת בעלים.

* **סטטוס כל ספק:** הדגמה / חי / לא מחובר / מושבת / תקין / חלקי / נכשל / פג זמן (תגיות עם הסבר בריחוף).
* **בדיקת תקינות:** כפתור לכל ספק, מבצע בדיקת חיבור אחת (מוגבל קצב). ספק שאינו מחובר לא מבצע בקשת רשת.
* **אבחון:** הצלחה/כשלון/פג זמן, זמן תגובה ממוצע וריצות אחרונות לכל ספק ב-30 הימים האחרונים (`GET /api/providers/diagnostics?days=30`).
* שגיאות ספקים מוצגות בעברית ובקיצור, בלי מפתחות.

מה לבדוק כשחיפוש מחזיר רק DEMO: האם `ORI_LIVE_PROVIDERS_ENABLED=true`, האם מפתחות הספק קיימים ב-`.env`, והאם הופעל מחדש השרת אחרי שינוי.

## 3. לוגים וצנזור

* השרת כותב ל-stdout של החלון שבו רץ: שורה לכל בקשה בפורמט `GET /api/... -> 200 (12ms)`, ושגיאות. **אין קובץ לוג כברירת מחדל.**
* לשמירה לקובץ (בתיקייה הנוכחית, לא בתוך git):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1 *> ori.log
```

* סקריפטי ה-PowerShell מגדירים `PYTHONUTF8=1` כדי שעברית בלוג מופנה לא תקרוס.
* כל תשובת שגיאה כוללת `request_id` (וכותרת `X-Request-ID`), וכל שורת לוג של בקשה מסתיימת ב-`rid=<request_id>`. כדי למצוא את השורה המתאימה לתקלה מחפשים את המזהה בלוג (למשל `Select-String rid=<id>` ב-PowerShell). בדיווח תקלה צרפו את ה-`request_id` שהוצג.
* צנזור אוטומטי בלוגים, בהודעות שגיאה ובלוג הביקורת: סיסמאות, אסימונים, מפתחות (`sk-ant-...`, `duffel_..._`), `Authorization`/`Cookie`, פרטי דרכון ותאריכי לידה, מספרי כרטיס, כתובות אימייל וטוקן הזמנה בנתיב (`/invite/[REDACTED]`).
  הצנזור אמין אך לא מושלם: לפני שמדביקים לוג במקום ציבורי, עברו עליו ידנית (סעיף 5).
* אם ראיתם סוד בלוג, זה באג אבטחה: החליפו את הסוד ודווחו בלי להדביק אותו.

## 4. תקלות נפוצות וחתימות

| מה רואים | סיבה סבירה | פתרון |
|---|---|---|
| `Invalid host header` (400, טקסט פשוט) | הכתובת בדפדפן אינה ב-`ORI_ALLOWED_HOSTS` | להוסיף את השם/IP (בלי כוכביות) ולהפעיל מחדש |
| `ORIGIN_REJECTED` (403) | הבקשה הגיעה ממקור אחר מהכתובת של השרת | לפתוח את אותה כתובת בדיוק (`localhost` ולא `127.0.0.1` לסירוגין); ב-`-Dev` לפתוח `:5173` |
| `CSRF_FAILED` (403) | עוגיית CSRF חסרה/ישנה | לרענן את הדף, להתחבר מחדש, למחוק cookies של האתר |
| כניסה לא נשמרת אחרי login | `ORI_COOKIE_SECURE=true` על HTTP | להחזיר ל-`false` ב-HTTP, או להשתמש ב-HTTPS |
| `ENCRYPTION_UNAVAILABLE` (503) | `ORI_DATA_KEY` חסר/שגוי | לבדוק `.env` (לא להדפיס אותו), `/api/ready` |
| `Port 8000 is busy` | תהליך אחר על הפורט | `start.ps1 -Port 8010` או לאתר את התהליך (ראו troubleshooting) |
| `/api/ready` = `not_ready`, `schema` | מיגרציות לא הורצו | `.\scripts\migrate.ps1` |
| `Refusing to start with unsafe production settings` | `ORI_ENV=production` בלי HTTPS cookie/מפתח/מארחים | להחזיר ל-`development` ב-HTTP מקומי, או לתקן את שלוש ההגדרות |
| `Backup failed - migrations were NOT applied` | גיבוי לפני מיגרציה נכשל (דיסק מלא, קובץ נעול) | לפנות מקום/לעצור את השרת, להריץ שוב; המסד לא שונה |
| `Database file not found` | נתיב מסד שגוי או מסד טרם נוצר | `setup.ps1`; בדקו `ORI_DATABASE_URL` |
| 429 / הודעת "יותר מדי" | הגבלת קצב או נעילת כניסה (15 דקות אחרי 5 כשלונות) | להמתין; אין עקיפה בכוונה |
| חיפוש מחזיר "לא מחובר" לספק | חסר מפתח או `ORI_LIVE_PROVIDERS_ENABLED=false` | ראו [providers.md](../integrations/providers.md) |
| `/api/docs` מחזיר 404 | `ORI_ENV=production` (בכוונה) | רק בפיתוח |
| `UnicodeEncodeError`/עברית מקולקלת בלוג | קידוד קונסולה | Windows Terminal; הסקריפטים כבר מגדירים UTF-8 |

עוד: [troubleshooting.md](../operations/troubleshooting.md).

## 5. איסוף חבילת אבחון בטוחה (בלי סודות)

העיקרון: אוספים **עובדות על המערכת**, לא קבצי תצורה. לעולם לא מצרפים את `.env`, קבצי `*.db`, גיבויים, `ori.log` גולמי או צילומי מסך שמראים מפתחות, קישורי הזמנה או פרטי נוסעים.

הרצה מתיקיית `ori-travel-ai` (קוראת רק את מה שמוצג; לא מדפיסה ערכי הגדרה):

```powershell
$out = Join-Path $env:TEMP 'ori-diagnostics.txt'
$py = '.\apps\api\.venv\Scripts\python.exe'
@(
  "== time: $(Get-Date -Format s)"
  "== os: $([System.Environment]::OSVersion.VersionString)"
  "== powershell: $($PSVersionTable.PSVersion)"
  "== python: $(& $py --version 2>&1)"
  "== node: $(node --version 2>&1)   npm: $(npm --version 2>&1)"
  "== git: $(git rev-parse --short HEAD 2>&1)  branch: $(git rev-parse --abbrev-ref HEAD 2>&1)"
  "== git dirty files: $((git status --porcelain 2>&1 | Measure-Object).Count)"
  "== env file present: $(Test-Path .\apps\api\.env)"
  "== env KEYS SET (names only, no values):"
  (Get-Content .\apps\api\.env -ErrorAction SilentlyContinue | Where-Object { $_ -match '^[A-Z_]+=.+' } | ForEach-Object { ($_ -split '=', 2)[0] })
  "== web dist built: $(Test-Path .\apps\web\dist\index.html)"
  "== backups: $((Get-ChildItem .\apps\api\data\backups -ErrorAction SilentlyContinue | Measure-Object).Count) file(s)"
  "== health:"
  (try { Invoke-RestMethod http://localhost:8000/api/health | ConvertTo-Json -Compress } catch { "unreachable: $($_.Exception.Message)" })
  "== ready:"
  (try { Invoke-RestMethod http://localhost:8000/api/ready | ConvertTo-Json -Depth 5 -Compress } catch { "unreachable or not ready: $($_.Exception.Message)" })
) | Out-File -Encoding utf8 $out
notepad $out
```

הערות:

* "env KEYS SET" מציג רק **שמות** משתנים שיש להם ערך (למשל `ORI_DATA_KEY`, `ORI_AI_PROVIDER`), כדי להבין את התצורה בלי הערכים. עדיין בדקו את הקובץ לפני שליחה.
* לוג: צרפו רק 20-40 שורות סביב השגיאה, יחד עם ה-`request_id` מתשובת השגיאה, ועברו עליהן ידנית. החליפו אימיילים ושמות במחזיקי מקום.
* ב-bash המקבילה: `curl -s localhost:8000/api/health`, `curl -s localhost:8000/api/ready`, `git rev-parse --short HEAD`, `grep -oE '^[A-Z_]+=.+' apps/api/.env | cut -d= -f1`.
* לעולם לא מדביקים: ערך `ORI_DATA_KEY`, מפתחות ספקים, סיסמאות, `ori_session`/`ori_csrf`, קישורי `/invite/...`.

## 6. בדיקות עצמיות מהירות

```powershell
.\scripts\test.ps1 -ApiOnly       # ruff + pytest, מוודא שההתקנה עצמה תקינה
.\scripts\backup-db.ps1           # מוודא שהמסד נקרא וניתן לגיבוי
```
