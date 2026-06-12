# 🚀 מדריך העלייה לאוויר — Kerem Orders

כל הצעדים, לפי הסדר. זמן משוער: 60-90 דקות.

## שלב 1 — Supabase (מסד נתונים + Auth)

1. פתח פרויקט ב-[supabase.com](https://supabase.com) (Region: **Frankfurt**).
2. **SQL Editor** → הרץ לפי הסדר:
   - את כל `supabase/migrations/20260612000000_init.sql`
   - את כל `supabase/migrations/20260612000001_invite_linking.sql`
   - ⚠️ **אל** תריץ את `supabase/tests/` — זה stub לבדיקות מקומיות בלבד!
3. **Authentication → URL Configuration**: הגדר את Site URL לדומיין של הפרונט (אחרי שלב 3).
4. **Project Settings → API**: העתק `URL`, `anon`, `service_role`.
5. יצירת האדמין הראשון (אבא + אורי): הירשמו דרך האפליקציה, ואז ב-SQL Editor:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE id = (
       SELECT id FROM auth.users WHERE email = 'האימייל-של-אבא@example.com');
   ```

## שלב 2 — Railway (בקנד)

1. פתח פרויקט ב-[railway.app](https://railway.app) → Deploy from GitHub repo.
2. **אין צורך בהגדרות build** — `railway.json` בשורש הריפו מפנה את Railway ל-`backend/Dockerfile`,
   שבונה את הבקנד בלבד (כולל health check על `/health` והאזנה ל-`$PORT`).
   השאר את Root Directory ריק (ברירת המחדל). הפרונט נפרס בנפרד ב-Vercel (שלב 3).
3. **Variables** — הגדר:

   | משתנה | ערך |
   |--------|-----|
   | `ENVIRONMENT` | `production` |
   | `SUPABASE_URL` | משלב 1 |
   | `SUPABASE_ANON_KEY` | משלב 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | משלב 1 (סודי!) |
   | `RIVHIT_API_TOKEN` | הטוקן מחשבון Rivhit |
   | `RIVHIT_API_BASE_URL` | `https://online.rivhit.co.il/api/v3` (לאמת מול התיעוד) |
   | `RIVHIT_WRITE_ENABLED` | `false` — ⚠️ מדליקים רק אחרי שהסנכרון אומת! |
   | `SYNC_ENABLED` | `true` |
   | `ALLOWED_ORIGINS` | הדומיין של הפרונט (משלב 3), למשל `https://ai-assistant-seven-theta.vercel.app` (כבר בברירת המחדל בקוד) |
   | `RESEND_API_KEY` + `ADMIN_NOTIFICATION_EMAIL` | משלב 4 |
   | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | משלב 5 |

4. Deploy → העתק את ה-URL הציבורי (למשל `https://kerem-orders.up.railway.app`).

## שלב 3 — Vercel (פרונט)

1. ב-[vercel.com](https://vercel.com): Import מהריפו → **Root Directory: `frontend`** (זיהוי Vite אוטומטי).
2. Environment Variables:
   - `VITE_API_URL` = ה-URL של Railway משלב 2
   - `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon בלבד — לעולם לא service_role!)
3. Deploy → קבל דומיין → חזור ל-Railway ועדכן `ALLOWED_ORIGINS`, ול-Supabase ועדכן Site URL.

## שלב 4 — Resend (אימייל)

1. [resend.com](https://resend.com) → API Key → `RESEND_API_KEY` ב-Railway.
2. `ADMIN_NOTIFICATION_EMAIL` = המייל של אבא.
3. לשליחה מדומיין משלך: אמת דומיין ב-Resend ועדכן `EMAIL_FROM`.

## שלב 5 — Telegram

1. כתוב ל-[@BotFather](https://t.me/BotFather) → `/newbot` → קבל טוקן → `TELEGRAM_BOT_TOKEN`.
2. אבא שולח הודעה כלשהי לבוט.
3. גלוש ל-`https://api.telegram.org/bot<TOKEN>/getUpdates` → העתק `chat.id` → `TELEGRAM_CHAT_ID`.

## שלב 6 — אימות ראשון (לפי הסדר!)

1. **בדיקות עשן:** `./backend/scripts/smoke.sh https://ה-URL-של-Railway` — הכל ירוק.
2. התחבר כאדמין → **סנכרון** → "תצוגה מקדימה (dry-run)" → בדוק שהמוצרים והלקוחות נראים נכון.
   - אם שמות שדות לא מסתדרים — מתקנים רק את המיפוי ב-`rivhit_service.py` (`_map_product`/`_map_customer`).
3. סנכרון אמיתי → בדוק את הקטלוג.
4. הזמן לקוח אמיתי (מסך לקוחות → הזמן במייל) → הלקוח מבצע הזמנת ניסיון.
5. ודא שהגיעו Email + Telegram.
6. **רק עכשיו**: `RIVHIT_WRITE_ENABLED=true` ב-Railway → צור הצעת מחיר להזמנת הניסיון → ודא שהמסמך נכון בחשבון Rivhit.

## גיבויים ושחזור

- Supabase מגבה אוטומטית (יומי). לפני migration גדול: Database → Backups → גיבוי ידני.
- Rollback: ב-Vercel/Railway — Deployments → גרסה קודמת → Redeploy (קליק אחד).
- Logs: Railway (בקנד) + Supabase (DB) — ברירת מחדל מספקת.

## CI

כל push מריץ אוטומטית (GitHub Actions): 100 בדיקות בקנד, בדיקות RLS על PostgreSQL אמיתי, lint+build לפרונט. אל תמזג כשהCI אדום.
