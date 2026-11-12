# מדריך שחרור והתקנה ב-Windows

מסמך זה הוא רשימת הבדיקה להתקנה, לעדכון ולהפעלה יומיומית של Ori Travel AI על מחשב Windows אחד, בלי Docker.
הפקודות ל-PowerShell (Windows PowerShell 5.1 או PowerShell 7) מתיקיית `ori-travel-ai`. מדריך מפורט יותר: [windows-setup.md](../operations/windows-setup.md).

> **שקיפות על הבדיקות:** סקריפטי ה-bash הורצו בפועל (התקנה נקייה על Linux, ראו סוף המסמך).
> סקריפטי ה-PowerShell **לא הורצו** בסביבת הפיתוח (אין שם PowerShell). הם נכתבו כמקבילים של סקריפטי ה-bash ונבדקו בקריאה בלבד.
> אם משהו נכשל, ראו [troubleshooting.md](../operations/troubleshooting.md) ו-[diagnostics.md](diagnostics.md).

## 1. דרישות מוקדמות

* Windows 10/11, חלון PowerShell (מומלץ Windows Terminal).
* Python 3.12 ומעלה, עם "Add python.exe to PATH" ו-py launcher.
* Node.js 22 LTS (מינימום 20) ו-npm.
* Git.
* כ-1.5GB פנויים (venv, `node_modules`, בנייה) ואינטרנט להתקנה הראשונה.

```powershell
py -3 --version
node --version
npm --version
git --version
```

אם סקריפטים חסומים: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (פעם אחת), או הרצה עם `powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1`.

## 2. התקנה נקייה

```powershell
git clone <כתובת-המאגר>
cd ai-assistant\ori-travel-ai
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -CreateOwner -OwnerEmail you@example.com -OwnerName "השם שלך"
```

מה קורה: venv חדש, התקנת תלויות, יצירת `apps\api\.env` עם `ORI_DATA_KEY` חדש (לא מודפס), מיגרציות, `npm ci`, ויצירת בעל/ת החשבון (סיסמה בהקלדה מוסתרת).

הפעלה:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

ואז לפתוח `http://localhost:8000`. בהרצה הראשונה נבנה הממשק (כדקה). לפורט אחר: `-Port 8010`. לעצירה: `Ctrl+C`.

