# INTEGRATIONS.md — אינטגרציות מתוכננות

> **סטטוס: מתוכנן (PLANNED) — לא ממומש.** אין בקוד שום קריאה ל-Google Calendar, ל-Supabase Sync או ל-FCM.
> לא נוצר שום פרויקט ענן, OAuth client או חשבון. האפליקציה היא offline-first ותישאר שמישה במלואה בלי אף אחת מהן.
> כל אינטגרציה תהיה **opt-in** מפורש בהגדרות, ניתנת לניתוק, ותמחק את הנתונים המקומיים שלה בניתוק.

עקרונות משותפים:
- הרשאות מינימליות, ובהדרגה (incremental authorization) — מבקשים רק כשהמשתמש מפעיל את התכונה.
- טוקנים רק ב-`SecureStore` (Keystore); **לעולם לא בלוגים**, לא ב-crash reports, לא ב-BuildConfig.
- אין סודות ב-APK: OAuth client של Android הוא ציבורי (מזוהה לפי package + SHA-1), ולא דורש client secret.
- כל סנכרון רץ ב-WorkManager עם constraints (רשת, סוללה), עם backoff, ונכשל בשקט אל מצב מקומי תקין.

---

## 1. Google Calendar (מתוכנן)

### 1.1 מטרה
- **שלב 1 (קריאה בלבד):** הצגת אירועי היומן ב"היום שלי" כדי שהמתכנן והמאמן יראו חלונות פנויים. (לאירועים לא נשלחים
  למאמן אלא אם המשתמש הפעיל זאת בנפרד; גם אז — רק "תפוס 10:00–11:00", בלי כותרות.)
- **שלב 2 (כתיבה מוגבלת):** משימה עם שעה ניתנת ל"הוספה ליומן"; האפליקציה עורכת/מוחקת **רק אירועים שהיא יצרה**.

### 1.2 אימות והרשאות
- **Credential Manager** (`androidx.credentials`) לזיהוי חשבון Google (Sign in with Google), ו-**`AuthorizationClient`**
  (`Identity.getAuthorizationClient(context).authorize(AuthorizationRequest…)`) לבקשת scope — הזרם המומלץ במקום
  GoogleSignIn שהוצא משימוש.
- שלב 1: scope `https://www.googleapis.com/auth/calendar.events.readonly` בלבד.
- שלב 2: `https://www.googleapis.com/auth/calendar.events` — מבוקש רק כשהמשתמש מקיש לראשונה "הוסף ליומן".
  (אין דרך ב-Calendar API להגביל scope לאירועים שהאפליקציה יצרה; לכן הגבלה זו נאכפת בקוד — ראו 1.3.)
- access token קצר-מועד מתקבל מ-`AuthorizationResult` לפי דרישה; לא נשמר refresh token בצד לקוח (Google מנהל זאת
  דרך Play services). ביטול: "נתק" בהגדרות + `revokeAccess` + מחיקת המטמון המקומי.
- `Authorization: Bearer` רק ל-`www.googleapis.com`; אין לוגים של כותרות/גוף.

### 1.3 מיפוי דו-כיווני (שלב 2)
| כלל | פירוט |
|---|---|
| זיהוי בעלות | כל אירוע שהאפליקציה יוצרת מקבל `extendedProperties.private.disciplineTaskId=<uuid מקומי>`; עריכה/מחיקה רק אם הסימון קיים |
| משימה → אירוע | `title`→`summary`, `date+time`→`start`, `estimatedMinutes` (ברירת מחדל 30)→`end`, אזור זמן של המכשיר; תיאור: קישור עמוק בלבד, ללא תת-משימות |
| אירוע → משימה | רק לאירועים בבעלות האפליקציה: שינוי שעה/תאריך ביומן ⇒ עדכון `date/time` במשימה. מחיקה ביומן ⇒ המשימה **לא** נמחקת; רק מנותקת מהאירוע (+הודעה) |
| אירועים זרים | לעולם לא הופכים אוטומטית למשימות; רק "ייבא כמשימה" ידני |
| קונפליקט | `updated` של האירוע מול `updatedAt` של המשימה — המאוחר גובר, לשדות זמן בלבד; כותרת במשימה גוברת תמיד |
| סנכרון | `events.list` עם `syncToken` (אינקרמנטלי), טווח היום−7 עד +30; 410 Gone ⇒ סנכרון מלא מחדש |
| חזרתיות | משימות חוזרות לא מיוצאות כ-RRULE בשלב 2 (מופע בודד בלבד) — מונע אי-התאמות בין מנוע החזרתיות ליומן |

