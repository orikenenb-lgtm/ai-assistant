# PLAN — תוכנית ביצוע וסטטוס שלבים

מקרא: ✅ הושלם ונבדק · 🟡 נכתב, אימות חלקי · ⛔ חסום · 📋 מתוכנן

| שלב | תוכן | סטטוס | הערות |
|---|---|---|---|
| Phase 0 | Audit סביבה | ✅ | JDK 21, Gradle 8.14.3. אין Android SDK/אמולטור. `dl.google.com` (ולכן Google Maven) חסום ב-sandbox → build של Android רק ב-CI. Maven Central עם rate-limit (429) → plugin portal כגיבוי. |
| Phase 1 | ארכיטקטורה ועיצוב | ✅ | `ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, חוזי domain כ-stubs שמתקמפלים |
| Phase 2 | Scaffolding | ✅ | Gradle KTS + version catalog, 3 מודולים, Manifest-חוזה, CI |
| Phase 3 | משימות + DB | 🟡 | מנוע משימות ✅ (106 בדיקות). Room/DataStore/WorkManager נכתבו; JVM tests לחלקים הטהורים ✅; instrumented לא הורצו |
| Phase 4 | מדיניות חסימה + אכיפה | 🟡 | מדיניות טהורה ✅ (73 בדיקות כולל focus). אכיפה ב-Android נכתבה + 41 בדיקות JVM ללוגיקה; לא נבדקה על מכשיר |
| Phase 5 | AI Coach | 🟡 | domain ✅ (מאמן דמו, guard, validator, conversation). ספק מרוחק + 27 בדיקות MockWebServer. Backend רפרנס — לא פרוס |
| Phase 6 | Focus / Gamification / Stats | 🟡 | domain ✅. UI נכתב; עזרי UI טהורים נבדקו |
| Phase 7 | אינטגרציות | 📋 | Google Calendar, Supabase sync, Push — תכנון בלבד (`docs/INTEGRATIONS.md`). דורש חשבונות ואישור אנושי |
| Phase 8 | QA / Security / Performance | ✅ אמולטור · 🟡 מכשיר פיזי לא נבדק | סקירה בלתי תלויה, בדיקות אינטגרציה חוצות-מודולים, `SECURITY.md`. ראה `TEST_REPORT.md` |
| Phase 9 | APK / release docs | ✅ debug · ⛔ release | debug APK נבנה בהצלחה ב-CI (run #14, artifact ‏20.7MB) עם unit tests ו-lint ירוקים. אין release חתום (דורש keystore של המשתמש) |