בדיקת תקינות מחלון שני:

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod http://localhost:8000/api/ready
```

התוצאה הצפויה: `status = ok`, ו-`status = ready` עם `database`, `schema`, `encryption` כולם `ok = True`.

**מיד אחרי ההתקנה:** גבו את `apps\api\.env` (ראו סעיף 7).

## 3. שדרוג מעותק קודם

1. עוצרים את השרת (`Ctrl+C`).
2. מושכים את הקוד. אם אתם ב-git: `git pull`. אם זה עותק חדש בתיקייה אחרת, ראו "העברה לתיקייה חדשה" למטה.
3. מריצים שוב את ההתקנה. היא בטוחה להרצה חוזרת: משתמשת ב-venv הקיים, **לא נוגעת במפתח ההצפנה**, ו**לפני כל מיגרציה שממתינה מייצרת גיבוי אוטומטי** של מסד הנתונים.

```powershell
git pull
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1 -Rebuild
```

הגיבוי האוטומטי נשמר ב-`apps\api\data\backups\<שם-מסד>-pre-migrate-<חותמת-זמן>.db`. אם המסד כבר מעודכן, לא נוצר גיבוי (ההודעה: `already at the latest migration`).
אם הגיבוי נכשל, **המיגרציה לא רצה** והסקריפט נעצר.

להרצת מיגרציות בלבד (אחרי `git pull`, בלי התקנת תלויות):

```powershell
.\scripts\migrate.ps1
```

אם משהו השתבש אחרי שדרוג: [rollback.md](rollback.md).

### העברה לתיקייה חדשה (עותק חדש של הקוד)

1. עוצרים את השרת בעותק הישן.
2. גיבוי: `.\scripts\backup-db.ps1` בעותק הישן.
3. מעתיקים לעותק החדש **אחרי** שהרצתם בו `setup.ps1` פעם אחת (כדי שיהיה venv):
   * `apps\api\data\ori_travel.db` (או קובץ הגיבוי) אל `apps\api\data\` בעותק החדש.
   * `apps\api\.env` הישן **במקום** ה-`.env` שנוצר, כדי שמפתח ההצפנה יישאר אותו מפתח.
4. מריצים `.\scripts\setup.ps1` (תיצור גיבוי pre-migrate ותעדכן סכמה) ואז `start.ps1`.

## 4. בעל/ת החשבון הראשונ/ה והזמנת המשפחה

* אם לא השתמשתם ב-`-CreateOwner`: `.\scripts\create-owner.ps1 -Email you@example.com -Name "השם שלך"`.
* אין הרשמה ציבורית. הסיסמה חייבת לעמוד בדרישות החוזק (הודעת שגיאה בעברית תופיע אחרת).
* אחרי 5 ניסיונות כניסה כושלים החשבון ננעל ל-15 דקות.

הזמנת בן/בת משפחה: נכנסים כבעלים > **משפחה** (בני משפחה) > "הזמנת בן/בת משפחה" (אימייל, שם, תפקיד) > "יצירת קישור הזמנה".
המערכת מציגה קישור הזמנה **פעם אחת בלבד**, תקף 72 שעות. שולחים אותו לאדם, והוא בוחר סיסמה. קישור שנשלח ל-`localhost` לא יעבוד ממכשיר אחר, ראו סעיף 8 (מצב רשת מקומית).

## 5. הפעלת AI וספקים בבטחה

ברירת המחדל כבויה ובטוחה: `ORI_AI_PROVIDER=none`, `ORI_LIVE_PROVIDERS_ENABLED=false`. כל החיפוש הידני עובד בלי מפתחות.

כללי זהב:

* מפתחות נכנסים **רק** ל-`apps\api\.env`, לעולם לא לצ'אט, ל-git או לצילומי מסך.
* אחרי כל שינוי ב-`.env`: עוצרים ומפעילים מחדש את השרת.
* שנה אחד בכל פעם, ובדקו ב"ספקים ואבחון" שהסטטוס משתנה כצפוי.

**AI מקומי (חינם):** `ORI_AI_PROVIDER=ollama` אחרי התקנת Ollama והורדת מודל. פרטים ב-[windows-setup.md](../operations/windows-setup.md).

**AI בענן (עולה כסף):** דרושים גם `ORI_ANTHROPIC_API_KEY` **וגם** `ORI_AI_ALLOW_PAID=true`. בלי השני המערכת מסרבת לקרוא לענן. מומלץ להגדיר מגבלת הוצאה בחשבון הספק.

**ספקי נסיעות חיים:** רק כש-`ORI_LIVE_PROVIDERS_ENABLED=true` **וגם** קיימים פרטי גישה לספק. מומלץ להתחיל בטוקן בדיקה (`duffel_test_...`, `ORI_AMADEUS_ENV=test`). פירוט והגבלות: [providers.md](../integrations/providers.md).
בדיקת חיבור: מסך **ספקים ואבחון** > "בדיקת תקינות" לכל ספק. ספק בלי מפתחות מוצג "לא מחובר" ולא מבצע בקשות רשת.

**הזמנה אמיתית כבויה בקוד** (`ORI_BOOKING_LIVE_EXECUTION` נשאר `false`; גם אם מוגדר אחרת השירות מסרב). המערכת מכינה הזמנה ומציגה אישור, אבל לא קונה. ראו [booking-safety.md](../security/booking-safety.md).

## 6. DEMO לעומת LIVE: איך מבדילים

| תג בממשק | משמעות |
|---|---|
| **הדגמה (DEMO)** | נתונים מומצאים לבדיקה. מחירים, זמינות וספקים אינם אמיתיים ואי אפשר להזמין אותם. זו ברירת המחדל. |
| **חי (LIVE)** | תשובה עדכנית מספק רשמי, עם פרטי גישה אמיתיים. המחיר הסופי נקבע רק אצל הספק. |
| **שמור במטמון** | תוצאה מחיפוש קודם (עד `ORI_SEARCH_CACHE_TTL_MINUTES`, ברירת מחדל 15 דקות). בדקו שוב לפני החלטה. |
| **לא מחובר** | חסרים פרטי גישה, או שחיפוש חי כבוי. לא נשלחות בקשות. |

הצעות DEMO ו-LIVE אינן מתערבבות בלי תיוג. נתוני DEMO שנזרעו ב-`-SeedDemo` הם לבדיקה בלבד ואינם נזרעים בסביבת `production`.

## 7. גיבויים, כולל מפתח ההצפנה

שני דברים נדרשים לשחזור מלא, ויש לשמור אותם **בנפרד**:

1. **מסד הנתונים:** `.\scripts\backup-db.ps1` יוצר עותק עקבי עם חותמת זמן ב-`apps\api\data\backups\`.
2. **מפתח ההצפנה:** השורה `ORI_DATA_KEY=...` בקובץ `apps\api\.env`. בלעדיו פרטי דרכון ותאריכי לידה **אינם ניתנים לפענוח**, גם אם המסד שלם. אין דרך לשחזר מפתח שאבד.

המלצות: מעתיקים את `.env` למנהל סיסמאות או לכונן מוצפן, **לא** ליד קובץ הגיבוי של המסד ולא ל-git (`.env` מוחרג ב-`.gitignore`).
גיבוי לפני: כל שדרוג, כל שינוי גדול בהגדרות, וכל מחיקה. הסקריפט `setup`/`migrate` מגבה אוטומטית רק לפני מיגרציה ממתינה.
בדיקה שהגיבוי טוב: מעתיקים אותו למקום זמני ומשחזרים לשם (ראו [rollback.md](rollback.md)), לא על המסד החי.

## 8. מצב רשת מקומית (LAN) ו-HTTPS

ברירת המחדל: השרת מאזין רק ל-`127.0.0.1` (המחשב הזה). לגישה מטלפון באותה רשת ביתית:

1. מוצאים את כתובת ה-IP של המחשב: `ipconfig` (למשל `192.168.1.20`).
2. ב-`apps\api\.env` מוסיפים אותה לרשימת המארחים (בלי כוכביות, מופרדים בפסיקים):

```
ORI_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.20
```

3. מפעילים עם `-Lan` ומאשרים בחומת האש של Windows **לרשת פרטית בלבד**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1 -Lan
```

