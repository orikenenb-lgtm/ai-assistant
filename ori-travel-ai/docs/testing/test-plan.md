# תוכנית בדיקות — Ori Travel AI

> מסמך QA (תפקיד 18). עברית; פקודות בבלוקי קוד (LTR). המסמך אומר **בכנות** מה נבדק, באיזו רמה, מה לא נבדק, ומה היו התוצאות בפועל.
> עדכון אחרון: 2026-11-12.

## 1. עקרונות

* **מערכת פרטית, ספקי DEMO בלבד.** כל הבדיקות רצות מול ספקי הדגמה דטרמיניסטיים. אין קריאות רשת לספקים אמיתיים, אין מודל AI, אין חיוב.
* **פירמידה:** הרבה בדיקות יחידה מהירות (API + web), שכבה צרה של E2E מול המערכת האמיתית (API שמגיש את ה-build של ה-web), ובדיקות תאימות PostgreSQL.
* **לא מתעלמים בשקט:** בדיקה שמסומנת `test.fail()` מתועדת עם מזהה באג (סעיף 9); בדיקה שמדולגת כוללת סיבה.
* **ללא סודות בבדיקות:** סיסמאות ה-E2E הן ערכי throw-away שמועברים במשתני סביבה.

## 2. רמות הבדיקה

| רמה | כלי | מה היא מכסה | היקף נוכחי | איפה |
|---|---|---|---|---|
| סטטית | ruff, `tsc -b`, ESLint (אפס אזהרות) | סגנון, טיפוסים; **גם `apps/web/e2e/**` עובר typecheck ו-lint** | — | CI: `api`, `web` |
| יחידה — API | pytest (SQLite בזיכרון/קובץ זמני) | מודלים, שירותים, נקודות קצה, הרשאות, הצפנה, מכונת מצבי הזמנה, ספקי DEMO, AI במצב fallback, אבטחה | `<<API>>` בדיקות | `apps/api/tests/test_*.py` |
| יחידה — web | Vitest + Testing Library (jsdom) | רכיבי UI, טפסים וולידציה, סכמות Zod, מצבי טעינה/שגיאה | `<<WEB>>` בדיקות | `apps/web/src/**/*.test.ts(x)` |
| E2E | Playwright 1.63.0 (Chromium), 2 פרויקטים: `desktop` 1440 ו-`mobile` 390 (Pixel 7) | מסעות משתמש אמיתיים בדפדפן מול ה-API האמיתי שמגיש את ה-build; נגישות בסיסית; כותרות אבטחה; תרחישי כשל | 15 קבצי spec, 61 בדיקות לכל פרויקט (122 בסך הכול) | `apps/web/e2e/*.spec.ts` |
| תאימות PostgreSQL | pytest מלא + `alembic upgrade/downgrade` מול PostgreSQL 16 | שהסכמה וה-SQL עובדים גם מחוץ ל-SQLite | רץ ידנית ע"י ה-Director (כל חבילת ה-API + round trip); ב-CI רק migrate + round trip | CI: `api-postgres` |
| אבטחה סטטית | pip-audit, bandit (medium+), npm audit (high+) | תלויות וקוד API | — | CI: `security` |

מה **ה-E2E מוסיף** על היחידה: בדיקת הרכבה אמיתית (cookie + CSRF + Origin, CSP בדפדפן, ניתוב SPA, ה-build הייצורי, העלאת קבצים/הורדות ICS/PDF, שני גדלי מסך). הוא **לא** מחליף בדיקות יחידה לפרטים.

## 3. פקודות

### 3.1 הכול בבת אחת

```bash
# Linux / macOS (מתיקיית ori-travel-ai)
scripts/test.sh                 # ruff + pytest + typecheck + lint + vitest + build
scripts/test.sh --e2e           # + Playwright מול DB זמני (פורט 8765)
scripts/test.sh --api-only
scripts/test.sh --web-only
```

