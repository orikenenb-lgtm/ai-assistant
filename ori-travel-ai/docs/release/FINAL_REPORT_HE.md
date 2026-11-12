# Ori Travel AI: דוח סופי (V6)

> **תאריך:** 2026-11-12.
> **ענף:** `claude/new-session-mm5rqi`. PR טיוטה #18 בריפו `orikenenb-lgtm/ai-assistant`.
> **סיווג שחרור:** **DEMO ONLY.** זו המלצת המבקר הבלתי-תלוי, ואני מסכים איתה.
>
> כל מספר במסמך מגיע מהרצה אמיתית. מה שלא נבדק מסומן ככזה.

## 1. מה עובד, מה הדגמה ומה חסום

| עובד ונבדק ✅ | הדגמה בלבד 🧪 | קוד אמיתי, נבדק מול mock בלבד 🧩 | חסום / כבוי ⛔ |
|---|---|---|---|
| התחברות פרטית למשפחה עם הזמנות ותפקידים, CSRF, Host allowlist, נעילה | כל מחירי הטיסות, המלונות, הרכבים והאטרקציות (8 ספקי DEMO עם מותגים בדויים) | Duffel (מצב test), Viator (affiliate), שערי ECB | ביצוע הזמנה אמיתית (חסום בקוד) |
| הצפנה של פרטי נוסעים, מיסוך, חשיפה רק עם סיסמה, מחיקה ו-retention | לוח מחירים גמיש (heatmap), שמשתמש רק בנתוני DEMO | Ollama ו-Anthropic (בתשלום, רק עם אישור) | Booking.com Demand, Expedia Rapid (דורשים הסכם שותף) |
| השוואה ודירוג שקופים, דיל מומלץ "הזול מבין שנמצאו" | השלמת הזמנה באתר ספק מדומה | | Amadeus Self-Service (הופסק, לפי דיווחים) |
| טיולים: ציר זמן, תקציב לפי מטבע ולנוסע, מניעת חפיפות, ICS ו-PDF בעברית | סימולציית הזמנה (חמישה תרחישים) | | אימות ספקים מול התיעוד הרשמי (DNS חסום בסביבה) |
| עוזר AI במצב בסיסי (בלי מודל), כולל grounding והגנה מ-injection | | | |
| עיצוב בהיר ומצב כהה, RTL, מובייל, נגישות AA | | | |

## 2. העיצוב החדש, בהשראת הסרטון

הסרטון עצמו לא הועלה, רק התיאור שלו בהנחיה, והעבודה נעשתה לפי התיאור. צילומי המסך נמצאים ב-[`docs/release/screenshots/`](screenshots/),
וההשוואה המלאה לתיאור הסרטון ב-[`visual-qa.md`](visual-qa.md).

| מה תואר בסרטון | מה נבנה | צילום |
|---|---|---|
| טופס חיפוש בהיר ומינימליסטי | טופס טיסות קומפקטי: יעד, תאריכים וגמישות, נוסעים וגילאים, מחלקה, מזוודה, תקציב | `06` |
| לוח מחירים צבעוני: כתום, צהוב, כחול | לוח חודשי ומטריצת לילות. כתום מסמן את הזול ביותר, תכלת את הזולים, צהוב את הבינוניים ואפרסק את היקרים. יש מקרא, ⭐ ליום הזול, ומצבי "אין טיסות" ו"לא נבדק" | `01`, `02`, `11`, `15` |
| תוצאות בטבלה | תצוגת טבלה ב-desktop וכרטיסים במובייל. סינון לפי עצירות, מזוודה לבטן, מחיר ושעה | `04`, `13` |
| כרטיס דיל כתום עם מחיר גדול ב-₪ | "הזול ביותר מבין ההצעות שנמצאו בחיפוש זה". מוצגים סה״כ ומחיר לנוסע, חברה, מסלול, כבודה, ספק ועדכניות | `03`, `12`, `16` |
| מפת מסלול | SVG בלי שרתי מפות (מקור הבסיס: Natural Earth), עם עצירות ביניים והערה שהקווים סכמטיים | `05` |
| **שונה בכוונה** | מיתוג מקורי, תגי DEMO בכל מקום, הלוח לא קורא לספקים חיים לכל תא, ואין טענה ל"הכי זול בשוק" | |

## 3. מטריצת ספקים (נבדק לאחרונה: 2026-11-12)

