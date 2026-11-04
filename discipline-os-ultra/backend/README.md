# backend/ — שרת ה-AI של המאמן (מימוש ייחוס, לא פרוס)

> **סטטוס:** קוד ייחוס בלבד. צוות הפיתוח **לא** יצר פרויקט ענן, **לא** פרס, ו**לא** השתמש בשום חשבון או מפתח.
> האפליקציה עובדת במלואה **בלי** השרת הזה (המאמן המקומי `LocalDemoCoachProvider`). כל הצעדים למטה הם צעדים
> שאדם (בעל הפרויקט) מריץ בעצמו, בחשבונות שלו, אם וכאשר יחליט.

## מה יש כאן

| קובץ | תפקיד |
|---|---|
| `supabase/functions/coach-stream/index.ts` | Edge Function (Deno): אימות JWT של Supabase, מכסה, סניטציה, קריאה סטרימינג ל-Claude, תרגום ל-SSE, אימות פעולות בצד שרת |
| `supabase/migrations/0001_coach_usage.sql` | טבלת `coach_usage` + RLS + פונקציה אטומית `consume_coach_quota` (service role בלבד) |
| `.env.example` | שמות משתני סביבה עם placeholders בלבד |

## החוזה מול האפליקציה

```
POST {AI_BACKEND_URL}/v1/coach/stream
Authorization: Bearer <Supabase access token>
{ "messages":[{"role":"user","text":"..."}], "context":{...}, "locale":"he" }

200 text/event-stream
event: delta   data: {"text":"..."}
event: action  data: {"json":{"type":"create_task","title":"...","kind":"OPTIONAL","priority":"MEDIUM"}}
event: error   data: {"kind":"backend_unavailable"}
event: done    data: {}

401 → NOT_CONFIGURED · 402 → QUOTA_EXCEEDED · 429 → RATE_LIMITED · 5xx/רשת → BACKEND_UNAVAILABLE/OFFLINE
```

`AI_BACKEND_URL` של האפליקציה הוא כתובת הפונקציה: `https://<PROJECT_REF>.supabase.co/functions/v1/coach-stream`
(האפליקציה מוסיפה בעצמה `/v1/coach/stream`). זו כתובת ציבורית — **לא** סוד.

## פריסה — צעדים שהאדם מריץ (לא בוצעו)

דרישות: חשבון Supabase, חשבון Anthropic Console עם חיוב (billing) פעיל, Supabase CLI מותקן.

```bash
# 1. התחברות וקישור לפרויקט שלך (נוצר על ידך בדשבורד של Supabase)
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>

# 2. הפעלת Anonymous Sign-ins: Dashboard → Authentication → Providers → Anonymous → Enable
#    (מומלץ גם להפעיל CAPTCHA / Turnstile על anonymous sign-in כדי לבלום יצירת משתמשים אוטומטית)

# 3. החלת המיגרציה (טבלת מכסה + RLS)
supabase db push

# 4. סודות — placeholders בלבד; הערך האמיתי מוקלד על ידך ולא נשמר בריפו
supabase secrets set ANTHROPIC_API_KEY=<YOUR_KEY>
supabase secrets set COACH_MODEL=claude-sonnet-5-5 COACH_MAX_TOKENS=1500 COACH_DAILY_LIMIT=30

# 5. פריסה (verify_jwt נשאר פעיל — שכבת אימות נוספת ב-gateway)
supabase functions deploy coach-stream

# 6. בניית האפליקציה מול השרת (כתובת בלבד, לא מפתח):
./gradlew :app:assembleRelease -Pdiscipline.aiBackendUrl=https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/coach-stream
```

בדיקה מקומית (אופציונלי): `supabase start` ואז
`supabase functions serve coach-stream --env-file backend/.env` (קובץ `.env` אמיתי — מוחרג ב-git).
באמולטור, build debug מתיר `http://10.0.2.2:54321/functions/v1/coach-stream` בלבד
(נדרש גם `network_security_config` של debug שמתיר cleartext ל-10.0.2.2 — באחריות בעל ה-Manifest).

