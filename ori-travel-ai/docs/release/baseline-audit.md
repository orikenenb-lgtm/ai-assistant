# שחזור בסיס (Baseline) — לפני עבודת V6

> **מטרה:** לבדוק באופן עצמאי את הטענות מהדוח הקודם במקום להניח אותן. הבדיקה רצה בתאריך
> 2026-11-12 בין 14:14 ל-14:23 UTC, ב-**git worktree מבודד** על commit `5e79705`, בלי לשבש את
> סוכן ה-QA ששרת אז ואת סוכני V6. ה-worktree השתמש ב-venv וב-`node_modules` הקיימים.
> הלוגים המלאים שמורים בתיקיית ה-scratchpad של הסשן (`baseline-evidence/`), והם לא חלק מהריפו.

## טענות מול תוצאות

| טענה מהדוח הקודם | פקודה | תוצאה בפועל | אומת? |
|---|---|---|---|
| 672/672 בדיקות API על SQLite | `pytest tests -p no:warnings -o addopts= -q` | **672 passed** (143s), rc=0 | ✅ |
| 672/672 על PostgreSQL 16 | אותה פקודה עם `ORI_TEST_DATABASE_URL=postgresql+psycopg://…/ori_baseline` (שרת PG16 מקומי) | **672 passed** (301s), rc=0 | ✅ |
| Ruff נקי | `ruff check app tests alembic` | `All checks passed!` | ✅ |
| Bandit: 0 ממצאים (רמה בינונית ומעלה) | `bandit -r app -ll -q` | rc=0, 0 issues. רק אזהרות על תוכן הערות `nosec` | ✅ |
| pip-audit: 0 פגיעויות ידועות | `pip_audit -r requirements.txt` | `No known vulnerabilities found` | ✅ |
| migrations תואמים למודלים | `app.cli migrate` ואז `alembic check` | `No new upgrade operations detected.` | ✅ |
| frontend: typecheck | `npm run typecheck` | rc=0 | ✅ |
| frontend: lint | `npm run lint` (`--max-warnings=0`) | rc=0 | ✅ |
| frontend: בדיקות יחידה | `npx vitest run` | **27 files, 152 tests passed** | ✅ |
| frontend: build | `npx vite build --outDir <scratch>` | `✓ built`. index 279KB (gzip 88KB), ui 338KB (gzip 107KB) | ✅ |
| ממצאים בינוניים תוקנו | סקירת `audit-report.md` (נספח) ובדיקות רגרסיה | כל 8 הבינוניים עם בדיקות רגרסיה שעוברות בתוך ה-672 | ✅ לפי הבדיקות. **המבקר לא בדק מחדש** |
| `ORI_ALLOWED_HOSTS` מתועד | `docs/operations/windows-setup.md`, `troubleshooting.md`, `.env.example` | מתועד | ✅ |
| E2E של QA לא הושלם | `ps`, `apps/web/e2e/` | בזמן השחזור רצה ריצת Playwright של סוכן QA. 17 קבצי spec ו-helpers נכתבו. **התוצאה הסופית עדיין לא דווחה** | ⏳ |

## מצב הריפו בזמן השחזור
* ענף `claude/new-session-mm5rqi`, worktree יחיד (חוץ מה-worktree הזמני של השחזור), PR טיוטה #18.
* היו שינויים לא מחויבים רק מסוכנים פעילים: קבצי e2e של QA. הם נדחפו כ-WIP.
* תהליכים פעילים: uvicorn ו-Playwright של QA (פורט 8061), ושרת PostgreSQL 16 מקומי על 55432
  (לבדיקות parity).
* סודות: `.env` לא קיים בריפו, ו-`.env.example` בלי ערכים. בבדיקה של AUD, grep על 486 קבצים מצא רק
  ערכים מזויפים בבדיקות.

## מה **לא** אומת בשחזור
* סקריפטי PowerShell. אין `pwsh` בסביבה.
* ריצת GitHub Actions (רק תקינות YAML).
* ספקים חיים: אין מפתחות, ו-DNS לאתרי התיעוד הרשמיים חסום. פירוט ב-`provider-capability-matrix.md`.
* מודל AI אמיתי: לא היו Ollama או מפתח, ונבדק מול mock בלבד.
