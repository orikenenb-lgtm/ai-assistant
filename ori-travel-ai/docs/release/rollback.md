# חזרה לאחור (Rollback)

מתי להשתמש: אחרי עדכון שבר משהו, מיגרציה נכשלה באמצע, או שמסד הנתונים נפגע. הפקודות ל-PowerShell מתיקיית `ori-travel-ai`.
סקריפטי ה-PowerShell המוזכרים כאן (`restore-db.ps1`, `migrate.ps1`) **לא הורצו** על Windows בסביבת הפיתוח. גרסאות ה-bash (`restore-db.sh`, `migrate.sh`) הורצו ועובדות, כולל שחזור מגיבוי pre-migrate.

## כלל מספר 1: לפני שנוגעים בכלום

1. עוצרים את השרת (`Ctrl+C` בחלון שבו הוא רץ). שחזור על מסד פתוח יכול להיכשל או לפגוע בו.
2. מגבים את המצב הנוכחי, גם אם הוא שבור. זה מה שמאפשר "לבטל את החזרה":

```powershell
.\scripts\backup-db.ps1
Copy-Item .\apps\api\.env .\apps\api\.env.bak-before-rollback
```

(`.env.bak-*` מכיל את המפתח: שמרו אותו כמו את `.env`, לא ב-git ולא בתיקייה משותפת. קובצי `.env.*` מוחרגים ב-`.gitignore`.)

## 1. חזרה לגרסת קוד קודמת (git)

בדקו שאין שינויים מקומיים שיאבדו:

```powershell
git status
git log --oneline -n 15
```

מעבר זמני לגרסה ישנה (לא מוחק כלום, אפשר לחזור):

```powershell
git switch --detach <מזהה-commit>
```

אחר כך מתאימים את התלויות והממשק לגרסה הזו. **חובה לבנות מחדש את הממשק**, אחרת תמשיכו לראות את הבנייה החדשה:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipWeb
cd apps\web
npm ci
cd ..\..
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1 -Rebuild
```

הערה: `setup.ps1` מריץ מיגרציות קדימה. אם הקוד הישן **ישן יותר מהסכמה במסד**, ראו סעיף 2 לפני ההרצה, כי הקוד הישן לא מכיר עמודות או טבלאות שנוספו.

חזרה לגרסה העדכנית אחרי שסיימתם:

```powershell
git switch -
```

או `git switch <שם-הענף>`.

## 2. שחזור מסד הנתונים מגיבוי

הגיבויים נמצאים ב-`apps\api\data\backups\`:

* `ori_travel-<חותמת>.db`: גיבוי ידני (`backup-db.ps1`).
* `ori_travel-pre-migrate-<חותמת>.db`: נוצר אוטומטית **לפני** מיגרציה ממתינה. זה הגיבוי הנכון כדי "לחזור לפני העדכון".
* `ori_travel-pre-restore-<חותמת>.db`: נוצר אוטומטית ממצב המסד **לפני** שחזור, כדי שאפשר לבטל שחזור.

```powershell
Get-ChildItem .\apps\api\data\backups | Sort-Object LastWriteTime -Descending | Select-Object Name, Length, LastWriteTime
```

שחזור (השרת חייב להיות עצור):

```powershell
.\scripts\restore-db.ps1 -BackupFile .\apps\api\data\backups\ori_travel-pre-migrate-20261112-101500.db
```

מה הסקריפט עושה: בודק שהקובץ הוא מסד SQLite תקין (`integrity_check`) עם טבלאות, שומר את המסד הנוכחי כ-`...-pre-restore-...`, מוחק קבצי `-wal`/`-shm` ישנים, ומעתיק את הגיבוי על `ori_travel.db`. הוא מסרב לקובץ פגום או ריק.

אפשר גם ידנית: מעתיקים את קובץ הגיבוי על `apps\api\data\ori_travel.db` ומוחקים קבצי `ori_travel.db-wal` ו-`ori_travel.db-shm` אם קיימים.

אחרי השחזור:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
Invoke-RestMethod http://localhost:8000/api/ready
```

כדי לאמת: `status = ready`, `schema ok`, והנתונים החשובים (משפחה, טיולים) מופיעים.

### שילוב קוד ישן + מסד ישן

אם חוזרים לקוד ישן, שחזרו גם את גיבוי ה-`pre-migrate` שנוצר לפני העדכון שהרס. כך הסכמה והקוד תואמים. **אל תריצו `setup.ps1` או `migrate.ps1` מהקוד החדש על המסד הישן** אלא אם אתם רוצים לעדכן אותו שוב.

## 3. מפתח ההצפנה

* המפתח (`ORI_DATA_KEY` ב-`.env`) חייב להיות **אותו מפתח** ששימש בזמן היצירה של הגיבוי. גיבוי מסד + מפתח שונה = פרטי דרכון ותאריכי לידה לא נקראים (הפענוח נכשל עם שגיאה "wrong key" ולא מוצג מידע שגוי).
* `setup.ps1` לעולם לא מחליף מפתח קיים. אם מחקתם את `.env` ויצרתם מחדש, נוצר מפתח **חדש** והנתונים המוצפנים הישנים אבודים. שחזרו את ה-`.env` המקורי מהגיבוי הנפרד.
* אם המפתח אבד לגמרי: אין שחזור. אפשר להמשיך להשתמש במסד (משפחה, טיולים, חיפושים), אך פרטי נוסעים רגישים שהוצפנו יצטרכו להיות מוזנים מחדש עם מפתח חדש.
* אחרי החלפת `.env`: מפעילים מחדש את השרת.

## 4. מיגרציות: אזהרות לגבי downgrade

* יש קובצי `downgrade` ב-Alembic, אבל **שחזור מגיבוי בטוח בהרבה** מ-downgrade. downgrade עשוי למחוק עמודות וטבלאות עם הנתונים שבהן, ואינו מחזיר נתונים שנמחקו.
* אם בכל זאת צריך (מפתחים בלבד), רק אחרי גיבוי, ומתיקיית `apps\api`:

```powershell
cd apps\api
.\.venv\Scripts\python -m alembic current
.\.venv\Scripts\python -m alembic downgrade -1
cd ..\..
```

* מיגרציה שנכשלה באמצע: ב-SQLite רוב השינויים רצים בתוך טרנזקציה אך DDL מסוים (בעיקר `batch_alter_table`) עלול להשאיר מצב חצי-מוכן. אל תריצו שוב ושוב: שחזרו את גיבוי ה-`pre-migrate` ובררו את סיבת הכשל ([diagnostics.md](diagnostics.md)).
* אל תערכו ידנית את הטבלה `alembic_version`, אלא אם מפתח מנחה אתכם.
* בדיקה שהסכמה תואמת לקוד (למפתחים): `python -m alembic check` מ-`apps\api`.

## 5. רשימת החלטה מהירה

| מצב | מה עושים |
|---|---|
| קוד חדש שבור, המסד לא עודכן | `git switch --detach <commit>`, `start.ps1 -Rebuild` |
| המסד עודכן והקוד החדש שבור | `restore-db.ps1` עם קובץ ה-`pre-migrate`, ואז חזרת קוד |
| המסד נפגע/נמחק | `restore-db.ps1` עם הגיבוי האחרון |
| נתונים מוצפנים לא נקראים | בדקו שה-`.env` הוא המקורי (אותו `ORI_DATA_KEY`) |
| שחזרתי את הגיבוי הלא נכון | `restore-db.ps1` עם קובץ ה-`pre-restore` |
