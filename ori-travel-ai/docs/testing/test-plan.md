# תוכנית בדיקות — Ori Travel AI

> מסמך QA (תפקיד 18). עברית; פקודות בבלוקי קוד (LTR). המסמך אומר **בכנות** מה נבדק, באיזו רמה, מה לא נבדק, ומה היו התוצאות בפועל.
> עדכון אחרון: 2026-11-12 (סבב V6: עיצוב חדש, חוויית טיסות, חפיפות בטיולים, מעבר לספק DEMO — 20 תרחישי חובה, סעיף 12).

## 1. עקרונות

* **מערכת פרטית, ספקי DEMO בלבד.** כל הבדיקות רצות מול ספקי הדגמה דטרמיניסטיים. אין קריאות רשת לספקים אמיתיים, אין מודל AI, אין חיוב.
* **פירמידה:** הרבה בדיקות יחידה מהירות (API + web), שכבה צרה של E2E מול המערכת האמיתית (API שמגיש את ה-build של ה-web), ובדיקות תאימות PostgreSQL.
* **לא מתעלמים בשקט:** בדיקה שמסומנת `test.fail()` מתועדת עם מזהה באג (סעיף 9); בדיקה שמדולגת כוללת סיבה.
* **ללא סודות בבדיקות:** סיסמאות ה-E2E הן ערכי throw-away שמועברים במשתני סביבה.

## 2. רמות הבדיקה

