# TASKS — מצב משימות

## הושלם
- [x] Discovery של הסביבה ותיעוד חסמים
- [x] שלד Gradle, version catalog, מודולים, CI
- [x] חוזי domain ו-model
- [x] מנוע משימות: חזרתיות לפי תאריך מקומי, DST, codec, materializer, פקודות, dependencies, אימות ביצוע, דחייה, דילוג, תכנון יומי/שבועי, smart scheduler
- [x] מנוע מדיניות חסימה טהור + חבילות מוגנות + bypass + מצב התאוששות
- [x] מכונת מצבים לטיימר Pomodoro מבוססת timestamps
- [x] XP / רמות / רצפים (עם הקפאה) / הישגים / סקירה שבועית / סטטיסטיקה
- [x] AI: guard, validator, cost guard, מאמן דמו בעברית, שיחה עם אישור מפורש
- [x] בדיקות אינטגרציה חוצות-מודולים (מחלקות אמיתיות)
- [x] שכבת Android: נתונים, אכיפה, UI, AI remote, התראות (נכתב)
- [x] backend רפרנס (Supabase Edge Function) — לא פרוס

## בתהליך / נותר
- [x] build ירוק מלא של `:app` ב-CI: assembleDebug + unit tests + lint (run #14)
- [x] הרצת instrumented tests על אמולטור: 30/30 (run #23)
- [ ] בדיקות ידניות על Galaxy S25 Ultra: הרשאות, ריבוט, שלילת הרשאות, סוללה
- [x] identityHash אמיתי ב-2.json (נקרא מה-DB באמולטור)
- [x] אייקון התראה monochrome אחיד
- [x] החלפת מזהה התקנה ב-JWT (Supabase anonymous auth) עם רענון ו-retry על 401

## מתוכנן (Roadmap)
- [ ] Google Calendar (קריאה בלבד → כתיבה לאירועי האפליקציה)
- [ ] Supabase sync אופציונלי
- [ ] Push אופציונלי
- [ ] Certificate pinning, SQLCipher
- [ ] Widgets למסך הבית, Wear OS
