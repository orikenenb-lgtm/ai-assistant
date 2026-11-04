# DISCIPLINE OS ULTRA

אפליקציית Android לבניית משמעת אישית: משימות חובה ורשות, טיימר ריכוז, מאמן AI בעברית, סטטיסטיקות וגיימיפיקציה, וחוסם אפליקציות שמגביל את האפליקציות שבחרת **רק כל עוד יש משימת חובה פתוחה**.

- Package: `com.disciplineos.app`
- Kotlin · Jetpack Compose · Material 3 · Hilt · Room · DataStore · WorkManager · Navigation Compose
- Local-first: עובדת מלא בלי אינטרנט ובלי חשבון. אין צורך בשום שירות ענן.
- עברית מלאה מימין לשמאל (RTL), מבנה מוכן לאנגלית.

> ⚠️ **סטטוס כן:** ראו `TEST_REPORT.md` כדי לדעת מה נבנה ונבדק בפועל ומה עדיין לא. האפליקציה לא נבדקה על מכשיר פיזי.

## מה יש באפליקציה
| אזור | מה זה עושה |
|---|---|
| Dashboard | התקדמות יומית בטבעת, משימות חובה/רשות עם השלמה מהירה, רצף, רמה ו-XP, סטטוס חסימה, כניסה מהירה לריכוז ולמאמן |
| משימות | חובה/רשות, תתי-משימות, קטגוריות, עדיפויות, שעות יעד, חזרתיות (יומי/שבועי/חודשי), תזכורות, דחייה (עד 3), דילוג עם סיבה, תלויות, אימות ביצוע, היסטוריה, תכנון שבועי ותזמון חכם |
| חוסם | בוחרים אפליקציות מותקנות. כל עוד יש משימת חובה פתוחה הן מוגבלות; כשכל משימות החובה הושלמו הן נפתחות. אין משימות חובה = אין חסימה. מסך חסימה עם המשימות שנותרו ושחרור חירום |
| ריכוז | Pomodoro מותאם, הפסקות קצרות וארוכות, התראה עם ספירה לאחור, חסימה בזמן ריכוז (אופציונלי) |
| מאמן AI | צ'אט בעברית: תכנון יום, פירוק מטרות, תעדוף, סיכומים. הצעות למשימות נכתבות **רק אחרי אישור שלך**. ברירת מחדל: מאמן דמו מקומי, בלי רשת |
| סטטיסטיקה | אחוזי השלמה, שעות ריכוז, רצפים, מגמה שבועית, זמן מסך (רק עם הרשאה), גרפים |
| גיימיפיקציה | XP, רמות, הישגים, רצף עם "הקפאה", סקירה שבועית תומכת — בלי ענישה |
| הגדרות | אפליקציות חסומות, הרשאות, פרטיות AI, גיבוי וייבוא JSON, מחיקת כל הנתונים, שפה, נגישות, חריגי חירום, מצב התאוששות |

## מה האפליקציה לעולם לא תעשה
- לא תחסום טלפון, חייגן, חירום, SMS, הגדרות, מקלדת או את מסך הבית.
- לא תמנע הסרה שלה ולא תמנע ביטול הרשאות.
- לא תסתיר שהיא פועלת — יש התראה קבועה וגלויה כשהחוסם פעיל.
- לא תשלח רשימת אפליקציות או זמן מסך ל-AI בלי שהפעלת זאת במפורש.
- **אין חסימה מוחלטת**: Android לא מאפשר זאת לאפליקציה רגילה, וזה מכוון. פירוט: `docs/BLOCKER_LIMITATIONS.md`.

## מבנה הפרויקט
```
discipline-os-ultra/
├── core/model/        # data classes משותפים (Kotlin טהור)
├── core/domain/       # כל כללי המוצר + 285 בדיקות (Kotlin טהור)
│   ├── task/          #   חזרתיות, DST, פקודות, תכנון
│   ├── blocker/       #   מדיניות חסימה, bypass, התאוששות
│   ├── focus/         #   מכונת מצבים לטיימר
│   ├── gamification/  #   XP, רמות, רצפים, הישגים
│   ├── stats/         #   סטטיסטיקה
│   └── coach/         #   אבטחת AI, מאמן דמו, שיחה
├── app/               # אפליקציית Android
│   └── src/main/kotlin/com/disciplineos/app/
│       ├── designsystem/  ui/  data/  enforcement/  focus/  ai/  work/  notifications/  di/
├── verify-jvm/        # build עצמאי לבדיקת ה-domain בלי Android SDK
├── backend/           # רפרנס Supabase Edge Function ל-AI (לא פרוס)
└── docs/              # מסמכים טכניים
```

## בנייה

### דרישות
- JDK 17 ומעלה
- Android SDK (compileSdk 35) — דרך Android Studio או `sdkmanager`
- גישה ל-Google Maven (`dl.google.com`)

### פקודות
הפקודה הראשונה מריצה את בדיקות ה-domain בלבד, ועובדת גם בלי Android SDK:
```bash
./gradlew -p verify-jvm test
```
בניית APK לדיבאג:
```bash
./gradlew :app:assembleDebug
```
בדיקות יחידה ו-lint:
```bash
./gradlew :app:testDebugUnitTest :app:lintDebug
```
בדיקות instrumented (דורש אמולטור או מכשיר מחובר):
```bash
./gradlew :app:connectedDebugAndroidTest
```

ה-APK נוצר כאן:
```
app/build/outputs/apk/debug/app-debug.apk
```

### CI
הקובץ `.github/workflows/discipline-os-ultra.yml` מריץ בכל push את בדיקות ה-domain ואת ה-build המלא, ומעלה את ה-debug APK כ-artifact (בלשונית Actions ב-GitHub).

### Release
אין חתימת release בריפו, וזה בכוונה. ליצירת release צריך keystore משלך בקובץ `keystore.properties` מקומי (הקובץ חסום ב-`.gitignore`).

## התקנה על Samsung Galaxy S25 Ultra
מדריך מלא צעד אחר צעד: `docs/PERMISSIONS_S25_ULTRA.md`. בקצרה:
1. גישה לנתוני שימוש.
2. הצגה מעל אפליקציות אחרות.
3. התראות.
4. סוללה: "ללא הגבלה" והוספה לאפליקציות שלא נרדמות.
5. Accessibility — אופציונלי בלבד, אחרי מסך גילוי.

## AI Coach מרוחק (אופציונלי)
כברירת מחדל המאמן רץ מקומית. חיבור למודל אמיתי דורש להעלות את ה-backend שב-`backend/` (שלבים ב-`backend/README.md`) ולהגדיר את כתובתו בזמן build:
```bash
./gradlew :app:assembleDebug -Pdiscipline.aiBackendUrl=https://<your-project>.supabase.co/functions/v1/coach-stream
```
אין שום מפתח API בתוך האפליקציה. אבטחה: `docs/AI_SECURITY.md`.

## מסמכים
`ARCHITECTURE.md` · `PLAN.md` · `TASKS.md` · `AGENTS.md` · `SECURITY.md` · `TEST_REPORT.md` · `RELEASE_NOTES.md` · `docs/`