```powershell
# Windows PowerShell (מתיקיית ori-travel-ai)
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1 -E2E
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1 -ApiOnly
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1 -WebOnly
```

> סקריפטי ה-PowerShell נכתבו בקפידה אך **לא הורצו** בסביבת הפיתוח (אין PowerShell בסביבה). ראו סעיף 7.

### 3.2 API בלבד

```bash
cd apps/api
.venv/bin/python -m ruff check .
.venv/bin/python -m pytest -p no:warnings -q
.venv/bin/python -m pytest tests/test_booking.py -p no:warnings -q     # קובץ בודד
```

```powershell
cd apps\api
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m pytest -p no:warnings -q
```

### 3.3 web בלבד

```bash
cd apps/web
npm run typecheck && npm run lint && npm test && npm run build
```

```powershell
cd apps\web
npm run typecheck; npm run lint; npm test; npm run build
```

### 3.4 PostgreSQL (תאימות)

```bash
# מסד ריק, לדוגמה מ-Docker:  docker run --rm -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export ORI_DATABASE_URL='postgresql+psycopg://postgres:postgres@localhost:5432/ori_travel_ci'
cd apps/api
.venv/bin/python -m app.cli migrate                  # upgrade head
.venv/bin/python -m alembic downgrade base           # round trip
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m pytest -p no:warnings -q         # כל החבילה מול PostgreSQL
```

```powershell
$env:ORI_DATABASE_URL = 'postgresql+psycopg://postgres:postgres@localhost:5432/ori_travel_ci'
cd apps\api
.\.venv\Scripts\python.exe -m app.cli migrate
.\.venv\Scripts\python.exe -m alembic downgrade base
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m pytest -p no:warnings -q
```

### 3.5 E2E ידנית (הדרך שבה רצו בפועל התוצאות שבמסמך)

התקנת דפדפן — פעם אחת (במכונה חדשה / ב-CI; **לא** בסביבת הבנייה של הענן, שם Chromium מותקן מראש):

```bash
cd apps/web && npx playwright install chromium
```

```bash
# 1. build של ה-web (ה-API מגיש את dist/)
cd apps/web && npm run build

# 2. DB זמני + בעלים + שרת (פורט 8061 לדוגמה)
cd ../api
mkdir -p /tmp/ori-qa && rm -f /tmp/ori-qa/qa.db
export ORI_DATABASE_URL=sqlite:////tmp/ori-qa/qa.db ORI_DATA_KEY=$(.venv/bin/python -m app.cli gen-key) ORI_SERVE_WEB=true
.venv/bin/python -m app.cli migrate
ORI_OWNER_PASSWORD='E2E-Owner-Pass-123' .venv/bin/python -m app.cli create-owner --email owner@e2e.local --name "בעלים" --password-env ORI_OWNER_PASSWORD
.venv/bin/python -m app.cli seed-demo        # אופציונלי: ה-specs לא תלויים בו (CI לא מריץ אותו)
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8061 &

# 3. Playwright
cd ../web
E2E_BASE_URL=http://127.0.0.1:8061 E2E_OWNER_EMAIL=owner@e2e.local E2E_OWNER_PASSWORD='E2E-Owner-Pass-123' npx playwright test --trace off
npx playwright test --project=desktop           # פרויקט אחד
npx playwright test e2e/booking.spec.ts         # קובץ אחד
npx playwright show-report                      # דוח HTML של הריצה האחרונה
```

```powershell
# Windows: אחרי build ושרת רצים כמו בדוגמה (או scripts\start.ps1) —
cd apps\web
$env:E2E_BASE_URL = 'http://127.0.0.1:8000'
$env:E2E_OWNER_EMAIL = 'you@example.com'
$env:E2E_OWNER_PASSWORD = '<הסיסמה של הבעלים>'
npx playwright test --trace off
```

משתני סביבה (ברירות המחדל תואמות ל-`scripts/test.sh`):

