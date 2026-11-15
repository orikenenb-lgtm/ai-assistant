# NOA Personal Bridge — בסיס רגרסיה (Baseline Regression)

**צוות:** Agent 29 (Regression Testing Engineer) + Agent 21 (Integration) · Agent 30 (DevOps)
**תאריך הרצה:** 2026-11-15 (UTC, ‏~20:15–20:25)
**מטרה:** לתעד את מצב הבדיקות של המערכות הקיימות **לפני** שהגשר נוגע במשהו, כדי שבכל שלב אפשר יהיה להוכיח ששום דבר לא נשבר.

## 1. מה נבדק ואיפה

- **קוד שנבדק:** `main` = `c4ce0d7a78c25982f69099d75093d60efa46fbff`. חולץ עם `git archive main | tar -x -C <scratch>/main-copy`, כלומר בדיוק התוכן ה-committed, בלי קבצי עבודה מקומיים.
- **voice-agents:** `git archive origin/ccr-a60c5c0c-bohsof voice-agents | tar -x -C <scratch>/va-copy` (commit `fff8544`).
- **כל ההרצות בוצעו בתיקיית scratch מחוץ לריפו**: `/tmp/claude-0/-home-user-ai-assistant/f010ffe6-2a24-5262-b041-5bf173e21a8a/scratchpad/`. venvs, `node_modules`, `dist`, `.next` ולוגים נוצרו שם בלבד, כך שבריפו לא נוצר שום קובץ cache או build. (`node_modules` מוחרג ב-git בשני הפרויקטים — `frontend/.gitignore:10`, `smart-crm/.gitignore:4` — אבל בחרנו להריץ בעותק כדי להשאיר את הריפו נקי לגמרי.)
- **כלים:** Python 3.11.18 (backend, כמו ב-CI), Python 3.12.3 (voice-agents), Node v22.23.4, npm 10.9.9 (CI: Node 22).
- **ללא רשת לשירותי פרודקשן**, בלי deploy ובלי DB אמיתי. רשת שימשה רק להורדת חבילות (PyPI/npm).

## 2. טבלת תוצאות

