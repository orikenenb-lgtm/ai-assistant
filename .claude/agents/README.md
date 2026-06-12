# תת-הסוכנים של Kerem Orders

ה-Orchestrator מפרק כל Phase למשימות ומקצה אותן לתת-הסוכנים הבאים:

| סוכן | אחריות |
|------|--------|
| **DATABASE** | schema, migrations, אינדקסים, RLS policies ב-Supabase |
| **BACKEND** | FastAPI — endpoints, auth dependencies, לוגיקה עסקית |
| **RIVHIT INTEGRATION** | הבעלים הבלעדי של `rivhit_service.py` — כל קריאה ל-Rivhit עוברת רק דרכו |
| **FRONTEND** | React + TS + Tailwind, עברית RTL, responsive |
| **SECURITY** | הרשאות דו-שכבתיות (RLS + dependencies), secrets, סקירות |
| **DEVOPS** | Railway / Vercel, CI/CD, env vars, גיבויים |
| **QA** | בדיקות מערכת + E2E — אף Phase לא נסגר בלי אישורו |

## כללי עבודה

- אף Phase לא מסתיים בלי שה-QA אישר את קריטריון ההצלחה.
- לפני כל פעולה בלתי-הפיכה (כתיבה ל-Rivhit production, מחיקת DB) — עצירה ואישור מפורש מאורי.
- בדיקות עשן לפני כל deploy: `/health`, login, שליפת קטלוג, יצירת הזמנה, חיבור Supabase, Rivhit dry-run.
- הודעות commit בעברית.
