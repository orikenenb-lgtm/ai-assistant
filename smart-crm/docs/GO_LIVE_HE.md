# מדריך העלאה לאוויר — SMART CRM AI

מדריך צעד-אחר-צעד להקמת המערכת על חשבונות אמיתיים.
הסדר חשוב: כל שלב משתמש בערכים מהשלב הקודם.
**אל תשלחו מפתחות וסיסמאות בצ'אט** — מדביקים אותם רק בהגדרות של Vercel / Railway.

---

## שלב 0 — לפני שמתחילים

1. **למזג את ה-PR** של SMART CRM ל-`main` ב-GitHub (PR #10).
   Vercel בונה את ענף `main`, והתיקייה `smart-crm` קיימת רק אחרי המיזוג.
2. להכין שני מפתחות סודיים. ב-PowerShell, להריץ **פעמיים** (פעם לכל מפתח):

```powershell
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

- התוצאה הראשונה = `ENCRYPTION_KEY` — **לשמור גם בגיבוי** (מנהל סיסמאות). בלעדיה אי אפשר לפענח טוקנים שנשמרו במערכת.
- התוצאה השנייה = `CRON_SECRET`

---

## שלב 1 — Supabase (מסד נתונים, התחברות, קבצים)

1. ב-[supabase.com](https://supabase.com) → **New project**
   - שם: `smart-crm`
   - אזור: **Central EU (Frankfurt)** — הכי קרוב לישראל
   - סיסמת מסד נתונים חזקה — לשמור
2. כשהפרויקט מוכן: **SQL Editor → New query**, להדביק את כל התוכן של הקובץ:

```
smart-crm/supabase/deploy/all-migrations.sql
```

   וללחוץ **Run**. זה יוצר את כל הטבלאות, ההרשאות וה-RLS בפעולה אחת (הכל או כלום).
   הצלחה = ההודעה `Success. No rows returned`.
3. **Authentication → URL Configuration**
   - Site URL: הכתובת של האתר ב-Vercel (אחרי שלב 3 — אפשר לחזור לכאן)
   - Redirect URLs: להוסיף `https://<הכתובת שלכם>/auth/confirm`
4. **Authentication → Emails → Templates** — בשתי התבניות להחליף את הקישור:
   - **Confirm signup**:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

   - **Reset password**:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

5. **Authentication → Emails → SMTP Settings** — לחבר את Resend (שלב 2).
   בלי זה Supabase שולח רק כמה מיילים בשעה.
6. **Authentication → Multi-Factor** — להפעיל **TOTP**.
7. לאסוף ערכים (בכפתור **Connect** ובהגדרות ה-API של הפרויקט):
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**סודי!**)
   - Connect → **Transaction pooler** (פורט 6543) → `DATABASE_URL` (להכניס בו את סיסמת המסד)

---

## שלב 2 — Resend (מיילים)