| משתנה | ברירת מחדל | הערה |
|---|---|---|
| `E2E_BASE_URL` | `http://127.0.0.1:5173` (Vite dev) | יש להצביע על ה-API שמגיש את ה-build |
| `E2E_OWNER_EMAIL` | `owner@e2e.test` | חייב להיות בעלים קיים |
| `E2E_OWNER_PASSWORD` | `E2e-Passw0rd-Local-1` | |

## 4. איך CI מריץ (`.github/workflows/ori-travel-ai.yml`)

| Job | מה רץ |
|---|---|
| `api` | `ruff check` → `pytest` → `migrate` על SQLite חדש |
| `api-postgres` | שירות `postgres:16` → `migrate` → round trip (`downgrade base` + `upgrade head`) |
| `web` | `npm ci` → typecheck → lint → vitest → build |
| `e2e` | (אחרי `api` ו-`web`) build + DB זמני + `create-owner` + `uvicorn` על 8765 + `playwright install --with-deps chromium` + `npm run e2e`; בכשל מעלה `playwright-report` ו-`test-results` ומדפיס את לוג ה-API. ב-CI יש `retries: 1`. **לא** מריץ `seed-demo` — ה-specs יוצרים את הנתונים שלהם. |
| `security` | pip-audit, bandit, npm audit |

## 5. מבנה ה-E2E

```
apps/web/e2e/
  env.ts           משתני סביבה + עזרי תאריכים (תמיד עתידיים, מחושבים בזמן ריצה)
  api.ts           לקוח API עם CSRF (עוגיית ori_csrf -> כותרת X-CSRF-Token)
  fixtures.ts      התחברות פעם אחת ל-worker דרך ה-API ושמירת storage state (e2e/.auth/, מתעלמים ב-git);
                   fixture בשם api; anon לבדיקות ללא סשן; freshOwnerContext לסשן בעלים חדש
  data.ts          יצירת חיפושים דרך ה-API; sharedFlightSearch (חיפוש משותף אחד כדי לחסוך במכסת החיפושים)
  search-common.ts / wording.ts   אימותים משותפים
  *.spec.ts        ראו טבלה
```

| קובץ | מה נבדק |
|---|---|
| `auth.spec` | ולידציה, סיסמה שגויה (הודעה בעברית), כניסה/יציאה, קישור עמוק -> login -> חזרה, אין הרשמה ציבורית (ממשק + API) |
| `search-flights / hotels / cars / activities.spec` | ולידציה (תאריך עבר, חזרה לפני יציאה...), תוצאות, פס ספקים (תקין / לא מחובר), תג DEMO בכל כרטיס, הערת כיסוי, `?search_id=` שורד רענון, דירוג מחדש (משקלים), פרטי הצעה |
| `compare.spec` | בחירת הצעות, טבלת השוואה עם שורות ציון, ניקוי |
| `trip.spec` | יצירת טיול, הוספת הצעה, ציר זמן (DEMO + עלות), תקציב, ICS ו-PDF (סוג תוכן + חתימה), 401 ללא סשן |
| `saved-alerts.spec` | שמירת הצעה, התראת מחיר מחיפוש, בדיקה ידנית, היסטוריה, הודעת cooldown בעברית |
| `family.spec` | בן משפחה, פרופיל נוסע, הסתרת דרכון, חשיפה עם אימות סיסמה, הזמנה, קבלה בהקשר דפדפן חדש כצופה, ממשק לקריאה בלבד, **403 בשרת** לפעולות משנות, קישור הזמנה חד-פעמי |
| `booking.spec` | מסלול סימולציה מלא עד CONFIRMED (`SIM-`), `timeout_unknown` -> UNKNOWN -> reconcile, `price_change` -> אישור מחדש, סיסמה שגויה, ללא ניסוח של "רכישה אמיתית", באנר סימולציה |
| `failures.spec` | כשל ספק חלקי / מלא (`simulate_error`), התאוששות הספקים, הצעה שפג תוקפה (`expired`), כשל ספק בהזמנה (`supplier_failure`) |
| `assistant.spec` | באנר מצב בסיסי, בקשת טיסה בעברית, XSS כטקסט, שאלת הבהרה, תכנון טיול |
| `providers-settings.spec` | ספקי DEMO תקינים / ספקים אמיתיים "לא מחובר", משקלות = 100, שינוי סיסמה (ולידציה בלבד — הסיסמה לא משתנה) |
| `a11y-smoke.spec` | h1 יחיד, `dir=rtl lang=he`, שמות לכפתורים, תוויות לשדות, אין גלישה אופקית ב-390px, מקלדת (skip link, ניווט, מלכודת פוקוס בדיאלוג) |
| `security-headers.spec` | CSP, X-Frame-Options, nosniff, מעטפת שגיאות עברית, Origin זר נדחה, CSRF, CORS, עוגיית סשן HttpOnly |