4. בטלפון: `http://192.168.1.20:8000`.

בלי שלב 2 השרת מחזיר `400 Invalid host header` (זו הגנה מכוונת). בדיקה שבוצעה: בקשה עם `Host: evil.example` נחסמת ב-400; בקשה עם כתובת שהוספה ל-`ORI_ALLOWED_HOSTS` מתקבלת; ובקשה משנה-מצב עם `Origin` של אתר זר נדחית ב-403 `ORIGIN_REJECTED`.
במצב app (ממשק ו-API מאותו שרת) אין צורך להוסיף ל-`ORI_CORS_ORIGINS`.

**אזהרת HTTPS:** ב-LAN התעבורה היא HTTP לא מוצפן: סיסמאות ו-cookies נראים לכל מי שמאזין ברשת, והעוגיות לא מסומנות `Secure`.
* השתמשו רק ברשת ביתית מהימנה, לעולם לא ב-Wi-Fi ציבורי, ולעולם אל תחשפו את הפורט לאינטרנט (port forwarding).
* להצפנה אמיתית: reverse proxy עם HTTPS (למשל Caddy) ואז `ORI_COOKIE_SECURE=true`.
* אל תגדירו `ORI_ENV=production` על HTTP: במצב production השרת **מסרב לעלות** בלי `ORI_COOKIE_SECURE=true`, בלי `ORI_DATA_KEY` או עם `ORI_ALLOWED_HOSTS` רחב מדי.
* `/api/docs` נסגר רק ב-production. ב-development הוא פתוח לכל מי שמגיע לשרת.

## 9. מה כן ומה לא (מגבלות ידועות)

* **ספקים:** הכל DEMO עד שמגדירים ספקים חיים. כיסוי ספקים חיים נבדק מול mocks בלבד (אין מפתחות אמיתיים בסביבת הפיתוח).
* **הזמנות:** הכנה ואישור בלבד. אין רכישה.
* **AI:** נבדק מול mock בלבד, לא מול מודל אמיתי. חייב להיות אופציונלי.
* **סקריפטי PowerShell:** לא הורצו על Windows אמיתי בסביבת הפיתוח. זה הדבר הראשון שיש לאמת בהרצה הראשונה.
* **GitHub Actions:** קובץ ה-workflow תקין ומנותח, אך לא נצפתה בו ריצה אמיתית.
* **מסד נתונים:** SQLite מקומי, משתמש אחד בכל פעם בפועל. אין שחזור אוטומטי מכשל; גיבוי הוא באחריותכם.
* **איפוס סיסמה בדוא"ל:** לא מובטח. שכחתם סיסמה: ראו [troubleshooting.md](../operations/troubleshooting.md).
* **גיבוי אוטומטי מתוזמן:** אין. הגיבוי הוא ידני, חוץ מהגיבוי לפני מיגרציה.
* **שינוי נתיב מסד נתונים/PostgreSQL:** סקריפטי הגיבוי תומכים ב-SQLite בלבד. ב-PostgreSQL משתמשים ב-`pg_dump`.

## 10. רשימת בדיקה לפני "מוכן"

- [ ] `setup.ps1` הסתיים בלי שגיאה והדפיס "Setup complete".
- [ ] `start.ps1` מדפיס `Open: http://localhost:8000` ואפשר להיכנס כבעלים.
- [ ] `/api/ready` מחזיר `ready`, כולל `encryption ok`.
- [ ] `apps\api\.env` גובה במקום נפרד ומאובטח.
- [ ] נוצר גיבוי ראשון ב-`apps\api\data\backups\` והוכח שאפשר לשחזר ממנו.
- [ ] ב"ספקים ואבחון" כל הספקים מוצגים כצפוי (DEMO או "לא מחובר").
- [ ] אם פותחים LAN: `ORI_ALLOWED_HOSTS` עודכן, חומת אש לרשת פרטית בלבד, ולא נחשף לאינטרנט.
- [ ] (מומלץ) `.\scripts\test.ps1 -ApiOnly` עובר.

## נספח: מה נבדק בפועל (Linux/bash, התקנה נקייה)

התקנה נקייה מ-clone של הענף על Python 3.13 ו-Node 22: `setup.sh` כ-23 שניות (כולל `npm ci`), `start.sh app --rebuild --port 8091` עלה אחרי כ-15 שניות כולל בניית הממשק.
`/api/health` ו-`/api/ready` החזירו 200; `/` ונתיב עמוק של ה-SPA הוגשו כ-HTML; כניסה עם CSRF עבדה; `Host: evil.example` ו-Host של LAN שלא ברשימה נדחו ב-400; עם `ORI_ALLOWED_HOSTS` שכולל כתובת LAN, בקשה עם אותו Host התקבלה, כולל כניסה ופעולה משנת-מצב עם Origin תואם.
