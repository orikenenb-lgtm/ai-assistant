# SECURITY — DISCIPLINE OS ULTRA

מסמך זה מרכז את מודל האיומים והבקרות. פירוט נוסף: `docs/AI_SECURITY.md` (AI Coach), `docs/DATABASE.md` (אחסון ופרטיות), `docs/BLOCKER_LIMITATIONS.md` (גבולות האכיפה).

## דיווח על בעיית אבטחה
אין לפתוח issue ציבורי עם פרטי חולשה. יש לפנות לבעלי הריפו באופן פרטי.

## נכסים
| נכס | רגישות | היכן |
|---|---|---|
| משימות, הערות, היסטוריה | אישי | Room (מכשיר בלבד) |
| רשימת אפליקציות חסומות, זמן מסך | אישי/התנהגותי | Room + UsageStats (מכשיר בלבד) |
| היסטוריית צ'אט עם המאמן | אישי | Room (מכשיר בלבד) |
| מזהה התקנה לבקאנד | סוד קטן | DataStore מוצפן AES-GCM, מפתח ב-Android Keystore |
| מפתח Anthropic API | סוד | **רק** כ-secret בבקאנד (env). לעולם לא ב-APK או בריפו |

## מודל איומים (STRIDE מקוצר)
| איום | תרחיש | בקרה |
|---|---|---|
| חשיפת מידע — גיבוי ענן | נתונים אישיים עוברים לגיבוי Google | `allowBackup=false` + `data_extraction_rules` שמחריגים הכל; ייצוא ידני בלבד |
| חשיפת מידע — לוגים | כותרות משימות / חבילות נכתבות ל-logcat | מדיניות: אין לוג של תוכן אישי; ב-scope האפליקציה נרשם רק שם מחלקת החריגה |
| חשיפת מידע — AI | רשימת אפליקציות או זמן מסך נשלחים למודל | `shareAppUsage=false` כברירת מחדל; הקשר מינימלי; הספק המרוחק כבוי כברירת מחדל ודורש URL מוגדר + opt-in |
| Prompt injection | כותרת משימה או הודעה מנסה לגרום למודל לבצע פעולה | `PromptInjectionGuard` (ניקוי bidi/תווי בקרה, סימון דפוסים), עטיפת נתונים כ-untrusted בבקאנד, allow-list קשיח ב-`CoachActionValidator` בצד הלקוח **ובצד השרת**, ואישור מפורש של המשתמש לכל כתיבה |
| הסלמת עלויות | ניצול הבקאנד לשליחת הודעות רבות | `CostGuard` בלקוח, quota יומי לכל משתמש ב-Postgres, `max_tokens`, 429/402 |
| גניבת מפתח | מפתח API בתוך ה-APK | אין מפתחות ב-APK; `BuildConfig.AI_BACKEND_URL` בלבד; התחברות per-install |
| תעבורה לא מוצפנת | MITM | `network_security_config`: HTTPS בלבד, CAs של המערכת בלבד; cleartext רק ל-`10.0.2.2` ב-debug |
| רכיבים חשופים | אפליקציה זדונית מפעילה את מסך החסימה/receivers | כל הרכיבים `exported=false` מלבד ה-launcher ו-`BootReceiver` (שמקבל רק broadcasts מערכתיים); PendingIntent עם `FLAG_IMMUTABLE` |
| ייבוא גיבוי זדוני | קובץ JSON ענק או פגום | תקרת 5MB בקריאה זורמת, בדיקת `schemaVersion`, ולידציה של כל שדה, ייבוא בטרנזקציה (כישלון לא משנה נתונים) |
| שלילת שירות למשתמש | החוסם נועל את המשתמש בחוץ | חבילות מוגנות שלעולם לא נחסמות (טלפון, חירום, SMS, הגדרות, לאנצ'ר, מקלדת, התראות חירום, ניווט); שחרור חירום תמיד זמין; מצב התאוששות; כיבוי החוסם בלחיצה אחת; הסרת האפליקציה תמיד אפשרית |

## בקרות לפי שכבה
- **אחסון**: Room לא מוצפן (SQLCipher לא נכלל) — מסתמכים על File-Based Encryption של Android, sandbox של האפליקציה, ואי-גיבוי. סודות קטנים מוצפנים ב-Keystore.
- **הרשאות (least privilege)**: אין `QUERY_ALL_PACKAGES` (רק `<queries>` ל-launcher/dial/home), אין Device Admin, אין `USE_EXACT_ALARM`, אין `USE_FULL_SCREEN_INTENT`. `SCHEDULE_EXACT_ALARM` רק עד API 32 וגם אז עם fallback. Accessibility אופציונלי, עם גילוי והסכמה, `canRetrieveWindowContent=false`.
- **רשת**: OkHttp ייעודי ל-AI, ללא redirects, ללא retries, TLS 1.2+, ללא לוג גוף בקשה. אין רשת בשום מסלול אחר.
- **Build**: release עם R8, אין signing config בריפו, `.gitignore` חוסם keystores ו-`.env`.
- **Supply chain**: גרסאות מקובעות ב-version catalog; גרסאות Maven Central אומתו; גרסאות Google Maven נפתרו בהצלחה ב-CI. מומלץ להפעיל Dependabot/Renovate.

## סיכונים שנותרו (ידועים)
1. מסד הנתונים לא מוצפן ברמת האפליקציה.
2. אין certificate pinning לבקאנד (מתוכנן).
3. החלפת מזהה ההתקנה ב-JWT קצר-חיים (Supabase anonymous auth) לא מומשה — הספק המרוחק יחזיר 401 עד שתמומש.
4. Prompt injection מצומצם, לא מבוטל — לכן כל פעולה דורשת אישור אנושי.
5. משתמש עם root או ADB יכול לעקוף כל דבר — זה מכוון (האפליקציה היא כלי משמעת אישי, לא בקרת הורים).