### 5.1 מגבלות קצב שמעצבות את ה-E2E

| מגבלה | ערך | השלכה |
|---|---|---|
| כניסה | 20/5 דק' ל-IP, 10/5 דק' לאימייל, נעילה אחרי 5 כשלונות | התחברות אחת לכל worker דרך ה-API; ריצה מלאה משתמשת ב-~9 כניסות של הבעלים. **ריצה שנייה תוך 5 דקות עלולה להיחסם (429): הפעילו מחדש את ה-API או המתינו** |
| חיפוש | 30/10 דק' למשתמש | ~8-10 חיפושים לכל פרויקט (חיפוש משותף אחד לבדיקות שרק צריכות הצעות) |
| אימות סיסמה חוזר | 5 כשלונות / 5 דק' (רק כשלונות נספרים) | 1-2 כשלונות מכוונים לכל פרויקט |
| שינוי סיסמה | 5/5 דק' | ניסיון אחד לכל פרויקט (סיסמה נוכחית שגויה — הסיסמה לא משתנה) |
| בדיקת התראה ידנית | פעם ב-5 דק' | נבדק במכוון (הודעת cooldown) |

מגבלות אלה בזיכרון התהליך — הפעלה מחדש של ה-API מאפסת אותן.

## 6. מטריצת תרחישי כשל