### פער ידוע: החלפת טוקן
האפליקציה שולחת כרגע **מזהה התקנה אקראי** (`AnonymousInstallTokenProvider`) — הוא **אינו** JWT של Supabase,
ולכן שרת זה יחזיר 401 והאפליקציה תציג "לא מוגדר" ותמשיך עם המאמן המקומי. לפני הפעלה אמיתית יש לממש ב-app
החלפה של המזהה ל-access token קצר-מועד דרך Supabase **anonymous sign-in** (`POST /auth/v1/signup` עם ה-anon key
הציבורי), שמירת ה-refresh token ב-`SecureStore`, ורענון לפני פקיעה — מאחורי הממשק `BackendTokenProvider`.
זה לא מומש בכוונה (אין שום התחברות לחשבון בגרסה זו).

## בקרת עלויות

| בקרה | ברירת מחדל | איפה |
|---|---|---|
| מכסה יומית למשתמש | 30 בקשות/יום (UTC) → 402 | `COACH_DAILY_LIMIT`, טבלת `coach_usage` |
| הגבלת פרץ | 5 בקשות / 60 שניות → 429 | `COACH_BURST_LIMIT`, `COACH_BURST_WINDOW_SECONDS` |
| תקרת פלט | `max_tokens` 1500 (כולל חשיבה), חסום ל-4000 | `COACH_MAX_TOKENS` |
| עומק חשיבה | `effort: low` (מתאים לצ'אט) | `COACH_EFFORT` |
| תקרת קלט | גוף ≤ 32KB, ≤ 12 הודעות × 2000 תווים, ≤ 30 כותרות × 120 | קבועים ב-`index.ts` |
| מודל | `claude-sonnet-5-5` ($2 / $10 למיליון טוקנים קלט/פלט, נכון לכתיבה) | `COACH_MODEL` |
| מכסה בצד לקוח | `AiPrivacySettings.dailyMessageLimit` + `CostGuard` | אפליקציה (לא תחליף לשרת) |

המלצות נוספות לאדם: הגדרת **spend limit** חודשי ב-Anthropic Console ל-workspace ייעודי עם מפתח ייעודי;
התראות שימוש; סיבוב (rotation) מפתח תקופתי. הערכה גסה: בקשה טיפוסית ≈ 1.5K טוקני קלט + ≤1.5K פלט ≈ פחות
מ-2 סנט; 30 בקשות × משתמש פעיל ביום הוא תקרת העלות היומית למשתמש.

`COACH_REFUSAL_FALLBACK` (ברירת מחדל: on) — כש-Claude מסרב מטעמי בטיחות, ה-API יכול להמשיך את אותה בקשה
על מודל חלופי (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). החיוב לפי המודל החלופי.
`COACH_REFUSAL_FALLBACK=off` מכבה.

## הערות איומים (תקציר — המלא ב-`docs/AI_SECURITY.md`)

- **הזרקת פרומפט** דרך כותרות משימות/הודעות: בלוקים מתוחמים עם nonce לכל בקשה, סינון תווי בקרה/bidi, פרומפט
  מערכת קבוע, ופעולות רק דרך כלים strict + אימות allow-list בשרת + אישור מפורש של המשתמש באפליקציה.
- **דליפת מפתח:** המפתח רק ב-`supabase secrets`; אין מפתח ב-APK, בריפו או בלוגים.
- **עלות מופרזת / ניצול:** JWT חובה, מכסה אטומית ב-Postgres (fail-closed אם הבדיקה נכשלת), max_tokens, ו-CAPTCHA
  מומלץ על anonymous sign-in (אחרת תוקף יכול ליצור משתמשים אנונימיים רבים ולעקוף מכסה פר-משתמש).
- **פרטיות:** הפונקציה לא שומרת ולא מתעדת תוכן הודעות; ביומן רק מונים/סטטוסים. ספק המודל מעבד את התוכן לפי
  תנאיו — יש לציין זאת במדיניות הפרטיות לפני הפעלה.
- **דפדפנים:** אין CORS; כל בקשה עם `Origin` נדחית (403). הלקוח היחיד הוא האפליקציה.
