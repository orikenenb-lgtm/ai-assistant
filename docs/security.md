# 🔐 סיכום אבטחה — Kerem Orders

נכון לסיום Phase 7. ✅ = ממומש ומכוסה בבדיקות.

## הרשאות — הגנה דו-שכבתית

- ✅ **שכבה 1 — RLS ב-Supabase**: כל 7 הטבלאות עם `ENABLE ROW LEVEL SECURITY`.
  לקוח רואה רק את עצמו/שלו; כתיבת sync רק ב-service role. 17 בדיקות על PostgreSQL אמיתי
  (A4, A6, O7, חסימת privilege escalation, חסימת הזמנה על שם אחר).
- ✅ **שכבה 2 — FastAPI**: `get_current_user` / `require_admin` על כל endpoint מוגן.
  בדיקות 401/403 על כל נתיבי האדמין (פרמטריות, כולן).
- ✅ queries בזהות המשתמש (JWT מוצמד) — לא עוקפים RLS; service role רק לפעולות מערכת.

## Secrets

- ✅ הכל ב-env vars בלבד; `.env` ב-gitignore; אומת שאין secrets בהיסטוריית git כולה.
- ✅ טוקן Rivhit + service_role חיים בבקנד בלבד — הפרונט מקבל anon key בלבד.

## כתיבה ל-Rivhit (הפעולה הרגישה ביותר)

- ✅ נקודת כתיבה יחידה: `rivhit_service.create_quote`.
- ✅ מפסק `RIVHIT_WRITE_ENABLED` — כבוי כברירת מחדל, נחסם לפני יצירת תעבורה.
- ✅ dry-run חובה: ה-confirm דורש token שנגזר מתוכן ההצעה (שינוי → פסילה).
- ✅ חסימת כפילות (409) + audit_log על כל הצעה.

## הקשחות נוספות

- ✅ Rate limiting: login 10/דקה, signup 10/שעה, reset 5/שעה (brute force).
- ✅ אין user enumeration: הודעות אחידות ב-login וב-reset password.
- ✅ ולידציית Pydantic על כל קלט (כמויות, אימיילים, סטטוסים, אורכים).
- ✅ הלקוח לא שולח מחיר לעולם — snapshot מה-DB בלבד.
- ✅ CORS מצומצם ל-`ALLOWED_ORIGINS`; HTTPS אוטומטי ב-Vercel/Railway.
- ✅ trigger DB חוסם שינוי role/status/קישור עצמי; ולידציית מעברי סטטוס.
- ✅ JWT עם תוקף שעה + refresh token (ניהול Supabase Auth).

## ידוע ומקובל (סיכונים שהוחלט לחיות איתם ב-MVP)

- Rate limiting בזיכרון (worker יחיד) — מספיק לעומס העסק; Redis אם נגדל.
- אין CSRF token ייעודי — ה-API מבוסס Bearer token (לא cookies), כך שהסיכון נמוך.
- `quote_confirm` בלי idempotency key מול Rivhit — מוגן ב-token + נעילת כפילות ב-DB.
