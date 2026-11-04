# AGENTS.md — צוות הסוכנים, בעלות על קבצים וחוזים

מסמך זה מתאר איך הפרויקט נבנה בפועל על ידי סוכנים (subagents של Claude Code) שהופעלו מתוך סשן אחד,
ומה כל סוכן מחזיק. **רק סוכנים שמופיעים בטבלת "הרצות בפועל" הופעלו באמת.**

## מיפוי 22 התפקידים שהתבקשו → סוכנים שהורצו

כדי למנוע סוכנים כפולים ללא ערך, 22 התפקידים אוחדו ל-8 סוכני ביצוע + סוקר בלתי תלוי.
ה-Orchestrator (הסשן הראשי) מילא בעצמו את תפקידי Product Owner, Android Architect, DevOps/Build ו-QA integration.

| סוכן ביצוע | תפקידים מהבריף שמכוסים |
|---|---|
| Orchestrator (סשן ראשי) | 1 Product Owner, 2 Android Architect, 21 DevOps/Build, אינטגרציה ו-QA סופי |
| A — Task Engine | 9 Tasks & Scheduling, חלק מ-19 QA Unit Tests |
| B1 — Blocker & Focus Domain | 4 Blocker Engine (policy), 18 Performance/Battery (תכנון טיימר מבוסס-timestamps), חלק מ-19 |
| B2 — Gamification, Stats & Coach Domain | 14 Statistics, 15 Gamification, 11 AI Coach (לוגיקה), 12 AI Security (צד לקוח), חלק מ-19 |
| C — UI Core & Design System | 3 Kotlin/Compose, 6 UX Research, 7 Visual Design, 8 Motion, 16 Accessibility & RTL |
| D — Feature Screens | 3 Kotlin/Compose (מסכי Focus/Stats/Coach/Settings/Onboarding), 16 |
| E — Data & Scheduling | 10 Room Database, 9 (WorkManager/תזכורות), 17 Privacy & Security (אחסון), 20 Instrumentation (מיגרציות) |
| F — Android Enforcement | 4 Blocker Engine (אכיפה), 5 Android Permissions/Policy, 18 Battery |
| G — AI Backend & Integrations | 12 AI Backend Security, 13 Google Calendar (תכנון), Supabase/Push (תכנון) |
| R — Independent Code Reviewer | 22 Independent Code Reviewer |

## בעלות על קבצים (כלל: רק הבעלים כותב לקובץ)

| נתיב | בעלים |
|---|---|
| `gradle/`, `settings.gradle.kts`, `build.gradle.kts`, `app/build.gradle.kts`, `verify-jvm/` | Orchestrator |
| `core/model/**` | Orchestrator (חוזה משותף — שינוי רק דרך ה-Orchestrator) |
| `core/domain/.../repository/**`, `.../time/**`, `.../coach/AiCoachRepository.kt` | Orchestrator |
| `core/domain/.../task/**` + tests `.../task/**` | A |
| `core/domain/.../blocker/**`, `.../focus/**` + tests | B1 |
| `core/domain/.../gamification/**`, `.../stats/**`, `.../coach/CoachApi.kt` (+ קבצים חדשים ב-coach) + tests | B2 |
| `app/src/main/AndroidManifest.xml` | Orchestrator (חוזה רכיבים) |
| `app/.../designsystem/**` (מלבד `theme/Tokens.kt` של ה-Orchestrator), `app/.../ui/navigation/**` (מלבד `Routes.kt`), `app/.../ui/common/**`, `MainActivity.kt`, `ui/dashboard/**`, `ui/tasks/**`, `res/values/strings_core.xml`, `res/mipmap*`, `res/drawable/ic_launcher*` | C |
| `app/.../ui/focus/**`, `app/.../focus/**`, `ui/stats/**`, `ui/coach/**`, `ui/settings/**`, `ui/onboarding/**`, `res/values/strings_features.xml` | D |
| `app/.../data/**`, `app/.../di/DataModule.kt`, `app/.../work/**`, `app/.../notifications/**`, `DisciplineApp.kt`, `app/schemas/**`, `res/values/strings_notifications.xml`, `app/src/androidTest/.../data/**` | E |
| `app/.../enforcement/**`, `app/.../di/EnforcementModule.kt`, `res/xml/accessibility_service_config.xml`, `res/values/strings_enforcement.xml`, `docs/PERMISSIONS_S25_ULTRA.md` | F |
| `app/.../ai/**`, `app/.../di/AiModule.kt`, `backend/**`, `docs/INTEGRATIONS.md`, `docs/AI_SECURITY.md` | G |

## חוזים בין סוכנים

1. **Domain API** — החתימות ב-`core/domain` (קבצי `*Api.kt`, `TaskUseCases.kt`, `Recurrence.kt`) הן החוזה. מימוש מותר; שינוי חתימה ציבורית — רק עם דיווח מפורש ל-Orchestrator.
2. **Hilt** — E מספק binding לכל ממשקי ה-repository, `TimeProvider` (`SystemTimeProvider`) ו-`ReminderScheduler`. F מספק `ScreenTimeSource`. G מספק `AiCoachRepository`. Use cases של ה-domain נבנים ישירות דרך `@Inject constructor`.
3. **Navigation** — `ui/navigation/Routes.kt` מגדיר לכל route את חתימת ה-composable. C מחזיק את ה-NavHost.
4. **Design System** — רכיבי `Ds*` (רשימה וחתימות ב-`docs/DESIGN_SYSTEM.md`) מסופקים על ידי C; שאר המסכים משתמשים בהם וב-`DisciplineTheme.colors/spacing/shapes/motion`.
5. **Enforcement** — F חושף `enforcement.EnforcementController` (`@Singleton`) עם `fun sync()`; E קורא לו ב-`DisciplineApp.onCreate` ו-F קורא לו ב-`BootReceiver`.
6. **Notification channels** — מזהים ב-`notifications/NotificationChannels.kt`.

## הרצות בפועל

ראו את הטבלה המעודכנת בסוף המסמך (מתמלאת על ידי ה-Orchestrator לאחר שכל סוכן מסר תוצרים).