| # | רכיב | פקודה (cwd) | Exit | תוצאה | משך |
|---|---|---|---|---|---|
| 1 | backend — התקנה | `python3.11 -m venv venv-backend && venv-backend/bin/pip install -q -r requirements-dev.txt` (`main-copy/backend`) | 0 | הותקן | 17s |
| 2 | **backend — pytest** | `PYTHONDONTWRITEBYTECODE=1 venv-backend/bin/python -m pytest tests/ -v -p no:cacheprovider` (`main-copy/backend`) — זהה ל-`ci.yml` job `backend` (שם: `python -m pytest tests/ -v`; ה-CI לא מגדיר env vars ל-job הזה) | **0** | **137 passed, 0 failed, 0 skipped**, 1 warning (`StarletteDeprecationWarning` על httpx ב-TestClient) | 0.91s (pytest), ~2s wall |
| 3 | frontend — התקנה | `npm ci` (`main-copy/frontend`) | 0 | הותקן. npm audit מדווח 22 vulnerabilities (11 moderate, 11 high) — קיים מראש, אינפורמטיבי בלבד | 32s |
| 4 | **frontend — lint** | `npm run lint` → `eslint .` | **0** | 0 problems | 3s |
| 5 | **frontend — build** | `npm run build` → `tsc -b && vite build` | **0** | 159 modules; `dist/index.html` 0.61kB, `index-*.css` 29.81kB, `index-*.js` 359.84kB | 2s |
| 6 | smart-crm — התקנה | `npm ci` (`main-copy/smart-crm`) | 0 | הותקן. npm audit: 8 moderate — קיים מראש | 45s |
| 7 | smart-crm — קובץ i18n מחולל | `npm run i18n:index` + `diff -q` מול `smart-crm/src/i18n/messages.generated.ts` שבריפו (מקביל ל-`git diff --exit-code` ב-CI) | 0 | **זהה** | <1s |
| 8 | smart-crm — bundle של migrations | `npm run db:bundle` + `diff -q` מול `smart-crm/supabase/deploy/all-migrations.sql` | 0 | **זהה** | <1s |
| 9 | **smart-crm — typecheck** | `npm run typecheck` → `next typegen && tsc --noEmit` | **0** | עבר | 16s |
| 10 | **smart-crm — lint** | `npm run lint` → `eslint .` | **0** | 0 problems | 15s |
| 11 | **smart-crm — unit** | `CI=1 NEXT_TELEMETRY_DISABLED=1 npm run test:unit` → `vitest run --project unit` | **0** | **12 files, 164 passed, 0 failed** | 1.14s (vitest), 2s wall |
| 12 | smart-crm — build | `CI=1 NEXT_TELEMETRY_DISABLED=1 npm run build` → `next build` | 0 | Compiled successfully; 68/68 static pages | 32s |
| 13 | voice-agents — התקנה editable (כמו בבריף) | `uv venv -p python3.12 venv-va && uv pip install -e '.[dev]'` (`va-copy/voice-agents/engine`) | **1** | **נכשל — קיים מראש:** `setuptools ... Multiple top-level packages discovered in a flat-layout: ['app', 'agents']` (ל-`pyproject.toml` אין `[build-system]` ואין `packages`) | 6s |
| 14 | voice-agents — התקנה (עקיפה) | `uv pip install` של רשימת התלויות המוצמדות מ-`pyproject.toml` (`pipecat-ai[anthropic,elevenlabs,silero,websocket]==1.14.0`, `anthropic==1.17.0`, `fastapi==0.162.0`, `uvicorn==0.54.0`, `httpx==0.28.1`, `mcp==2.3.0`, `pydantic==2.14.1`, `pydantic-settings==2.16.1`, `loguru==0.7.3`, `pytest==9.2.0`, `pytest-asyncio==1.4.1`, `twilio==9.12.0`, `ruff`) | 0 | הותקן (בלי להתקין את הפרויקט עצמו; pytest רץ מתוך `engine/`) | 3s |
| 15 | **voice-agents — pytest** | `PYTHONDONTWRITEBYTECODE=1 venv-va/bin/python -m pytest -q -p no:cacheprovider` (`va-copy/voice-agents/engine`) | **0** | **60 passed, 0 failed, 0 skipped**, 2 warnings (`audioop` deprecated; `AudioContextTTSService` deprecated — שניהם מ-pipecat) | 4.96s (pytest), 7s wall |
| 16 | voice-agents — ruff | `venv-va/bin/ruff check . --no-cache` | 0 | All checks passed | <1s |

### לא הורץ (ולמה)

| CI step | מקור | סיבה |
|---|---|---|
| `rls` — migrations + `supabase/tests/test_rls.sql` על PostgreSQL 16 | `ci.yml` | דורש שרת Postgres. הבינאריים של PG16 קיימים במכונה (`/usr/lib/postgresql/16/bin`), אבל `initdb` כמשתמש `postgres` בתיקיית ה-scratch נכשל בגלל הגבלות ה-sandbox (`PANIC: could not open file ".../global/pg_control": Permission denied`), ו-docker daemon לא רץ (`/var/run/docker.sock` לא קיים). לא הורץ כדי לא לעקוף את ה-sandbox. |
| `test:integration` (28 קבצים) | `smart-crm.yml` | דורש Postgres (`TEST_DATABASE_URL`) — אותה סיבה. |
| Schema drift (`npx tsx scripts/db.ts reset && npm run db:check`) | `smart-crm.yml` | דורש Postgres — אותה סיבה. |
| `test:e2e` (Playwright, 13 specs) | `smart-crm.yml` | דורש Postgres (`E2E_DATABASE_URL`) והתקנת Chromium עם `--with-deps`. |

**המלצה:** את ארבעת השלבים האלה ה-CI של GitHub מריץ אוטומטית על כל PR — `ci.yml` על כל push, ו-`smart-crm.yml` רק אם `smart-crm/**` השתנה. בסיס ה"ירוק" שלהם ייקבע מריצת ה-CI הראשונה על PR של הגשר. ב-PR שלא נוגע ב-`smart-crm/**`, ה-workflow של smart-crm פשוט לא ירוץ, וזה בדיוק המצב הרצוי.

## 3. כשלים קיימים מראש (לא שלנו לתקן — תיעוד בלבד)