| תרחיש | איך מדמים | איפה נבדק | התנהגות נדרשת |
|---|---|---|---|
| ספק לא מגיב / נכשל | הגדרת ספק DEMO `simulate_error=true` (`PUT /api/providers/{id}`) | יחידה: `test_providers.py::test_simulated_error_setting_produces_partial_search`, `test_search.py::test_partial_failure_*`. E2E: `failures.spec` | חיפוש `partial`, באנר "חלק מהספקים לא ענו", שאר הספקים מוצגים, הספק התקול `DEGRADED` |
| כל הספקים נכשלו / לא מחוברים | כל ספקי הקטגוריה במצב שגיאה | יחידה: `test_all_providers_unavailable_gives_failed`. E2E: `failures.spec` | `failed`, הודעת "לא החזיר תוצאות מאף ספק", אין תוצאות מומצאות |
| ספק אמיתי ללא מפתחות | ברירת מחדל | E2E: `providers-settings`, חיפושים | "לא מחובר" (לא תקלה), לא משתתף בחיפוש, מופיע בפס הספקים |
| תוצאות חלקיות / כיסוי לא מלא | ספק אחד בלבד עונה | E2E: חיפושים | הערת "כיסוי החיפוש" + "אין התחייבות לכיסוי מלא" |
| הצעה שפג תוקפה | תרחיש הזמנה `expired`; תוקף 30 דק' בהצעות DEMO | יחידה: `test_booking.py::test_create_rejects_expired_offer`, `test_expired_scenario_and_local_quote_expiry`. E2E: `failures.spec` | מצב EXPIRED, לא ניתן להמשיך, הודעה בעברית |
| שינוי מחיר | תרחיש `price_change` (+7%) | יחידה: `test_booking.py`. E2E: `booking.spec` | אישור מתבטל, "המחיר השתנה — האישור בוטל", שום דבר לא נשלח, נדרש אישור מחדש |
| הזמנה במצב UNKNOWN | תרחיש `timeout_unknown` | יחידה: `test_timeout_unknown_blocks_until_reconciled`. E2E: `booking.spec` | רק "בירור מול הספק" זמין; שליחה חוזרת = 409 `RECONCILE_REQUIRED`; אחרי בירור CONFIRMED עם `SIM-` |
| כשל ספק בהזמנה | תרחיש `supplier_failure` | יחידה: `test_supplier_failure_scenario`. E2E: `failures.spec` | מצב FAILED, ללא אסמכתה |
| סיסמה שגויה באישור / חשיפת דרכון | סיסמה שגויה בדיאלוג | E2E: `booking.spec`, `family.spec` | "הסיסמה שגויה", לא מאושר / לא נחשף |
| מגבלות קצב | חריגה (כניסה, חיפוש, צ'אט, בדיקת התראה) | יחידה: `test_auth.py`, `test_ai_chat.py`, `test_alerts.py`. E2E: cooldown של בדיקת התראה ב-`saved-alerts` בלבד (שאר המגבלות לא נבדקות ב-E2E כדי לא לנעול את הסביבה) | 429 + הודעה בעברית, בלי קריסה |
| מפתח הצפנה חסר | `ORI_DATA_KEY` לא מוגדר | יחידה: `test_travelers.py` (503 `ENCRYPTION_UNAVAILABLE`) | הודעה מפורשת בממשק; **לא נבדק ב-E2E** (השרת ב-E2E תמיד עם מפתח) |
| מודל AI לא זמין | ברירת מחדל `none`; Ollama כבוי | יחידה: `test_ai_llm.py`, `test_ai_chat.py::test_model_unavailable_mid_turn_falls_back`. E2E: `assistant.spec` (באנר "מצב בסיסי") | fallback דטרמיניסטי, חיפוש ידני ממשיך לעבוד |
| צופה מנסה פעולה משנה | משתמש `viewer` | יחידה: `test_security_hardening.py`, `test_auth.py`. E2E: `family.spec` | 403 + מעטפת שגיאה בעברית; הממשק מסתיר פעולות |
| CSRF / Origin זר | `Origin: https://evil.example`, בלי `X-CSRF-Token` | יחידה: `test_security_hardening.py`. E2E: `security-headers.spec` | 403 `ORIGIN_REJECTED` / שגיאת CSRF; שום דבר לא נוצר |
| XSS בהודעת צ'אט | `<img src=x onerror=alert(1)>` | E2E: `assistant.spec` | מוצג כטקסט; אין אלמנט `img`, אין dialog |
| סשן פג / נותק | יציאה | E2E: `auth.spec` | הפניה ל-login; קישור עמוק חוזר ליעד אחרי כניסה |

## 7. נגישות (בדיקות עשן — לא ביקורת WCAG מלאה)

האוטומציה (ללא axe — לא מותקן; מומשה ב-Playwright API):

* בדיקה בכל מסך מרכזי (login, לוח בקרה, חיפוש + תוצאות, טיול, סקירת הזמנה, עוזר, משפחה, ספקים, הגדרות): `<h1>` אחד בדיוק; `html[dir=rtl][lang=he]`; כותרת מסמך; לכל כפתור/קישור/מתג/לשונית שם נגיש; לכל שדה טופס תווית.
* אין גלישה אופקית ב-390px (`scrollWidth <= clientWidth`).
* מקלדת: קישור "דילוג לתוכן הראשי" מופיע ראשון ומעביר פוקוס ל-`main`; Tab מגיע לניווט הראשי (בנייד — לכפתור התפריט); מלכודת פוקוס בדיאלוג; Escape סוגר; החזרת פוקוס למפעיל.

ידני (מומלץ לפני הפצה, לא אוטומטי): קורא מסך (NVDA/VoiceOver) על מסלול הזמנה, ניגודיות צבעים, הגדלת טקסט 200%, מצב תנועה מופחתת, הדפסת PDF של טיול.

## 8. תוצאות אחרונות (2026-11-12)

> סביבה: Linux (sandbox), Python 3.12, Node 22, Playwright 1.63.0 / Chromium מותקן מראש, SQLite, ה-API שמגיש את `apps/web/dist` (build טרי), ספקי DEMO, `ORI_ENV=development`.
> שתי ריצות מלאות רצופות על DB חדש: אחת **ללא** `seed-demo` (כמו ב-CI) ואחת **עם** `seed-demo`. התוצאות זהות; לא נצפתה אי-יציבות (flakiness).

| בדיקות | תוצאה |
|---|---|
| API pytest | `<<API>>` |
| web Vitest | `<<WEB>>` |
| web `typecheck` + `lint` (כולל `e2e/**`) | עברו, אפס אזהרות |
| `alembic check` (מודלים מול migration) | "No new upgrade operations detected" |
| PostgreSQL 16 (ה-Director: כל חבילת ה-API + migration round trip) | עבר (דווח ע"י ה-Director; לא הורץ מחדש ע"י QA) |
| E2E — **desktop** (1440) | 61 בדיקות: **59 עברו**, 1 "כשל צפוי" (`test.fail` — BUG-QA-01, מתנהג כצפוי), 1 דולגה בכוונה (BUG-QA-02 מתרחש רק בפרויקט mobile), 0 נכשלו |
| E2E — **mobile** (390, Pixel 7) | 61 בדיקות: **59 עברו**, 2 "כשלים צפויים" (`test.fail` — BUG-QA-01 ו-BUG-QA-02), 0 דולגו, 0 נכשלו |
| E2E — סיכום | 122 בדיקות: 121 "עברו" (מתוכן 4 כשלים צפויים), 1 דולגה, 0 נכשלו. זמן: ~3.0-3.6 דקות (worker יחיד) |

הערות על הריצות:

* בדיקות עם `test.fail()` מדווחות כ"עברו" כל עוד הבאג קיים. **ברגע שהבאג יתוקן הבדיקה תיכשל עם "expected to fail but passed"** — אז מסירים את `test.fail`/`test.skip` בבדיקה (מסומנות בהערה עם מזהה הבאג).
* ריצה חוזרת ברצף על אותו שרת עלולה להיחסם בגלל מגבלות קצב (ראו 5.1): הפעילו מחדש את ה-API בין ריצות מלאות.
* במהלך הפיתוח נתגלה סיכון תהליכי: ה-migration וה-מודלים שונו בזמן שעבדתי, ו-DB שנוצר מגרסה קודמת של ה-migration החזיר 500 (`no such column: traveler_profiles.gender_enc`). המצב הנוכחי תקין (`alembic check`), אבל מומלץ להוסיף את `alembic check` ל-CI כדי שסטייה כזו תיתפס אוטומטית.

## 9. ממצאים פתוחים (באגים שה-E2E גילה)

| מזהה | חומרה | תחום | תיאור | חשוד ב- | כיסוי בבדיקה |
|---|---|---|---|---|---|
| BUG-QA-01 | בינונית | נגישות (מקלדת / קורא מסך) | אחרי סגירת דיאלוג שנפתח מכפתור רגיל עם `open` נשלט (יצירת טיול, בן משפחה, הזמנה, הכנת הזמנה...) הפוקוס נופל ל-`<body>` במקום לחזור לכפתור שפתח אותו. דיאלוגים עם `trigger` מובנה (הוספה לטיול) תקינים. הצעד: פוקוס על "טיול חדש" -> Enter -> Escape -> `document.activeElement` = BODY. צפוי: הפוקוס על הכפתור (WCAG 2.4.3) | `src/components/ui/Dialog.tsx` (הערת התיעוד מבטיחה החזרת פוקוס; חסר `onCloseAutoFocus`/שמירת המפעיל בדיאלוגים נשלטים), `TripFormDialog`, `MemberFormDialog`, `InvitationsSection`, `StartBookingDialog` | `a11y-smoke.spec` — `test.fail`, desktop + mobile |
| BUG-QA-02 | בינונית | פריסה (נייד) | בלוח הבקרה, כשיש לפחות חיפוש אחד אחרון, הדף רחב מ-390px (scrollWidth 409 > 390) ולכן כל המעטפת כולל סרגל הלשוניות התחתון גולשת לצדדים. הסיבה: הכרטיסים בתוך `grid gap-6 lg:grid-cols-2` (טראק auto) ושורת חיפוש עם `truncate`/nowrap מרחיבה את ה-min-content של הטראק. תיקון: `grid-cols-[minmax(0,1fr)]` או `min-w-0` על ילדי ה-grid | `apps/web/src/pages/dashboard/DashboardPage.tsx:47` | `a11y-smoke.spec` — `test.fail`, פרויקט mobile |
| BUG-QA-03 | נמוכה | i18n | ערכי enum באנגלית בתוך משפטים בעברית: שורת התנאים "מחלקה: economy, תעריף: לייט" (`terms_summary`); "סטטוס: CONFIRMED" בכרטיס אישור ההזמנה; "718.70 ILS (₪)" בהודעת שינוי מחיר | `apps/api/app/modules/booking/terms.py` (שורת המחלקה ב-`summary`, ו-`format_money` שמחזיר "ILS (₪)"), `apps/web/src/features/bookings/components/OutcomePanels.tsx:68` (שדה "סטטוס" מציג את ה-enum הגולמי) | לא מכוסה (גלוי בצילום מסך) |
| BUG-QA-04 | נמוכה | ניסוח / שקיפות | מצב ריק של העוזר: "...ויציג הצעות **אמיתיות** מהתוצאות" — בעוד שכל ההצעות הן DEMO. מטעה ביחס למדיניות "אין הצעות אמיתיות" | `apps/web/src/features/assistant/components/ChatPanel.tsx:103` | לא מכוסה |
| BUG-QA-05 | נמוכה | UX | סיסמה שגויה באישור הזמנה: ההתראה מציגה את "הסיסמה שגויה" פעמיים (כותרת + גוף זהים) | `features/bookings/components/ApprovalPanel.tsx` / `useFeedback.ts` | לא מכוסה |
| BUG-QA-06 | נמוכה | ניסוח | פרטי מלון: "אורחים: 1 חדרים · 2 מבוגרים" (ריבוי/יחיד) | `apps/web/src/features/offers/components/OfferDetailDialog.tsx:92` | לא מכוסה |
| BUG-QA-07 | נמוכה | תיעוד | `docs/security/booking-safety.md` §4.5 קובע שגם ניסיונות אימות מוצלחים נספרים; הקוד (`check_password_for_step_up`) סופר רק כשלונות. התיעוד מיושן | `docs/security/booking-safety.md` | — |
| BUG-QA-08 | נמוכה | API | (א) 404 על נתיב `/api/...` לא קיים מחזיר `request_id: null` במעטפת השגיאה; (ב) שגיאת JSON שבור מחזירה `field: "9"` (אינדקס תו) במקום שם שדה | `apps/api/app/main.py:100` (מטפל 404 עם `request_id: None`), מטפל RequestValidationError | `security-headers.spec` בודק מבנה, לא ערכים |

אין ממצאים בחומרה גבוהה. לא נמצאו פגמי אבטחה בבדיקות שבוצעו: CSP, X-Frame-Options, nosniff, Origin זר, CSRF, HttpOnly, הרשאות viewer (403 בשרת), הסתרת דרכון, XSS בצ'אט, וקישור הזמנה חד-פעמי — כולם התנהגו כנדרש.

תצפיות (לא באגים):

* תוצאות חיפוש זהות מוגשות ממטמון שרת (30 דק'); לכן כשל ספק שהופעל אחרי חיפוש זהה "לא נראה" עד שהמטמון פג. ההודעה "התוצאות מוצגות ממטמון" מוצגת למשתמש. הבדיקות משתמשות בפרמטרים ייחודיים כדי לעקוף זאת.
* נתיב לא קיים ללא סיומת/עם סיומת תמונה (`/nonexistent.png`) מחזיר 200 עם `index.html` (fallback של SPA); `/assets/missing.js` מחזיר 404.
* `/api/docs` ו-`/api/openapi.json` פתוחים כשה-`ORI_ENV` אינו `production` (בכוונה; בייצור כבויים בקוד). לא נבדק ב-E2E.
* סטטוס ספק נשאר `DEGRADED` עד שמתבצעת ריצת חיפוש מוצלחת הבאה (גם אחרי בדיקת תקינות מוצלחת) — מתועד בקוד (`compute_status`).


## 10. מה לא מכוסה (בכנות)

* **ספקים חיים אמיתיים** (Duffel, Booking, Expedia, Viator, Amadeus...): אין מפתחות, אין רשת. מתאמי LIVE נבדקים ביחידה מול תשובות מוקלטות/מדומות בלבד (`test_live_*.py`). לא ידוע איך הם יתנהגו מול ה-API האמיתי (שינויי סכמה, מגבלות קצב, עלויות).
* **מודל LLM אמיתי** (Ollama / ענן): ה-E2E רץ במצב fallback בלבד; התנהגות מודל, גרעין ה-grounding מול טקסט חופשי של מודל וכלי-קריאה נבדקים ביחידה עם לקוח מדומה.
* **ביצוע הזמנה אמיתי**: כבוי בקוד; נבדק שהוא נדחה, לא שהוא עובד.
* **PowerShell**: `*.ps1` לא הורצו בסביבת הפיתוח. מומלץ הרצת `setup.ps1` / `start.ps1` / `test.ps1 -E2E` על Windows אמיתי לפני מסירה.
* **דפדפנים**: Chromium בלבד. Safari/WebKit ו-Firefox לא נבדקו (בדיקות RTL, `input[type=date]`, חיתוך טקסט עלולות להיות שונות). אין בדיקה במכשיר נייד פיזי — "mobile" הוא אמולציה של Pixel 7 ב-Chromium.
* **עומס וביצועים**: אין בדיקות עומס; מגבלות הקצב בזיכרון התהליך (תהליך יחיד).
* **PostgreSQL ב-E2E**: ה-E2E רץ על SQLite בלבד.
* **גיבוי/שחזור, scheduler ברקע (`ORI_SCHEDULER_ALLOWED`), מפת OpenStreetMap**: לא נבדקים ב-E2E.
* **נגישות מלאה**: ללא axe/Lighthouse, ללא קורא מסך, ללא ניגודיות אוטומטית.
* **אבטחה**: אין pentest. מתקני CSP נבדקים אך לא מול Reverse proxy / HTTPS (`ORI_COOKIE_SECURE`, HSTS בייצור לא נבדקו).
* **`seed-demo` מול מסד עם נתונים אמיתיים**, העלאת גרסאות (migration על DB עם נתונים) — לא נבדקו.

## 11. תחזוקה

* **כל בדיקה שנכשלת מקבלת בדיקה לפני תיקון.** בדיקות `test.fail()` ב-E2E מסמנות באג ידוע; כשהבאג מתוקן הבדיקה תדווח "expected to fail but passed" — יש להסיר אז את `test.fail`.
* בכל שינוי ב-UI שמשנה טקסט עברי: הבדיקות משתמשות בטקסטים ובתפקידי ARIA (לא ב-CSS); `data-testid` קיימים רק במקומות שבהם התפקיד אינו מספיק.
* איפוס ריצה: הפעלה מחדש של ה-API (מאפס מגבלות קצב) ומחיקת `apps/web/e2e/.auth/` אם הסיסמה/DB הוחלפו.
