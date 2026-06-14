# ✅ עלייה לאוויר — צ'ק־ליסט פשוט (Kerem Orders)

שלושה דברים צריכים לדבר זה עם זה: **Supabase** (מסד נתונים) ← **Railway** (שרת/בקנד) ← **Vercel** (האתר/פרונט).
ההודעה "אין חיבור לשרת" באתר = הפרונט לא מצליח להגיע לבקנד. עוברים על השלבים לפי הסדר.

---

## שלב 1 — Supabase (מסד נתונים) — פעם אחת

1. [supabase.com](https://supabase.com) → New project (Region: **Frankfurt**). שמור את סיסמת ה-DB.
2. בפרויקט: **SQL Editor → New query** → הדבק את **כל** התוכן של `supabase/setup_all.sql` → **Run**.
   - צריך להופיע "Success". זה מקים את כל הטבלאות, ה-RLS וההגנות בבת אחת.
3. **Project Settings → API** → העתק לשלושה מקומות (לשלב 2 ו-3):
   - `Project URL`  → ישמש כ-`SUPABASE_URL` וגם `VITE_SUPABASE_URL`
   - `anon public`  → ישמש כ-`SUPABASE_ANON_KEY` וגם `VITE_SUPABASE_ANON_KEY`
   - `service_role` → ישמש כ-`SUPABASE_SERVICE_ROLE_KEY` (סודי! רק ב-Railway, **לעולם לא** ב-Vercel)
4. **Authentication → Providers → Email**: לבדיקה ראשונה מהירה כבה את "Confirm email" (אחרת צריך לאשר כל הרשמה במייל). אפשר להחזיר אחר כך.

---

## שלב 2 — Railway (בקנד) — משתני סביבה

ב-Railway → השירות → **Variables** → הגדר (Raw Editor מאפשר הדבקה בבת אחת):

| משתנה | ערך |
|--------|-----|
| `ENVIRONMENT` | `production` |
| `SUPABASE_URL` | מ-Supabase שלב 1 |
| `SUPABASE_ANON_KEY` | מ-Supabase שלב 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | מ-Supabase שלב 1 (סודי!) |
| `ALLOWED_ORIGINS` | `https://ai-assistant-seven-theta.vercel.app` |
| `RIVHIT_API_TOKEN` | הטוקן מחשבון Rivhit |
| `RIVHIT_WRITE_ENABLED` | `false` ⚠️ (לא נוגעים בזה עכשיו) |
| `SYNC_ENABLED` | `false` (מדליקים רק אחרי שמאמתים את Rivhit) |

אחרי שמירה → **Redeploy**. ואז פתח בדפדפן: `https://<כתובת-railway>/health`
→ צריך להחזיר `{"status":"ok",...}`. אם לא — הבקנד לא עלה (כנראה חסר אחד מ-`SUPABASE_*`).

---

## שלב 3 — Vercel (האתר) — הכי קריטי לבעיה הנוכחית

ב-Vercel → הפרויקט → **Settings → Environment Variables** → הגדר:

| משתנה | ערך |
|--------|-----|
| `VITE_API_URL` | הכתובת המלאה של Railway, למשל `https://xxx.up.railway.app` — **בלי `/` בסוף** |
| `VITE_SUPABASE_URL` | מ-Supabase שלב 1 |
| `VITE_SUPABASE_ANON_KEY` | מ-Supabase שלב 1 (anon בלבד!) |

⚠️ **חובה אחרי זה: Deployments → ... → Redeploy.**
‏Vite "צורב" את `VITE_API_URL` בזמן הבנייה — בלי Redeploy השינוי לא נכנס, וזה הגורם הכי שכיח ל"אין חיבור לשרת".

---

## שלב 4 — בדיקה

1. פתח `https://ai-assistant-seven-theta.vercel.app` → נסה להירשם.
2. אם עדיין "אין חיבור לשרת": פתח ב-Chrome את DevTools (F12) → לשונית Network → נסה שוב → לחץ על הבקשה האדומה:
   - אם היא הולכת ל-`localhost:8000` → `VITE_API_URL` לא נכנס → חזור לשלב 3 + Redeploy.
   - אם כתוב `CORS` → `ALLOWED_ORIGINS` ב-Railway לא תואם → שלב 2.
   - אם `500` / `404` → הבקנד עלה אבל יש בעיה — שלח לי צילום.
3. הרשמה הצליחה? הפוך את עצמך לאדמין: Supabase → SQL Editor:
   ```sql
   UPDATE profiles SET role='admin'
   WHERE id = (SELECT id FROM auth.users WHERE email='האימייל-שלך@gmail.com');
   ```

זהו — מרגע שהשלושה מחוברים, ההרשמה וההתחברות עובדות.