### 1.4 מה נדרש מהאדם (לא בוצע)
1. חשבון Google + **פרויקט Google Cloud משלו** (נוצר על ידו, לא על ידינו).
2. הפעלת Google Calendar API בפרויקט.
3. מסך הסכמה OAuth (OAuth consent screen): שם, מדיניות פרטיות, scopes. `calendar.events` הוא scope רגיש ⇒ ייתכן
   **אימות אפליקציה (verification) של Google** לפני פרסום ציבורי; עד אז מצב Testing עם עד 100 משתמשי בדיקה.
4. יצירת **OAuth client מסוג Android**: package `com.disciplineos.app` (+ `.debug` ל-debug) ו-SHA-1 של מפתח החתימה
   (debug/upload/Play App Signing). אין client secret — אין מה לשמור בריפו.
5. אין חיוב (Calendar API ללא עלות במכסות רגילות).

---

## 2. סנכרון Supabase (אופציונלי, מתוכנן)

### 2.1 מטרה
גיבוי וסנכרון בין מכשירים של משימות/רצפים/סשנים, **מקומי-תחילה**: Room נשאר מקור האמת, השרת הוא העתק.

### 2.2 מודל נתונים בשרת
- טבלאות מקבילות (`tasks`, `subtasks`, `focus_sessions`, `settings`) עם `user_id uuid`, `id uuid` (נוצר בלקוח),
  `updated_at timestamptz`, `field_clock jsonb` (חותמת לכל שדה), `deleted_at timestamptz` (tombstone), `device_id`.
- **RLS לכל טבלה**: `using ((select auth.uid()) = user_id)` ו-`with check` זהה, לכל הפעולות. אין גישת anon.
- ללא `service_role` בלקוח, לעולם.

### 2.3 אסטרטגיית קונפליקטים (end-to-end)
1. כל שינוי מקומי מעדכן `updatedAt` של השדה ב-`field_clock` (שעון היברידי: `max(now, last+1)` כדי לחסום סטיית שעון)
   ונכנס לטבלת outbox.
2. **Push**: שליחת outbox באצוות דרך RPC (`sync_push`) שמבצע **Last-Writer-Wins לכל שדה**: לכל שדה נבחר הערך עם
   החותמת המאוחרת; שוויון ⇒ `device_id` לקסיקוגרפי (דטרמיניסטי).
3. **Pull**: `select … where updated_at > :cursor` (כולל tombstones), מיזוג באותו כלל LWW לכל שדה, עדכון cursor.
4. **מחיקות**: tombstone (`deleted_at`) שגובר על כל עריכה ישנה יותר ממנו; ניקוי tombstones אחרי 30 יום מכל המכשירים
   שסונכרנו (מכשיר שלא סונכרן 30 יום ⇒ סנכרון מלא).
5. **השלמת משימה וצבירת XP**: אירועים append-only (`completion_events`) — לא LWW — כדי שהשלמה בשני מכשירים לא תאבד
   ולא תוכפל (מפתח ייחודי `task_id+occurrence_date`).
6. רשימות (תת-משימות): ישות לכל פריט עם `position` חלקי (fractional index) כדי להימנע מקונפליקט על כל המערך.