| ספק | סטטוס | ראיה |
|---|---|---|
| 8 ספקי DEMO | **DEMO** (פעילים) | `test_providers_demo.py`, E2E V6-20 |
| Duffel | **MOCK ONLY** | `test_live_duffel.py` מול fixtures. התיעוד הרשמי לא נפתח (DNS) |
| Viator | **MOCK ONLY** | `test_live_viator.py`. מזהי היעדים ורשימת המטבעות **לא אומתו** |
| ECB FX | **MOCK ONLY** (כבוי כברירת מחדל) | `test_live_fx.py` |
| Amadeus Self-Service | **DISCONNECTED** (הופסק) | דיווחי צד שלישי על סגירה ב-2026 |
| Booking.com Demand / Expedia Rapid | **BLOCKED** | דורשים הסכם שותף |
| SANDBOX VERIFIED / LIVE VERIFIED | **אין אף ספק** | אין מפתחות, ואתרי התיעוד חסומים בסביבה |

הפירוט המלא, כולל 11 אי-התאמות פוטנציאליות לבדיקה: [`provider-capability-matrix.md`](../integrations/provider-capability-matrix.md).

## 4. בדיקות: הפקודות והתוצאות האמיתיות

### סבב 1 (עץ העבודה הסופי)

| בדיקה | פקודה | תוצאה |
|---|---|---|
| API על SQLite | `cd apps/api && .venv/bin/python -m pytest tests -p no:warnings -o addopts= -q` | **890 passed** |
| API על PostgreSQL 16 | אותה פקודה עם `ORI_TEST_DATABASE_URL=postgresql+psycopg://…` | **890 passed** |
| Ruff / Bandit / pip-audit | `ruff check app tests alembic` · `bandit -r app -ll -q` · `pip_audit -r requirements.txt` | נקי / 0 ממצאים / 0 פגיעויות |
| migrations | `python -m app.cli migrate && alembic check` | No new upgrade operations |
| web | `npm run typecheck && npm run lint && npx vitest run && npm run build` | 0 שגיאות, **254 passed**, build עבר |
| נגישות | `npx playwright test e2e/visual/a11y --project=desktop` | **148 passed**, בלי חריגים ידועים |

### סבב 2, אחרי תיקון תשתית הבדיקות

| בדיקה | פקודה | תוצאה |
|---|---|---|
| E2E: desktop ו-mobile, ריצה אחת | `npx playwright test` | **168 passed, 2 skipped** (בכוונה), **0 failed** |
| ויזואלי על DB נקי | `npx playwright test e2e/visual/visual.spec.ts --project=desktop` | **58/58** |

**מה נכשל בדרך, בשקיפות:**
* בסבב הראשון נכשלו 17 בדיקות E2E במובייל. הסיבה הייתה מכסת חיפוש למשתמש שנגמרה כששני הפרויקטים רצו מול שרת אחד.
  תוקן: המכסה ניתנת להגדרה ומוגבהת רק בשרתי בדיקה.
* בסבב הראשון נכשלו 4 baselines של לוח הבקרה, כי הגובה היה תלוי בנתונים. תוקן: הם נוצרו מחדש לפי נוהל קנוני.

## 5. ארגון הסוכנים והמודלים (בפועל)

* **24 סוכני-משנה הופעלו**: 14 בשלב V3 ו-10 בשלב V6. בנוסף היו כ-13 חידושים עם הקשר, לתיקונים.
  הם כיסו את 30 התפקידים שבהנחיה. המיפוי ב-[`organization.md`](../agents/organization.md).
* **מודלים:**
  * הסשן הראשי: `claude-opus-5-5`. **זה אומת** דרך `get_session`.
  * סוכני-משנה: נדרשו `opus` ×6, `fable` ×4 ו-`sonnet` ×14. אין דרך לאמת מבפנים איזה מודל באמת הגיש כל סוכן.
  * פירוט ב-[`model-routing.md`](../agents/model-routing.md).
* **מקביליות מקסימלית:** 7.
* **ביקורות בלתי-תלויות:** 2 (AUD ו-RELEASE-AUDIT, שתיהן על fable). אף אחד מהמבקרים לא כתב קוד במערכת.
* **כלים שהיו בשימוש:**
  * GitHub MCP, ליצירת PR.
  * WebSearch, למחקר. WebFetch נכשל (DNS).
  * Playwright עם Chromium.
  * PostgreSQL 16 מקומי.
  * skill `claude-api`, שסוכן ה-AI השתמש בו.
* **לא היו בשימוש** (לא רלוונטיים או פרטיים): Gmail, Drive, Calendar, Supabase, Vercel, Lovable ו-Railway.
* **יומן ותיקון זמנים:** [`agent-activity-log.md`](../agents/agent-activity-log.md), כולל ציר זמן מאומת לפי git.
  השעות שרשמתי בהתחלה היו משוערות וסטו מהזמן האמיתי. הממצא RA-06 תוקן.

## 6. אבטחה

* **ביקורת 1 (AUD):** 0 ממצאים קריטיים או גבוהים, 8 בינוניים (תוקנו כולם), ו-9 נמוכים (תוקנו ברובם).
  [`audit-report.md`](../security/audit-report.md)
