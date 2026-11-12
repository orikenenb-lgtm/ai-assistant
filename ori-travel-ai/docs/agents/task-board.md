# לוח משימות

סטטוסים: ⏳ ממתין · 🔄 בביצוע · ✅ הושלם ונבדק · ⚠️ הושלם חלקית · ❌ חסום

| ID | משימה | בעלים | תלויות | בעלות על קבצים | סטטוס | בדיקות קבלה |
|---|---|---|---|---|---|---|
| W0-1 | סקירת סביבה ויכולות | 01 מנהל | — | docs/integrations/tool-capability-matrix.md | ✅ | מטריצה מתועדת |
| W0-2 | חוזי API וכללי צוות | 01 מנהל | — | docs/architecture/api-contract.md | ✅ | מסמך קיים |
| W0-3 | ליבת API: config, db, מודלים, אבטחה, auth, health | 01 מנהל | — | apps/api/app/core, models, modules/auth, modules/health, main.py, cli.py | ✅ | 17/17 pytest, ruff נקי |
| W0-4 | סכמות canonical + ממשק מתאם ספק | 01 מנהל | — | app/schemas/*, modules/providers/base.py | ✅ | ייבוא ואימות סכמות |
| W1-B1 | משפחה, נוסעים, התראות, ביקורת, הגדרות | B1 | W0 | modules/family, travelers, notifications, audit, settings, seed.py | 🔄 | מטריצת הרשאות, הצפנה, מחיקה |
| W1-B2 | ספקים, חיפוש, נרמול, השוואה, FX | B2 | W0 | modules/providers, search, comparison | 🔄 | דטרמיניזם, dedupe, timeout, דירוג |
| W1-F1 | בסיס frontend ומערכת עיצוב RTL | F1 | W0 | apps/web/** | 🔄 | build, lint, test, צילומי מסך |
| W1-R1 | מחקר ספקים רשמי | R1 | — | docs/integrations/providers.md, provider-api-notes.md | 🔄 | מקורות מצוטטים |
| W2-B3 | טיולים, תקציב, ICS/PDF, מועדפים, התראות מחיר, מתזמן | B3 | B2 | modules/itineraries, saved, price_tracking | ⏳ | |
| W2-B4 | מכונת מצבים להזמנה, אישור, ספק מדומה, התאמה | B4 | B2 | modules/booking | ⏳ | |
| W2-B5 | AI: הפשטת מודל, כלים, fallback, הגנה מ-injection | B5 | B2 | modules/ai | ⏳ | |
| W2-B6 | מתאמים חיים (קוד + NOT CONNECTED) | B6 | R1, B2 | modules/providers/live | ⏳ | |
| W2-F2 | מסכי חיפוש, כרטיסי הצעה, השוואה, מועדפים, ספקים | F2 | F1, B2 | apps/web/src/features/{offers,search,compare,saved,providers}, pages מתאימים | ⏳ | |
| W3-F3 | טיולים, משפחה, התראות, הגדרות | F3 | F2, B1, B3 | | ⏳ | |
| W3-F4 | צ'אט AI והזמנות | F4 | F2, B4, B5 | | ⏳ | |
| W3-D1 | סקריפטי Windows, CI, תיעוד תפעול | D1 | W2 | scripts/, .github/workflows/ori-travel-ai.yml, docs/operations | ⏳ | |
| W4-QA | E2E Playwright ובדיקות כשל | QA | W3 | apps/web/e2e, tests | ⏳ | |
| W4-AUD | ביקורת בלתי-תלויה | AUD | W3 | docs/security/audit-report.md | ⏳ | |
| W5 | תיקונים, migrations, אימות סופי ודוח | 01 מנהל | W4 | — | ⏳ | |