1. ב-[resend.com](https://resend.com) → **Domains → Add domain** — הדומיין של העסק,
   ולהוסיף את רשומות ה-DNS שהם נותנים (SPF / DKIM) אצל ספק הדומיין.
2. **API Keys → Create** → `RESEND_API_KEY`
3. כתובת השולח, למשל: `SMART CRM <no-reply@הדומיין-שלכם>` → `EMAIL_FROM`
4. ב-Supabase (שלב 1.5): SMTP Host `smtp.resend.com`, Port `465`, User `resend`, Password = ה-API key.

---

## שלב 3 — Vercel (האתר)

1. ב-[vercel.com](https://vercel.com) → **Add New → Project** → לבחור את הריפו `ai-assistant`.
2. **Root Directory**: `smart-crm` (חשוב!). Framework: Next.js.
3. **Environment Variables** — להדביק (הערכים מהשלבים הקודמים):

```
APP_ENV=production
APP_URL=https://<הכתובת שלכם>
DATABASE_URL=<Transaction pooler>
ENCRYPTION_KEY=<משלב 0>
CRON_SECRET=<משלב 0>
AUTH_PROVIDER=supabase
NEXT_PUBLIC_SUPABASE_URL=<משלב 1>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<משלב 1>
SUPABASE_SERVICE_ROLE_KEY=<משלב 1>
STORAGE_PROVIDER=supabase
EMAIL_PROVIDER=resend
RESEND_API_KEY=<משלב 2>
EMAIL_FROM=<משלב 2>
AI_PROVIDER=mock
WHATSAPP_PROVIDER=mock
BILLING_PROVIDER=mock
BILLING_LIVE_MODE=false
```

   (`AI` ו-`WhatsApp` נשארים במצב הדגמה עד שלבים 6–7.)
4. **Deploy**. אחרי שעולה — לעדכן את `APP_URL` לכתובת האמיתית ולעשות Redeploy,
   ולחזור ל-Supabase (שלב 1.3) לעדכן את ה-Site URL.
5. בדיקה: לפתוח `https://<הכתובת>/api/health` — צריך לראות `"status":"ok"`.

> ה-Cron של Vercel מוגדר לרוץ פעם ביום (מתאים לתוכנית החינמית).
> בתוכנית Pro אפשר לשנות ב-`smart-crm/vercel.json` ל-`* * * * *` (כל דקה).

---

## שלב 4 — Worker ב-Railway (משימות רקע בזמן אמת)

ה-worker שולח הודעות WhatsApp, מריץ אוטומציות, תזכורות, Webhooks וניקוי נתונים.
**בלעדיו משימות רקע רצות רק פעם ביום.**

1. ב-Railway, באותו פרויקט של Kerem Orders או בחדש → **New → GitHub Repo** → `ai-assistant`.
2. בהגדרות השירות החדש:
   - **Root Directory**: `smart-crm`
   - **Config file path** (Config-as-code): `smart-crm/railway.worker.json`
3. **Variables** — **אותם משתנים בדיוק** כמו ב-Vercel.
4. Deploy. בלוג צריך להופיע `worker started`.

> הערה כנה: פקודת ה-worker נבדקה (עולה, מריצה משימות ונסגרת מסודר),
> אבל בניית ה-Docker image עצמה לא נבדקה בסביבה שלי (אין בה Docker).
> אם הבנייה נכשלת — לשלוח לי את הלוג.

---

## שלב 5 — חשבון ראשון והרשאות

1. להירשם באתר עם המייל שלכם, לאשר את המייל, ליצור את הארגון "כרם טויס".
2. ב-Supabase → **SQL Editor**, להפוך את עצמכם למנהל פלטפורמה:

```sql
update public.profiles set is_super_admin = true where email = 'המייל-שלכם';
```

3. באתר: **חשבון → אבטחה → להפעיל MFA** (חובה למנהל פלטפורמה), להתנתק ולהתחבר מחדש.
4. **שימוש פנימי (בלי Stripe)**: להיכנס ל-`/admin` → הארגון → לקבוע חבילה **Business**
   (או להאריך את תקופת הניסיון). כך כל הפיצ'רים פתוחים בלי מערכת תשלום.

---

## שלב 6 — AI (OpenAI)

1. ב-[platform.openai.com](https://platform.openai.com) → API Keys → מפתח חדש.
   מומלץ להגדיר **מגבלת הוצאה חודשית** (Billing → Limits).
2. ב-Vercel וב-Railway: `AI_PROVIDER=openai`, `OPENAI_API_KEY=<המפתח>` → Redeploy.

---

## שלב 7 — WhatsApp (Meta) — לוקח הכי הרבה זמן, כדאי להתחיל מוקדם

1. **Meta Business**: אימות העסק (Business Verification) — יכול לקחת כמה ימים.
2. [developers.facebook.com](https://developers.facebook.com) → אפליקציה חדשה → מוצר **WhatsApp**,
   מספר טלפון ייעודי ומאומת.
3. **System User** קבוע עם הרשאות `whatsapp_business_messaging` + `whatsapp_business_management` → טוקן קבוע.
4. **App Secret** (הגדרות האפליקציה) → `META_APP_SECRET`.
   לבחור מחרוזת אקראית → `META_WEBHOOK_VERIFY_TOKEN`.
5. ב-Vercel וב-Railway: `WHATSAPP_PROVIDER=meta` + שני הערכים → Redeploy.
6. ב-Meta → WhatsApp → Configuration:
   - Callback URL: `https://<הכתובת>/api/webhooks/whatsapp`
   - Verify token: אותו ערך כמו `META_WEBHOOK_VERIFY_TOKEN`
   - להירשם לשדה `messages`
7. באתר: **הגדרות → WhatsApp → חיבור מספר** (Phone number ID, WABA ID, הטוקן) → בדיקת חיבור → סנכרון תבניות.
8. ליצור ב-Meta **תבניות הודעה** ולחכות לאישור — בלעדיהן אי אפשר לפנות ללקוח אחרי 24 שעות.
9. הודעה ראשונה — **למספר פנימי שלכם** לבדיקה.

---

## אופציונלי

- **Stripe** — רק אם מוכרים את המערכת לעסקים אחרים. חיוב אמיתי דורש `BILLING_LIVE_MODE=true` — לא להפעיל בלי החלטה מסודרת.
- **Google Calendar** — סנכרון יומן (OAuth של Google + דגל `calendar.sync` ב-`/admin/flags`).
- **Morning / iCount** — הפקת חשבוניות מס אמיתיות.

---

## צ'קליסט בדיקה אחרי העלייה

- [ ] `/api/health` מחזיר `ok`
- [ ] הרשמה → מייל אימות מגיע → התחברות
- [ ] הזמנת עובד → מייל מגיע → הצטרפות
- [ ] יצירת איש קשר, עסקה, משימה, הצעת מחיר + PDF
- [ ] אוטומציה פשוטה: לפרסם ולוודא שרצה (היסטוריית הרצות)
- [ ] (אחרי שלב 7) הודעת WhatsApp נכנסת מופיעה בתיבה, ותשובה יוצאת

פירוט טכני נוסף: `docs/DEPLOYMENT.md`, `docs/PRODUCTION_READINESS.md`.