### 2.4 הצפנה בצד לקוח (אופציונלי)
- כותרות/הערות מוצפנות ב-AES-256-GCM לפני העלאה; מפתח נגזר מ-passphrase של המשתמש (Argon2id/PBKDF2) או נוצר אקראית
  ומגובה ב-recovery code שמוצג פעם אחת. השרת רואה ciphertext בלבד.
- מחיר: אין חיפוש/מאמן בצד שרת על כותרות מוצפנות; אובדן passphrase = אובדן כותרות. מונים ותאריכים נשארים גלויים לצורך מיזוג.

### 2.5 מה נדרש מהאדם (לא בוצע)
- חשבון Supabase ופרויקט (אפשר אותו פרויקט של שרת המאמן), אזור אחסון (מומלץ EU לפרטיות), החלטה על Auth (anonymous +
  קישור מאוחר לחשבון email/Google — "linking" — כדי לא לאבד נתונים).
- מדיניות פרטיות ותנאי שימוש, ויכולת "מחק את החשבון והנתונים בשרת".
- חיוב: Free tier מספיק לבדיקות; ייצור — תוכנית בתשלום לפי נפח/MAU, גיבויים, ו-Point-in-Time Recovery אם נדרש.

---

## 3. Push (FCM, אופציונלי, מתוכנן)

### 3.1 למה אופציונלי
התזכורות ממילא **מקומיות** (WorkManager/AlarmManager) ועובדות בלי רשת. Push נדרש רק לתרחישים שבאים מבחוץ:
סנכרון "יש שינוי במכשיר אחר" (silent/data message שמעיר את ה-Worker), או הודעת שרת. FCM מוסיף תלות ב-Google Play
services, ב-`google-services.json` ובפרויקט Firebase — לכן לא נכלל ב-build ברירת המחדל (`google-services.json` כבר מוחרג ב-git).

### 3.2 עיצוב
- **מטען מינימלי**: data message בלבד, `{ "t": "sync" }` — ללא כותרות משימות, ללא טקסט מאמן, ללא מזהי משתמש. התוכן
  נמשך מהשרת בערוץ המאומת אחרי ההתעוררות. הודעות notification עם תוכן — רק טקסט כללי ("יש עדכון").
- FCM registration token נשמר בשרת בטבלה עם RLS (`user_id`, `token`, `updated_at`), נמחק בניתוק/מחיקת נתונים;
  לא נשמר בלוגים.
- שליחה רק מהשרת (Edge Function עם credentials של Service Account מאוחסנים כ-secret בשרת), לעולם לא מהאפליקציה.
- `POST_NOTIFICATIONS` (Android 13+) מבוקש רק כשהמשתמש מפעיל התראות.

### 3.3 מה נדרש מהאדם (לא בוצע)
- חשבון Google + פרויקט Firebase (משלו), רישום אפליקציית Android (package + SHA-1), הורדת `google-services.json`
  (לא נשמר בריפו — מוזרק ב-CI כסוד), Service Account לשליחה (key או Workload Identity) שמור ב-`supabase secrets`.
- FCM ללא עלות; הצהרה ב-Data Safety של Google Play על איסוף device token.

---

## 4. סיכום דרישות מהאדם

| אינטגרציה | חשבונות | אישורים/בדיקות | חיוב | סודות (איפה) |
|---|---|---|---|---|
| שרת מאמן (`backend/`) | Supabase, Anthropic Console | — | Anthropic לפי שימוש; Supabase free/paid | `ANTHROPIC_API_KEY` ב-`supabase secrets` |
| Google Calendar | Google Cloud | OAuth consent; verification ל-scope רגיש | אין | אין (Android client ציבורי) |
| Supabase Sync | Supabase | מדיניות פרטיות, מחיקת חשבון | לפי נפח בייצור | אין בלקוח; anon key ציבורי |
| FCM Push | Firebase | Data Safety ב-Play | אין | Service Account בשרת; `google-services.json` ב-CI |
