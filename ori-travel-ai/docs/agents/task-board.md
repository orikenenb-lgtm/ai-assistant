# לוח משימות

סטטוסים: ⏳ ממתין · 🔄 בביצוע · ✅ הושלם ונבדק · ⚠️ הושלם חלקית · ❌ חסום

| ID | משימה | בעלים | תלויות | בעלות על קבצים | סטטוס | בדיקות קבלה |
|---|---|---|---|---|---|---|
| W0-1 | סקירת סביבה ויכולות | 01 מנהל | — | docs/integrations/tool-capability-matrix.md | ✅ | מטריצה מתועדת |
| W0-2 | חוזי API וכללי צוות | 01 מנהל | — | docs/architecture/api-contract.md | ✅ | מסמך קיים |
| W0-3 | ליבת API: config, db, מודלים, אבטחה, auth, health | 01 מנהל | — | apps/api/app/core, models, modules/auth, modules/health, main.py, cli.py | ✅ | 17/17 pytest, ruff נקי |
| W0-4 | סכמות canonical + ממשק מתאם ספק | 01 מנהל | — | app/schemas/*, modules/providers/base.py | ✅ | ייבוא ואימות סכמות |
| W1-B1 | משפחה, נוסעים, התראות, ביקורת, הגדרות | B1 | W0 | modules/family, travelers, notifications, audit, settings, seed.py | ✅ | מטריצת הרשאות, הצפנה, מחיקה |
| W1-B2 | ספקים, חיפוש, נרמול, השוואה, FX | B2 | W0 | modules/providers, search, comparison | ✅ | דטרמיניזם, dedupe, timeout, דירוג |
| W1-F1 | בסיס frontend ומערכת עיצוב RTL | F1 | W0 | apps/web/** | ✅ | build, lint, test, צילומי מסך |
| W1-R1 | מחקר ספקים רשמי | R1 | — | docs/integrations/providers.md, provider-api-notes.md | ✅ | מקורות מצוטטים |
| W2-B3 | טיולים, תקציב, ICS/PDF, מועדפים, התראות מחיר, מתזמן | B3 | B2 | modules/itineraries, saved, price_tracking | ✅ | |
| W2-B4 | מכונת מצבים להזמנה, אישור, ספק מדומה, התאמה | B4 | B2 | modules/booking | ✅ | |
| W2-B5 | AI: הפשטת מודל, כלים, fallback, הגנה מ-injection | B5 | B2 | modules/ai | ✅ | |
| W2-B6 | מתאמים חיים (קוד + NOT CONNECTED) | B6 | R1, B2 | modules/providers/live | ✅ | |
| W2-F2 | מסכי חיפוש, כרטיסי הצעה, השוואה, מועדפים, ספקים | F2 | F1, B2 | apps/web/src/features/{offers,search,compare,saved,providers}, pages מתאימים | ✅ | |
| W3-F3 | טיולים, משפחה, התראות, הגדרות | F3 | F2, B1, B3 | | ✅ | |
| W3-F4 | צ'אט AI והזמנות | F4 | F2, B4, B5 | | ✅ | |
| W3-D1 | סקריפטי Windows, CI, תיעוד תפעול | D1 | W2 | scripts/, .github/workflows/ori-travel-ai.yml, docs/operations | ⚠️ (PowerShell לא הורץ) | |
| W4-QA | E2E Playwright ובדיקות כשל | QA | W3 | apps/web/e2e, tests | ✅ | |
| W4-AUD | ביקורת בלתי-תלויה | AUD | W3 | docs/security/audit-report.md | ✅ | |
| W5 | תיקונים, migrations, אימות סופי ודוח | 01 מנהל | W4 | — | ✅ | |

## V6 (סטטוסים: BACKLOG / READY / IN_PROGRESS / REVIEW / BLOCKED / DONE)

| ID | משימה | בעלים | תלויות | בעלות על קבצים | סטטוס | ראיות |
|---|---|---|---|---|---|---|
| V6-W0 | שחזור בסיס עצמאי | מנהל | — | docs/release/baseline-audit.md | DONE | worktree מבודד: 672/672 SQLite+PG, web 152 |
| V6-C | חוזה V6 + tokens | מנהל | W0 | docs/architecture/v6-*.md, styles tokens | DONE | ניגודיות מחושבת |
| V6-CAL | API ללוח מחירים, highlights, geo | BE-CAL | V6-C | modules/search, providers/demo/flights | DONE | test_calendar 43, ביקורת: 0 אי-התאמות |
| V6-FLT | חוויית טיסות (heatmap, דיל, טבלה, מפה) | FE-FLIGHT | V6-CAL | features/{fare-calendar,route-map,offers,search} | DONE | vitest, E2E V6-01..06, צילומים |
| V6-DS | עיצוב בהיר + מצב כהה + נגישות | UX-DS | V6-C | styles, ui, layout | DONE | 59 זוגות AA, a11y 148 |
| V6-TRP | חפיפות בטיול, תקציב לנוסע | BE-TRIPS | — | itineraries, features/trips | DONE | test_overlap 56, E2E V6-11 |
| V6-RDR | checkout מדומה באתר ספק | BOOK-REDIRECT | — | booking, features/bookings, pages/demo-supplier | DONE | test_demo_redirect 65+, E2E V6-15 |
| V6-PRV | מטריצת יכולות ספקים | PROV-ANALYST | — | docs/integrations | DONE (ללא אימות רשמי: DNS חסום) | provider-capability-matrix.md |
| V6-REL | Windows release, גיבוי/שחזור | DEVOPS-RELEASE | — | scripts, docs/release, CI | DONE (PowerShell לא הורץ) | התקנה נקייה ב-bash |
| V6-E2E | 20 תרחישי חובה | E2E-V6 | V6-FLT, V6-DS, V6-RDR | e2e/*.spec.ts | DONE | 168 passed / 0 failed |
| V6-VIS | ויזואלי + נגישות | VIS-A11Y | V6-FLT, V6-DS | e2e/visual | DONE | 58/58, 148/148 |
| V6-AUD | ביקורת שחרור בלתי-תלויה | RELEASE-AUDIT | הכל | docs/release/release-audit.md | DONE | DEMO ONLY, 0 קריטי/גבוה/בינוני |
| V6-FIX | תיקוני RA, QA, A11Y, E2E | סוכנים מקוריים + מנהל | V6-AUD | לפי ownership.md | DONE | 890 API, 254 web |
| V6-BLK-1 | אימות ספקים מול תיעוד רשמי | בעל החשבון | גישת רשת | — | BLOCKED | DNS חסום לאתרי הספקים בסביבה |
| V6-BLK-2 | הרצת PowerShell ב-Windows | בעל החשבון | מחשב Windows | — | BLOCKED | אין pwsh בסביבה |
