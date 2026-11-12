# Ori Travel AI

פלטפורמת נסיעות פרטית למשפחה, בעברית ומימין לשמאל: חיפוש טיסות, מלונות, רכבים ופעילויות; השוואה שקופה
בין הצעות; תכנון טיולים; מעקב מחירים; והכנת הזמנות באישור אנושי. אין הרשמה ציבורית. בעל/ת החשבון יוצר/ת
את המשתמש הראשון ומזמין/ה את שאר בני המשפחה.

## סטטוס אמיתי (בלי הגזמות)

| נושא | מצב |
|---|---|
| ספקי נסיעות | **DEMO**. כל ההצעות מסומנות DEMO. ספקים חיים מוצגים כ"**לא מחובר**" עד שמוסיפים מפתחות **וגם** מפעילים `ORI_LIVE_PROVIDERS_ENABLED=true` ([providers.md](docs/integrations/providers.md)). |
| ביצוע הזמנה אמיתית | **כבוי בקוד.** המערכת מכינה הזמנה ודורשת אישור, אבל לא קונה דבר ([booking-safety.md](docs/security/booking-safety.md)). |
| עוזר AI | **אופציונלי.** ברירת המחדל `none`; כל החיפוש הידני עובד בלעדיו. אפשר Ollama מקומי (חינם) או ענן בתשלום באישור מפורש בלבד. |
| מסד נתונים | SQLite מקומי. תואם PostgreSQL (אופציונלי). |
| נתוני נוסעים רגישים | דרכון ותאריך לידה מוצפנים; דורש `ORI_DATA_KEY` ב-`apps/api/.env`. |

## התחלה מהירה (Windows PowerShell)

דרישות: Python 3.12+, Node.js 22 LTS, Git. פירוט מלא: [windows-setup.md](docs/operations/windows-setup.md).

```powershell
cd ori-travel-ai
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -CreateOwner -OwnerEmail you@example.com -OwnerName "השם שלך"
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

ואז לפתוח בדפדפן: `http://localhost:8000` (פקודת ההרצה הנבדקת: `scripts/start.sh app --rebuild --port N` ב-bash, `.\scripts\start.ps1 -Rebuild -Port N` ב-PowerShell; ברירת המחדל פורט 8000).

* בדיקת תקינות: `http://localhost:8000/api/health` ו-`http://localhost:8000/api/ready`.
* שדרוג: `git pull` ואז `setup.ps1` (מגבה את המסד אוטומטית לפני מיגרציה ממתינה) ו-`start.ps1 -Rebuild`.
* מדריכי שחרור: [windows-release.md](docs/release/windows-release.md) · [rollback.md](docs/release/rollback.md) · [diagnostics.md](docs/release/diagnostics.md)

## התחלה מהירה (Linux / macOS)

```bash
cd ori-travel-ai
scripts/setup.sh --create-owner you@example.com "השם שלך"
scripts/start.sh
```

## סקריפטים

| סקריפט | מה עושה |
|---|---|
| `scripts/setup.ps1` / `setup.sh` | יוצר venv, מתקין תלויות, יוצר `.env` עם מפתח הצפנה חדש, מריץ מיגרציות, `npm ci` |
| `scripts/start.ps1` / `start.sh` | הרצה מקומית (ממשק + API על פורט 8000); `-Dev` / `dev` למצב פיתוח |
| `scripts/test.ps1` / `test.sh` | כל הבדיקות (ruff, pytest, typecheck, lint, vitest, build; `-E2E` ל-Playwright) |
| `scripts/create-owner.ps1` / `.sh` | יצירת בעל/ת החשבון |
| `scripts/seed-demo.ps1` / `.sh` | נתוני דמו |
| `scripts/migrate.ps1` / `.sh` | מיגרציות עם גיבוי אוטומטי `pre-migrate` לפני עדכון ממתין |
| `scripts/backup-db.ps1` / `.sh` | גיבוי SQLite מתוארך |
| `scripts/restore-db.ps1` / `.sh` | שחזור מגיבוי (שומר קודם את המסד הנוכחי כ-`pre-restore`) |
| `scripts/export-openapi.py` | ייצוא חוזה ה-API ל-`packages/shared/openapi.json` |

הערה: סקריפטי ה-PowerShell נכתבו ונבדקו בקריאה בלבד ו**לא הורצו בסביבת הפיתוח של הפרויקט** (אין שם PowerShell).
סקריפטי ה-bash הורצו בפועל, כולל התקנה נקייה, גיבוי לפני מיגרציה ושחזור. אם משהו נכשל ב-Windows, ראו [troubleshooting.md](docs/operations/troubleshooting.md).

## תיעוד

* ארכיטקטורה: [overview.md](docs/architecture/overview.md) · [data-flow.md](docs/architecture/data-flow.md) · [api-contract.md](docs/architecture/api-contract.md)
* אבטחה: [threat-model.md](docs/security/threat-model.md) · [booking-safety.md](docs/security/booking-safety.md)
* ספקים: [providers.md](docs/integrations/providers.md) · [provider-api-notes.md](docs/integrations/provider-api-notes.md) · [tool-capability-matrix.md](docs/integrations/tool-capability-matrix.md)
* תפעול: [windows-setup.md](docs/operations/windows-setup.md) · [troubleshooting.md](docs/operations/troubleshooting.md)
* שחרור: [windows-release.md](docs/release/windows-release.md) · [rollback.md](docs/release/rollback.md) · [diagnostics.md](docs/release/diagnostics.md)
* חוזה משותף: [packages/shared/README.md](packages/shared/README.md)
* תיאום הסוכנים: [organization.md](docs/agents/organization.md) · [task-board.md](docs/agents/task-board.md) · [decisions.md](docs/agents/decisions.md)
* ממשק: [apps/web/README.md](apps/web/README.md)

## מבנה

```
apps/api         FastAPI + SQLAlchemy + Alembic
apps/web         React + TypeScript + Vite (עברית, RTL)
packages/shared  OpenAPI כמקור אמת לחוזה
scripts          הרצה, בדיקות, גיבוי (PowerShell + bash)
docs             ארכיטקטורה, אבטחה, תפעול
```

CI: `.github/workflows/ori-travel-ai.yml` (בדיקות API על SQLite ו-PostgreSQL, web, e2e, בדיקות אבטחה).