1. **voice-agents (עותק בענף):** `pip install -e engine[dev]` נכשל (flat-layout עם `app/` ו-`agents/`). הבדיקות עצמן עוברות כשמתקינים את התלויות ישירות.
2. **אזהרות deprecation:** backend (`httpx` ב-`starlette.testclient`), voice-agents (`audioop`, `AudioContextTTSService`). לא כשלים.
3. **npm audit:** frontend — 22 (11 moderate, 11 high); smart-crm — 8 moderate. קיים מראש, לא חוסם את CI.
4. **אי-שחזוריות של backend:** `backend/requirements.txt` לא מוצמד (`fastapi`, `pydantic`, `supabase` וכו' בלי גרסאות). בהרצה הזו נפתרו `fastapi 0.163.1`, `httpx 0.28.1`, `pytest 9.2.0`, `supabase 2.34.1`. ריצת CI עתידית עלולה להיכשל בגלל שדרוג upstream, בלי קשר לגשר. **חשוב לפרש נכון:** כשל כזה בעתיד אינו רגרסיה שלנו, כל עוד ה-diff מחוץ לתיקיות הגשר ריק.
5. **פער כיסוי ב-`ci.yml` job `rls`:** מריץ רק 3 מתוך 6 ה-migrations של `supabase/migrations/`.

## 4. הוכחת אי-נגיעה בקבצים קיימים

נאסף בסוף הסקר (מתוך `/home/user/ai-assistant`):

```text
$ git rev-parse HEAD
3eebc89669e5a2ec2c9169340df5b4b456d35cba
$ git rev-parse main
c4ce0d7a78c25982f69099d75093d60efa46fbff
$ git log --oneline main..HEAD
3eebc89 NOA Personal Bridge: מסמכי ניהול, CI נפרד ותלויות
ea9b559 NOA Personal Bridge: שלד פרויקט וחוזים (Phase 0-1)

$ git diff --stat main -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge'
 .github/workflows/noa-personal-bridge.yml | 72 +++++++++++++++++++++++++++++++
 1 file changed, 72 insertions(+)

$ git diff --name-status main HEAD -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge'
A	.github/workflows/noa-personal-bridge.yml

$ git diff --stat main -- .github/workflows/ci.yml .github/workflows/smart-crm.yml
(ריק)

$ git status --porcelain -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge'
(ריק)
```

**פרשנות:** הקובץ היחיד מחוץ לתיקיות הגשר שנבדל מ-`main` הוא `.github/workflows/noa-personal-bridge.yml`, והוא קובץ **חדש** (`A`), לא שינוי. אף קובץ קיים לא שונה ולא נמחק. בתחילת הסקר (לפני `3eebc89`) אותה פקודת `git diff --stat` החזירה פלט ריק.

**בדיקת השוואה לכל שלב בהמשך (פקודת regression gate):**

```bash
git diff --name-status origin/main -- . \
  ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'
# צפוי: פלט ריק
```

## 5. איך לשחזר את הבסיס

```bash
S=<scratch dir>
git archive main | tar -x -C $S/main-copy
# backend
cd $S/main-copy/backend && python3.11 -m venv $S/venv-backend \
  && $S/venv-backend/bin/pip install -r requirements-dev.txt \
  && $S/venv-backend/bin/python -m pytest tests/ -v            # צפוי: 137 passed
# frontend
cd $S/main-copy/frontend && npm ci && npm run lint && npm run build
# smart-crm (offline subset)
cd $S/main-copy/smart-crm && npm ci && npm run i18n:index && npm run db:bundle \
  && npm run typecheck && npm run lint && npm run test:unit   # צפוי: 164 passed
# voice-agents (branch copy)
git archive origin/ccr-a60c5c0c-bohsof voice-agents | tar -x -C $S/va-copy
cd $S/va-copy/voice-agents/engine && uv venv -p python3.12 $S/venv-va \
  && VIRTUAL_ENV=$S/venv-va uv pip install <pinned deps from pyproject.toml + dev> \
  && $S/venv-va/bin/python -m pytest -q                         # צפוי: 60 passed
```

לוגים מלאים של ההרצה הזו (זמניים, מחוץ לריפו): `/tmp/claude-0/-home-user-ai-assistant/f010ffe6-2a24-5262-b041-5bf173e21a8a/scratchpad/logs/`.