| רמה | כלי | מה היא מכסה | היקף נוכחי | איפה |
|---|---|---|---|---|
| סטטית | ruff, `tsc -b`, ESLint (אפס אזהרות) | סגנון, טיפוסים; **גם `apps/web/e2e/**` עובר typecheck ו-lint** | — | CI: `api`, `web` |
| יחידה — API | pytest (SQLite בזיכרון/קובץ זמני) | מודלים, שירותים, נקודות קצה, הרשאות, הצפנה, מכונת מצבי הזמנה, ספקי DEMO, AI במצב fallback, אבטחה | **890** בדיקות (SQLite ו-PostgreSQL 16, 2026-11-12) | `apps/api/tests/test_*.py` |
| יחידה — web | Vitest + Testing Library (jsdom) | רכיבי UI, טפסים וולידציה, סכמות Zod, מצבי טעינה/שגיאה | **254** בדיקות (42 קבצים, 2026-11-12) | `apps/web/src/**/*.test.ts(x)` |
| E2E | Playwright 1.63.0 (Chromium), 2 פרויקטים: `desktop` 1440 ו-`mobile` 390 (Pixel 7) | מסעות משתמש אמיתיים בדפדפן מול ה-API האמיתי שמגיש את ה-build; נגישות בסיסית; כותרות אבטחה; תרחישי כשל; **20 תרחישי V6** (סעיף 12) | 21 קבצי spec, 85 בדיקות לכל פרויקט (170 בסך הכול; 61 ישנות + 24 של V6) | `apps/web/e2e/*.spec.ts` (פונקציונלי). בדיקות ויזואליות: `apps/web/e2e/visual/**` (סוכן VIS-A11Y, לא רצות כברירת מחדל) |
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
npm run e2e                                     # רק הבדיקות הפונקציונליות (e2e/visual מוחרג)
npm run e2e -- e2e/visual                       # רק הבדיקות הוויזואליות (או E2E_VISUAL=1)
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
  a11y.ts          בדיקות נגישות משותפות (שמות נגישים, גלישה אופקית, מזהים כפולים, יחס ניגודיות מחושב בדפדפן)
  dom.d.ts         הפניה ל-lib "dom" כדי ש-page.evaluate עם פונקציות יעבור typecheck תחת tsconfig.node
  fixtures-v6.ts   משתמש "מבוגר" שני (נוצר דרך API ההזמנות של הבעלים) — מכסת חיפוש נפרדת; ownerApi; scratchApi (משתמש שלישי לסריקות כבדות)
  v6-helpers.ts    עזרי V6 (חיפוש טיסות ב-API, סכומים מ-data-amount, מסננים, תוויות LIVE)
  visual/**        בדיקות ויזואליות של VIS-A11Y (מחוץ לריצה הפונקציונלית)
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
| `v6-flights.spec` | V6-01..06 ו-V6-20: דשבורד ← רומא, לוח מחירים (DEMO, מקרא, תאים ריקים), בחירת תאריך, מסננים, כרטיס מומלץ מול הטבלה, כשל ספק, תוויות מקור |
| `v6-categories.spec` | V6-07..09: מלונות (תפוסה + ביטול), רכבים (גיל נהג, פיקדון, דלק, ביטוחים), אטרקציות (משתתפים + תאריכים) |
| `v6-assistant-trip.spec` | V6-10, V6-10b (באג ידוע), V6-11: עוזר AI במצב בסיסי, בונה טיולים: תקציב וחפיפות |
| `v6-family-booking.spec` | V6-12..15: תפקיד צופה, שינוי מחיר, UNKNOWN + אידמפוטנטיות, מעבר לספק DEMO |
| `v6-responsive-a11y.spec` | V6-16, V6-17a..d: מובייל + מגע, מקלדת בלוח, h1/תוויות/תנועה מופחתת, מצב כהה וניגודיות |
| `v6-platform.spec` | V6-18 (Host/Origin), V6-19 (הפעלה נקייה: DB חדש + CLI + התחברות) |

### 5.1 מגבלות קצב שמעצבות את ה-E2E

| מגבלה | ערך | השלכה |
|---|---|---|
| כניסה | 20/5 דק' ל-IP, 10/5 דק' לאימייל, נעילה אחרי 5 כשלונות | התחברות אחת לכל worker דרך ה-API; ריצה מלאה משתמשת ב-~9 כניסות של הבעלים. **ריצה שנייה תוך 5 דקות עלולה להיחסם (429): הפעילו מחדש את ה-API או המתינו** |
| חיפוש | 30/10 דק' למשתמש | ~8-10 חיפושים לכל פרויקט (חיפוש משותף אחד לבדיקות שרק צריכות הצעות) |
| אימות סיסמה חוזר | 5 כשלונות / 5 דק' (רק כשלונות נספרים) | 1-2 כשלונות מכוונים לכל פרויקט |
| שינוי סיסמה | 5/5 דק' | ניסיון אחד לכל פרויקט (סיסמה נוכחית שגויה — הסיסמה לא משתנה) |
| בדיקת התראה ידנית | פעם ב-5 דק' | נבדק במכוון (הודעת cooldown) |
| **לוח מחירים** (`POST /api/search/flight/calendar`) | **10/10 דק' למשתמש**, והממשק קורא לו אוטומטית בכל עמוד תוצאות טיסה | ה-fixture `calendar` (ב-`fixtures.ts`) חוסם את הנקודה עם 404 מדומה (הממשק מציג "הלוח עדיין לא זמין") בכל בדיקה שלא עוסקת בלוח; בדיקות הלוח משתמשות ב-`calendar: 'real'` עם מטמון לפי גוף הבקשה (ריצה מלאה ≈ 6 קריאות אמיתיות לפרויקט) |
| חיפוש — משתמשי V6 | 30/10 דק' **לכל משתמש** | בדיקות V6 רצות כמבוגר שני (`fixtures-v6.ts`), וסריקת BUG-E2E-01 כמבוגר שלישי — כך המכסה של הבעלים נשארת לבדיקות הישנות |
| צ'אט AI | 20/10 דק' למשתמש | V6-10 משתמש ב-2, סריקת V6-10b עד 18 (משתמש נפרד) |

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

## 8. תוצאות אחרונות (2026-11-12, סבב V6)

> סביבה: Linux (sandbox), Node 22, Playwright 1.63.0 / Chromium מותקן מראש, SQLite, ה-API שמגיש את `apps/web/dist` (build טרי אחרי עיצוב V6), ספקי DEMO, `ORI_ENV=development`. כל ריצה על DB חדש, שרת שהופעל מחדש (מגבלות הקצב בזיכרון), פרויקט אחד בכל ריצה (`workers: 1`).
> תוצאות ה-API, Vitest ו-PostgreSQL עודכנו ע״י המנהל בטבלה שבסעיף 2 ובסעיף 8א.

| בדיקות | תוצאה |
|---|---|
| `tsc -b` + ESLint על `e2e/**` ו-`playwright.config.ts` | עברו (אזהרה אחת בקובץ של VIS-A11Y: `e2e/visual/helpers.ts` — `console.log`) |
| E2E — **desktop** (1440) | 85 בדיקות: **84 עברו** (מתוכן 2 "כשלים צפויים" — BUG-E2E-01, BUG-E2E-02), 1 דולגה בכוונה (BUG-QA-02 הוא תרחיש של פרויקט mobile בלבד), 0 נכשלו. 2.6 דק' |
| E2E — **mobile** (390, Pixel 7) | 85 בדיקות: **84 עברו** (מתוכן אותם 2 כשלים צפויים), 1 דולגה בכוונה (V6-19 — בדיקת סביבה שרצה פעם אחת, ב-desktop), 0 נכשלו. 2.9 דק' |
| יציבות | 3 ריצות מלאות רצופות לכל פרויקט (על DB חדש כל פעם) ללא כשל, אחרי התיקונים שבהמשך. בדרך נמצאו וטופלו: (א) `providers-settings` — קריאת סכום משקלות ללא המתנה (תיקון: `expect.poll`); (ב) V6-10b — בדיקה תלוית-נתונים שצרכה את מכסת החיפוש של המשתמש המשותף וגרמה ל-429 בבדיקות שאחריה (תיקון: משתמש נפרד + `test.skip` אם לא נמצא מקרה); (ג) הרחבת `hover` במובייל (אין hover — מדלגים עליו) |
| BUG-QA-01 (פוקוס חוזר מדיאלוגים נשלטים) | **תוקן** — הוסר `test.fail`; הבדיקה עוברת בשני הפרויקטים |
| BUG-QA-02 (גלישה אופקית בדשבורד ב-390px) | **תוקן** — הוסר `test.fail`; הבדיקה עוברת בפרויקט mobile |

הערות:

* "כשל צפוי" (`test.fail`) מדווח כ"עבר". כשהבאג יתוקן הבדיקה תדווח "expected to fail but passed" — יש להסיר אז את `test.fail`.
* חובה להפעיל מחדש את ה-API בין ריצות מלאות (מגבלות קצב בזיכרון התהליך). `scripts` של ה-E2E כבר עושים זאת.
* **לא נבדק ב-Windows**: הרצת `setup.ps1` / `start.ps1` (ראו V6-19 ובסעיף 10).

## 8א. אימות סופי של המנהל (עץ העבודה הסופי, 2026-11-12)

הבדיקות רצו ברצף, וכל שלב קיבל DB נקי ושרת משלו. הלוגים המלאים נשמרו ב-scratchpad של הסשן.

| שלב | פקודה (מקוצרת) | תוצאה |
|---|---|---|
| API: ruff | `ruff check app tests alembic` | ✅ All checks passed |
| API: bandit | `bandit -r app -ll -q` | ✅ 0 ממצאים ברמה בינונית ומעלה |
| API: pip-audit | `pip_audit -r requirements.txt` | ✅ No known vulnerabilities |
| API: migrations | `app.cli migrate` + `alembic check` | ✅ No new upgrade operations |
| API: pytest על SQLite | `pytest tests -o addopts= -q` | ✅ **890 passed** (2:45) |
| API: pytest על PostgreSQL 16 | `ORI_TEST_DATABASE_URL=postgresql+psycopg://…` | ✅ **890 passed** (5:18) |
| web | `typecheck`, `lint`, `vitest run`, `build` | ✅ 0 שגיאות, **254 passed**, build עבר |
| נגישות | `playwright test e2e/visual/a11y --project=desktop` | ✅ **148 passed** (בלי חריגים ידועים) |
| E2E, סבב 1 | desktop ו-mobile ברצף מול שרת אחד | ⚠️ 151 עברו, **17 נכשלו**, כולם במובייל ובגלל 429. מכסת החיפוש של המשתמש (30 בעשר דקות) נגמרה. **זו בעיית תשתית ולא באג במוצר** |
| תיקון | `ORI_SEARCH_RATE_LIMIT` ו-`ORI_CALENDAR_RATE_LIMIT` ניתנים להגדרה (ברירת מחדל 30 ו-10, ללא שינוי, ויש לכך בדיקה). בשרתי E2E זמניים ב-CI, `test.sh` ו-`test.ps1` המכסה מוגבהת | — |
| E2E, סבב 2 | desktop ו-mobile **בריצה אחת** מול שרת אחד, כמו ב-CI | ✅ **168 passed, 2 skipped** בכוונה, 0 failed (4.9 דקות) |
| ויזואלי, סבב 1 | `visual.spec.ts` על DB נקי | ⚠️ 54/58: ה-baseline של dashboard נלכד ב-DB עם נתונים מצטברים (ההבדל בגובה) |
| ויזואלי: יצירה מחדש | `-g dashboard --update-snapshots` לפי הנוהל הקנוני (DB נקי, visual רץ ראשון) | ✅ 4 baselines של dashboard נוצרו מחדש |
| ויזואלי: אימות | ריצה מלאה על DB נקי נוסף | ✅ **58/58** |

**מה לא אומת:** הרצת PowerShell (אין `pwsh`), ריצת GitHub Actions אמיתית, ספקים חיים, מודל LLM אמיתי, Safari ו-Firefox.

## 9. ממצאים פתוחים (באגים שה-E2E גילה)

| מזהה | חומרה | תחום | תיאור | חשוד ב- | כיסוי בבדיקה |
|---|---|---|---|---|---|
| BUG-QA-01 (**תוקן ב-V6**) | בינונית | נגישות (מקלדת / קורא מסך) | אחרי סגירת דיאלוג שנפתח מכפתור רגיל עם `open` נשלט (יצירת טיול, בן משפחה, הזמנה, הכנת הזמנה...) הפוקוס נופל ל-`<body>` במקום לחזור לכפתור שפתח אותו. דיאלוגים עם `trigger` מובנה (הוספה לטיול) תקינים. הצעד: פוקוס על "טיול חדש" -> Enter -> Escape -> `document.activeElement` = BODY. צפוי: הפוקוס על הכפתור (WCAG 2.4.3) | `src/components/ui/Dialog.tsx` (הערת התיעוד מבטיחה החזרת פוקוס; חסר `onCloseAutoFocus`/שמירת המפעיל בדיאלוגים נשלטים), `TripFormDialog`, `MemberFormDialog`, `InvitationsSection`, `StartBookingDialog` | `a11y-smoke.spec` — עכשיו בדיקה רגילה (עוברת) |
| BUG-QA-02 (**תוקן ב-V6**) | בינונית | פריסה (נייד) | בלוח הבקרה, כשיש לפחות חיפוש אחד אחרון, הדף רחב מ-390px (scrollWidth 409 > 390) ולכן כל המעטפת כולל סרגל הלשוניות התחתון גולשת לצדדים. הסיבה: הכרטיסים בתוך `grid gap-6 lg:grid-cols-2` (טראק auto) ושורת חיפוש עם `truncate`/nowrap מרחיבה את ה-min-content של הטראק. תיקון: `grid-cols-[minmax(0,1fr)]` או `min-w-0` על ילדי ה-grid | `apps/web/src/pages/dashboard/DashboardPage.tsx:47` | `a11y-smoke.spec` — עכשיו בדיקה רגילה (עוברת) |
| BUG-QA-03 (לפי `booking-safety.md` §5.7 תוקן ב-`TERMS_VERSION=3`; לא נבדק מחדש ב-E2E) | נמוכה | i18n | ערכי enum באנגלית בתוך משפטים בעברית: שורת התנאים "מחלקה: economy, תעריף: לייט" (`terms_summary`); "סטטוס: CONFIRMED" בכרטיס אישור ההזמנה; "718.70 ILS (₪)" בהודעת שינוי מחיר | `apps/api/app/modules/booking/terms.py` (שורת המחלקה ב-`summary`, ו-`format_money` שמחזיר "ILS (₪)"), `apps/web/src/features/bookings/components/OutcomePanels.tsx:68` (שדה "סטטוס" מציג את ה-enum הגולמי) | לא מכוסה (גלוי בצילום מסך) |
| BUG-QA-04 (הטקסט כבר אינו בקוד — נראה שתוקן; לא נבדק ב-E2E) | נמוכה | ניסוח / שקיפות | מצב ריק של העוזר: "...ויציג הצעות **אמיתיות** מהתוצאות" — בעוד שכל ההצעות הן DEMO. מטעה ביחס למדיניות "אין הצעות אמיתיות" | `apps/web/src/features/assistant/components/ChatPanel.tsx:103` | לא מכוסה |
| BUG-QA-05 (**תוקן**, BOOK-REDIRECT: `problemBody()`) | נמוכה | UX | סיסמה שגויה באישור הזמנה: ההתראה מציגה את "הסיסמה שגויה" פעמיים (כותרת + גוף זהים) | `features/bookings/components/ApprovalPanel.tsx` / `useFeedback.ts` | לא מכוסה |
| BUG-QA-06 (נראה שתוקן: `countLabel` — V6-07 מאמת "2 חדרים · 3 מבוגרים · ילד אחד") | נמוכה | ניסוח | פרטי מלון: "אורחים: 1 חדרים · 2 מבוגרים" (ריבוי/יחיד) | `apps/web/src/features/offers/components/OfferDetailDialog.tsx:92` | לא מכוסה |
| BUG-QA-07 (**תוקן** ב-`booking-safety.md` §4.5) | נמוכה | תיעוד | `docs/security/booking-safety.md` §4.5 קובע שגם ניסיונות אימות מוצלחים נספרים; הקוד (`check_password_for_step_up`) סופר רק כשלונות. התיעוד מיושן | `docs/security/booking-safety.md` | — |
| BUG-QA-08 (**תוקן**: `request_id` ב-404, הודעה עברית ל-`json_invalid`, וגם `rid=` בלוג; `test_security_hardening.py`) | נמוכה | API | (א) 404 על נתיב `/api/...` לא קיים מחזיר `request_id: null` במעטפת השגיאה; (ב) שגיאת JSON שבור מחזירה `field: "9"` (אינדקס תו) במקום שם שדה | `apps/api/app/main.py:100` (מטפל 404 עם `request_id: None`), מטפל RequestValidationError | `security-headers.spec` בודק מבנה, לא ערכים |

**ממצאים חדשים מסבב V6:**

| מזהה | חומרה | תחום | תיאור | חשוד ב- | כיסוי בבדיקה |
|---|---|---|---|---|---|
| BUG-E2E-01 (**תוקן**: `_summary_cards`; V6-10b הפכה לבדיקה רגילה + `test_fallback_cards_cover_every_offer_named_in_the_summary`) | נמוכה-בינונית | עוזר AI (מצב בסיסי) | הטקסט מצטט את ההצעה **הזולה ביותר** ואת **הקצרה ביותר** ("• הזולה ביותר: … — 2,553.14 ₪"), אבל נשלחים כרטיסים רק ל-4 ההצעות הראשונות **בדירוג** (`resp.offers[:4]`). בכ-1 מכל 5 תשובות המחיר המצוטט (אמיתי, מהשרת) לא מופיע באף כרטיס, והמשפט "הפרטים המלאים בכרטיסים" לא נכון. לא מדובר במחיר מומצא, אבל המשתמש לא יכול לפתוח את ההצעה שצוטטה. צעדים: `POST /api/ai/chat` "טיסה מתל אביב לרומא ב-… לשני מבוגרים" על כמה תאריכים. צפוי: כל מחיר בטקסט מופיע בכרטיס. בפועל: מחיר ה-"הזולה ביותר" חסר בכרטיסים | `apps/api/app/modules/ai/service.py:233` (`cards=resp.offers[:CARDS_PER_SEARCH]`) מול `apps/api/app/modules/ai/summary.py:160-175` (cheapest / third pick). תיקון: להוסיף ל-`cards` את ההצעות שהסיכום מצטט | `v6-assistant-trip.spec` V6-10b — `test.fail` (סורק עד 18 תאריכים; אם לא נמצא מקרה — מדולג) |
| BUG-E2E-02 (**תוקן**: `useId()`; V6-17d בדיקה רגילה) | נמוכה | נגישות | `ChildAgesEditor` יוצר `id="child-age-${i}"`; בטופס מלונות עם ילד בשני חדרים אותו מזהה מופיע פעמיים (HTML לא תקין, התווית הנראית "ילד/ה 1" מצביעה על יעד דו-משמעי; `aria-label` עדיין נותן שם נגיש) | `apps/web/src/features/search/components/formControls.tsx` (`ChildAgesEditor`, ~שורה 79-84). תיקון: `useId()` לכל עורך | `v6-responsive-a11y.spec` V6-17d — `test.fail` |

תצפיות V6 (לא באגים, לשיקול דעת):

* **(טופל בלוח המחירים: "ספק אמיתי — לא מחובר/לא נשאל בלוח")** **תווית "חי" על ספקים אמיתיים שאינם מחוברים**: בדף "ספקים ואבחון" וברשימת "איך לקרוא את הלוח" שבלוח המחירים מוצג תג `מקור נתונים: חי` ליד ספקים כמו Duffel — אבל תמיד יחד עם "לא מחובר". זו תווית *סוג* ספק ולא טענה לנתונים חיים; הבדיקות (V6-20) מחייבות את שני הדברים יחד. כדאי לשקול ניסוח כמו "ספק חי (לא מחובר)" כדי שלא ייקרא כטענה.
* לוח המחירים נקרא אוטומטית בכל עמוד תוצאות טיסה ומוגבל ל-10 קריאות ב-10 דק' למשתמש — משתמש שמדפדף בין חודשים ובין תוצאות יגיע למגבלה מהר (הממשק מציג הודעה ברורה "הגעתם למגבלת הבדיקות של לוח המחירים").
* בדיאלוג פרטי הצעה, Escape הראשון נצרך לעיתים ע"י tooltip פתוח של תג ה-DEMO (לא באג — התנהגות Radix, הבדיקות סוגרות בלולאה).

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
* **Windows / PowerShell בהפעלה נקייה (V6-19)**: ה-E2E מריץ את הליבה הניידת (DB חדש, `migrate`, `create-owner`, הפעלת השרת, `/api/ready`, התחברות) ב-bash בלבד. החלק של `setup.ps1` / `start.ps1` מכוסה רק ע"י ולידציית ה-bash של DEVOPS-RELEASE.
* **לוח מחירים עם ספקים חיים**: הלוח לעולם לא קורא לספקים חיים (עיצוב); תאי `CACHED`/`LIVE` לא נבדקים כי אין ספקים חיים בסביבה.
* **מודל AI אמיתי** — כמו קודם; V6-10 רץ במצב בסיסי בלבד.
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

## 12. מטריצת תרחישי V6 (20 תרחישי חובה)

כל התרחישים רצים בשני הפרויקטים (desktop 1440 + mobile 390), אלא אם צוין. שמות הבדיקות מתחילים ב-`V6-NN`; החיפוש בהם נעשה כמבוגר שני (מכסה נפרדת), תאריכים אקראיים בכל ריצה.

| # | תרחיש | קובץ / בדיקה | מה נאכף |
|---|---|---|---|
| 01 | לוח בקרה ← טיסה הלוך-חזור TLV→רומא | `v6-flights` V6-01 | ניווט מהדשבורד, כרטיס מומלץ ("הזול ביותר מבין ההצעות שנמצאו" — לא "הזולה בשוק"), מפת מסלול, תוצאות, לוח מחירים ב-`ready` |
| 02 | לוח מחירים גמיש מ-DEMO | `v6-flights` V6-02 | תג DEMO, מקרא עם כל המצבים, סטטיסטיקה והערת כיסוי; ב-TLV→RHO תאים `no_offers` ריקים (אין מחיר/סכום/tier) ו-`priced` עם tier ו-`best`; אין תג LIVE על תאים |
| 03 | לחיצה על תאריך בלוח | `v6-flights` V6-03 | `search_id` ב-URL משתנה; החיפוש בשרת לתאריך שנלחץ ולאותו מספר לילות; הכרטיסים, ההצעה המומלצת והטבלה שייכים לחיפוש החדש |
| 04 | מסנני עצירות / מזוודה / מחיר מקסימלי | `v6-flights` V6-04 | כל כרטיס מוצג עומד בסינון (מול נתוני ה-API), ספירת "מוצגות N" נכונה, מסננים משולבים, ניקוי |
| 05 | כרטיס מומלץ מול הטבלה | `v6-flights` V6-05 | `featured-total` = מינימום הסה"כ בטבלה (ממוין לפי מחיר) = מינימום השרת באותו מטבע; "סה״כ ל-3 נוסעים" ולנוסע = סה"כ/3; בנייד: אין טבלה, כרטיסים |
| 06 | כשל ספק | `v6-flights` V6-06 | `demo_aurora` עם `simulate_error` ⇒ `partial`, `FAILED/SIMULATED_ERROR`, באנר "חלק מהספקים לא ענו" ופס ספקים "נכשל"; רק הספק התקין מציג הצעות; שחזור ב-`finally` |
| 07 | מלונות לפי תפוסה + ביטול | `v6-categories` V6-07 | 2 חדרים (2+ילד בן 7, 1), פרמטרי השרת, "3 מבוגרים + ילד אחד", "ביטול חינם עד", מדיניות ביטול ומס עירוני בפרטים |
| 08 | רכבים | `v6-categories` V6-08 | הערת נהג צעיר (גיל 22), `driver_age` בשרת, גיל מינימלי, פיקדון, מדיניות דלק וביטוחים בפרטים ובכל ההצעות |
| 09 | אטרקציות | `v6-categories` V6-09 | משתתפים וגילאים (2 מבוגרים + ילדים 4 ו-9), פירוט כרטיסים לפי סוג, תאריכים זמינים בתוך הטווח |
| 10 | עוזר AI (fallback) | `v6-assistant-trip` V6-10 (+V6-10b) | פענוח בקשה בעברית, כלי חיפוש, כרטיסים מנתוני השרת (מזהים וסכומים זהים), כל מחיר בטקסט הוא סה"כ של הצעה אמיתית, XSS נשאר טקסט. **V6-10b** (כל מחיר בטקסט מופיע בכרטיס) — כשל צפוי, BUG-E2E-01 |
| 11 | בונה טיולים | `v6-assistant-trip` V6-11 | תקציב ויתרה ולנוסע מחושבים; הוספת אותה טיסה פעמיים ⇒ דיאלוג חפיפה; ביטול ⇒ לא נוסף (גם 409 `ITEM_OVERLAP` בשרת); אישור ⇒ נוסף עם `overlap-badge` והודעות; התקציב סופר את שתיהן |
| 12 | תפקידי משפחה | `v6-family-booking` V6-12 | צופה לא רואה פאנל אישור, כפתורי בדיקה/אישור/שליחה/ביטול, או התחלת הזמנה; 403 בעברית לכל פעולת הזמנה; דגלי `can` כולם false; ההזמנה לא השתנתה |
| 13 | שינוי מחיר | `v6-family-booking` V6-13 | אישור מתבטל, מצב חוזר ל-`QUOTE_SELECTED`, אין reservation, האישור הישן (terms_hash ישן) נדחה, אישור מחדש ושליחה מצליחים |
| 14 | שליחה כפולה / timeout | `v6-family-booking` V6-14 | double-click ⇒ UNKNOWN אחד; שליחה במפתח חדש ⇒ 409; בירור ⇒ CONFIRMED; אותו מפתח (לפני ואחרי בירור) מחזיר `idempotent_replay` עם אותה reservation — לא נוצרת שנייה |
| 15 | מעבר לספק DEMO | `v6-family-booking` V6-15 | "ממתין להשלמה באתר הספק" ושם הספק, אין "אושרה"; דף הספק עם באנר DEMO, מחיר, ללא שדות קלט; גם אחרי "השלמה" אצל הספק ההזמנה נשארת APPROVED; אסמכתה שגויה נדחית; רק האסמכתה האמיתית מאשרת (`mode=HOSTED_CHECKOUT`) |
| 16 | מובייל 390 | `v6-responsive-a11y` V6-16 | אין גלישה אופקית ב-12 עמודים; רצועת הלוח עם גלילה פנימית, כפתורי שבוע ותאים ≥ 44px, `tap` על תא מעדכן חיפוש, אין טבלה, מגירת סינון במגע |
| 17 | מקלדת / נגישות / תנועה / מצב כהה | `v6-responsive-a11y` V6-17a..d | חיצים (RTL), Home/End, Enter, roving tabindex, מטריצה דו-ממדית; החזרת פוקוס מדיאלוגים ותפריט; h1 יחיד, שמות, אין מזהים כפולים (V6-17d כשל צפוי BUG-E2E-02); `reducedMotion`; `data-theme=dark` נשמר ברענון + ניגודיות ≥ 4.5 מחושבת בדפדפן |
| 18 | Host ו-Origin | `v6-platform` V6-18 | Host לא מורשה ⇒ 400 (API ו-SPA); `X-Forwarded-Host` לא משפיע; POST עם Origin זר ⇒ 403 גם עם סשן ו-CSRF תקינים ושום דבר לא נוצר |
| 19 | הפעלה נקייה והתחברות | `v6-platform` V6-19 (desktop בלבד) | DB חדש + `migrate` + `create-owner` מה-CLI + הפעלת uvicorn ⇒ `/api/ready` = ready (db/schema/encryption), התחברות API ודפדפן. **החלק של Windows/PowerShell לא רץ כאן** — מכוסה רק ע"י ולידציית ה-bash של DEVOPS-RELEASE |
| 20 | תוויות LIVE/SANDBOX/CACHED/DEMO | `v6-flights` V6-20 | כל כרטיס, שורת טבלה, הצעה מומלצת, פאנל לוח ותא מציגים DEMO; ספקים אמיתיים "לא מחובר" (תג "חי" מותר רק יחד עם "לא מחובר"); `data-mode-indicator` = DEMO; אין שום תג LIVE על הצעה |

**הערות יישום:** (1) הלוח מוגבל ל-10 קריאות/10 דק' ולכן נחסם ב-404 מדומה בבדיקות שלא עוסקות בו (סעיף 5.1). (2) SANDBOX ו-CACHED אינם מופיעים בסביבה (אין ספקי sandbox/חיים), ולכן V6-20 מאמת "הכול DEMO"; הטיפול בהם נבדק ביחידה (`FareCalendar.test.tsx`, `ModeBadge`). (3) ה-fixtures `ownerApi` / `scratchApi` מאפשרים לשנות הגדרות ספקים כבעלים בלי לשתף מכסות חיפוש.
