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
- [ ] הרצת instrumented tests על אמולטור/מכשיר (מיגרציה, DAO, Compose UI, BlockScreen)
- [ ] בדיקות ידניות על Galaxy S25 Ultra: הרשאות, ריבוט, שלילת הרשאות, סוללה
- [ ] החלפת placeholders של identityHash ב-schema JSON (נוצר אוטומטית ב-build הראשון)
- [ ] אייקון התראה monochrome ייעודי לכל הערוצים
- [ ] החלפת מזהה התקנה ב-JWT (Supabase anonymous auth) לפני הפעלת AI מרוחק

## מתוכנן (Roadmap)
- [ ] Google Calendar (קריאה בלבד → כתיבה לאירועי האפליקציה)
- [ ] Supabase sync אופציונלי
- [ ] Push אופציונלי
- [ ] תרגום מלא לאנגלית
- [ ] Certificate pinning, SQLCipher
- [ ] Widgets למסך הבית, Wear OS
