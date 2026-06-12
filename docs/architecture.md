# Kerem Orders — ארכיטקטורה

מערכת ניהול הזמנות לעסק סיטונאות צעצועים, מחוברת ל-Rivhit Online.

## רכיבי המערכת

| רכיב | טכנולוגיה | אחסון |
|------|-----------|-------|
| Frontend | React 19 + TypeScript + Vite + Tailwind v4 (RTL) | Vercel |
| Backend | FastAPI (Python 3.11) + Pydantic | Railway |
| Database + Auth | Supabase (PostgreSQL + RLS + JWT) | Supabase |
| אינטגרציה | Rivhit Online API v3 | — |
| התראות | Resend (Email) + Telegram Bot | — |

## תפקידים והרשאות

- **admin** (אבא + אורי): גישה מלאה — הזמנות, לקוחות, מוצרים, סנכרון, כתיבה ל-Rivhit.
- **customer** (לקוח): רואה רק את הקטלוג שלו ואת ההזמנות שלו. אין עריכה, אין סנכרון.

### אכיפה דו-שכבתית (כלל ברזל)
1. **RLS ב-Supabase** — גם אם מישהו עוקף את ה-API, מסד הנתונים עצמו חוסם.
2. **Dependencies ב-FastAPI** — `require_admin()` / `get_current_user()` בכל endpoint.

## כללי ברזל

1. כל קריאה ל-Rivhit עוברת דרך `backend/app/services/rivhit_service.py` בלבד.
2. Dry-run תמיד לפני כל כתיבה ל-Rivhit.
3. כתיבה ל-Rivhit production — רק אחרי אישור מפורש של אורי.
4. Secrets רק ב-env vars (`.env` מקומי, env vars ב-Railway/Vercel) — לעולם לא בקוד או ב-git.
5. טוקן Rivhit חי בבקנד בלבד — לעולם לא נחשף לפרונטנד.
6. כל סנכרון נרשם ב-`sync_logs`; כל פעולת admin רגישה נרשמת ב-`audit_log`.
7. Retry עם exponential backoff (1s, 2s, 4s, 8s) על שגיאות רשת מול Rivhit.

## זרימת הזמנה (תמצית)

```
לקוח בוחר מוצרים → POST /orders (status=pending)
→ התראה לאבא (Email + Telegram)
→ אבא סוקר בדשבורד → "צור הצעת מחיר" → dry-run → אישור
→ push ל-Rivhit → status=quoted → confirmed → shipped → closed
```

## סטטוסי הזמנה

`pending` → `reviewed` → `quoted` → `confirmed` → `shipped` → `closed` (או `cancelled`)

## שלבי הפרויקט

| Phase | תוכן | סטטוס |
|-------|------|-------|
| 0 | תשתית: repo, שלד FastAPI, פרונט RTL | ✅ הושלם |
| 1 | DB (schema + RLS) + Auth | ✅ הושלם (ממתין לחיבור Supabase חי) |
| 2 | סנכרון Rivhit (מוצרים + לקוחות) | ✅ הושלם (כיול מיפוי שדות ממתין לפתיחת רשת ל-Rivhit) |
| 3 | קטלוג + הזמנות (לקוח) | ⬜ |
| 4 | דשבורד אדמין | ⬜ |
| 5 | התראות (Resend + Telegram) | ⬜ |
| 6 | הצעת מחיר ל-Rivhit (dry-run + push) | ⬜ |
| 7 | ליטוש + Deploy לפרודקשן | ⬜ |
