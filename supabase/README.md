# Supabase — מסד הנתונים של Kerem Orders

## 🚀 התקנה בפרויקט Supabase אמיתי (פעולה חד-פעמית של אורי)

1. פתח פרויקט ב-[supabase.com](https://supabase.com) (region: Frankfurt — הקרוב לישראל).
2. ב-Dashboard → **SQL Editor** → הדבק את **כל** התוכן של
   `migrations/` — **את כל הקבצים, לפי סדר השמות** → Run.
3. ב-**Project Settings → API** העתק:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (סודי! לבקנד בלבד)
4. הגדר את שלושת הערכים ב-`backend/.env` (ובסביבת הענן — ב-env vars).

⚠️ **אל תריץ את הקבצים שב-`tests/` על Supabase אמיתי** — הם stub מקומי לבדיקות בלבד.

## 🧪 בדיקות RLS מקומיות (רצות על PostgreSQL 16)

הבדיקות מאמתות את בידוד הנתונים (A4, A6, O7) על DB אמיתי, בלי לגעת ב-Supabase:

```bash
sudo -u postgres psql -c "DROP DATABASE IF EXISTS kerem_test;" -c "CREATE DATABASE kerem_test;"
sudo -u postgres psql -d kerem_test -v ON_ERROR_STOP=1 \
    -f supabase/tests/auth_stub.sql \
    -f supabase/migrations/20260612000000_init.sql \
    -f supabase/migrations/20260612000001_invite_linking.sql \
    -f supabase/migrations/20260612000002_harden_writes.sql \
    -f supabase/tests/test_rls.sql
```

פלט תקין: 21 שורות `✅ עבר` ובסוף `🎉 כל בדיקות ה-RLS עברו בהצלחה`.

## 🔧 תיקונים שבוצעו ביחס לאפיון המקורי

| בעיה באפיון | התיקון |
|--------------|--------|
| ה-policies הפנו ל-`profiles` מתוך policy של `profiles` → **רקורסיה אינסופית** ב-Supabase | פונקציית `is_admin()` מסוג `SECURITY DEFINER` שעוקפת RLS בבדיקת התפקיד |
| חסר `ENABLE ROW LEVEL SECURITY` — בלעדיו ה-policies **לא פעילים כלל** | נוסף לכל 7 הטבלאות |
| לקוח יכול היה ליצור הזמנה על שם לקוח אחר (`customer_id` חופשי) | policy ה-INSERT מאמת שה-`customer_id` שייך ללקוח המקושר אליו |
| לקוח יכול היה לעדכן את ה-`role` של עצמו ל-admin | trigger `protect_profile_fields` חוסם שינוי `role`/`status`/`rivhit_customer_id` |
| לא היה profile אוטומטי בהרשמה | trigger `handle_new_user` על `auth.users` |
| `updated_at` לא התעדכן | trigger `set_updated_at` על כל הטבלאות הרלוונטיות |