* **ביקורת שחרור (RELEASE-AUDIT):**
  * אימתה מחדש את 8 התיקונים הבינוניים, וכולם מחזיקים.
  * לוח המחירים: 0 אי-התאמות ב-95 תאים, ו-0 קריאות לספק חי.
  * 0 בקשות רשת לצד שלישי ב-22 מסכים.
  * 9 ממצאים נמוכים: תוקנו (RA-01 עד 09, חוץ מבדיקת פורט ב-`.ps1`).
  * [`release-audit.md`](release-audit.md)
* **סיכונים שנותרו (מתועדים):**
  * בן משפחה יכול לנעול את חשבון הבעלים זמנית, אחרי 5 ניסיונות כושלים.
  * rate limiting נשמר בזיכרון התהליך.
  * מפתח ההצפנה נמצא ב-`.env`.
  * אין MFA.
  * צופים צורכים מכסת חיפוש.
  * רישיון `react-leaflet` הוא Hippocratic-2.1. זה מתאים לשימוש פרטי.

## 7. סיווג הזמנות: **DEMO ONLY**

* ביצוע אמיתי חסום בקוד (`LIVE_EXECUTION_DISABLED`). דגל ההגדרה לא נקרא בכלל.
* מסלול "השלמה באתר ספק" עובד מקצה לקצה **רק מול ספק DEMO בתוך האפליקציה**, והאסמכתה מאומתת בשרת.
* אסמכתה שהוקלדה ידנית אצל ספק חי תסומן "לא אומתה מול הספק", ולא "אושר".
* כדי לעלות ל-REDIRECT BOOKING צריך מתאם אמיתי שתומך גם בבדיקת מחיר חוזרת וגם בהשלמה אצל הספק.
  בנוסף צריך אימות מול sandbox. זה עדיין לא קיים.

## 8. מה נדרש ממך (בלי סודות)

1. **להריץ פעם אחת ב-Windows** את הפקודות שלמטה. ה-PowerShell נכתב ונסקר אבל לא הורץ, כי אין pwsh בסביבה.
2. **אימות ספקים (רשות):** להוסיף בהגדרות הסביבה (Network access) את הדומיינים `duffel.com`, `docs.viator.com`,
   `developers.booking.com`, `developers.expediagroup.com` ו-`www.ecb.europa.eu`. אחרי זה אפשר לאמת את התיעוד הרשמי.
3. **Duffel test (חינם):** טוקן `duffel_test_…` נכנס ל-`apps/api/.env`, יחד עם `ORI_LIVE_PROVIDERS_ENABLED=true`.
   ⚠️ לפי מקורות צד שלישי, ב-live יש עמלה על חיפושים עודפים. יש תקרה יומית של 50 חיפושים.
4. **AI (רשות):**
   * Ollama מקומי בחינם: `ORI_AI_PROVIDER=ollama`.
   * ענן בתשלום: רק עם `ORI_AI_ALLOW_PAID=true` ומפתח. ⚠️ עלות.
5. **Booking.com ו-Expedia:** דורשים הסכם שותף עסקי. אין מה לעשות בלי זה.

## 9. הפעלה מקומית ב-Windows

```powershell
cd ori-travel-ai
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -CreateOwner -OwnerEmail you@example.com -OwnerName "אורי"
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
# ואז בדפדפן: http://127.0.0.1:8000
```

* **אומת בפועל:** אותה זרימה ב-bash, מ-clone נקי (`scripts/setup.sh` ואז `scripts/start.sh app`). התוצאה הייתה 200
  ב-`/api/health`, ב-`/api/ready` ובדף הראשי.
* **לא אומת ב-Windows עצמו.**
* פירוט נוסף: [`windows-release.md`](windows-release.md), [`rollback.md`](rollback.md), [`diagnostics.md`](diagnostics.md).

## 10. קבצים, commits, rollback והמשך

* **היקף:** 677 קבצים ב-`ori-travel-ai/` (171 Python, 348 TS/TSX, 48 מסמכים) וקובץ CI אחד בשורש.
  זה התפרס על 53 commits בענף. פרויקטים אחרים בריפו לא שונו.
* **Rollback:**
  * חזרה ל-commit קודם: `git checkout <commit>`.
  * שחזור DB: `scripts/restore-db.ps1`. גיבוי נוצר אוטומטית לפני כל migration.
  * פירוט ב-[`rollback.md`](rollback.md).
* **השלבים הבאים:**
  1. הרצה ב-Windows.
  2. Duffel test לאימות חיפוש אמיתי.
  3. MFA.
  4. מפתח הצפנה במנהל סודות.
  5. ספקי לינה ואטרקציות אחרי אישורי שותפות.
