# TEST REPORT — DISCIPLINE OS ULTRA

תאריך: 2026-11-04 · ענף: `ccr-c65c3999-0d10pb`

כלל: **PASS רק אם הבדיקה רצה בפועל ועברה.** מה שלא רץ מסומן במפורש.

## סיכום
| חבילה | סביבה | תוצאה |
|---|---|---|
| Domain unit tests (`core:domain`) — 285 בדיקות | sandbox מקומי (JDK 21) + GitHub Actions (JDK 17) | ✅ PASS — 285/285, 0 נכשלו, 0 דולגו |
| בדיקות אינטגרציה חוצות-מודולים (3, כלולות ב-285) | כנ"ל | ✅ PASS |
| `:app:assembleDebug` (קומפילציה מלאה: Kotlin, KSP/Room, Hilt, Compose, משאבים) | GitHub Actions, run #14 | ✅ PASS — נוצר APK |
| `:app:testDebugUnitTest` — 125 בדיקות JVM של שכבת ה-app | GitHub Actions, run #14 | ✅ PASS |
| `:app:lintDebug` (`abortOnError = true`) | GitHub Actions, run #14 | ✅ PASS — 0 שגיאות (יש אזהרות) |
| Debug APK | artifact `discipline-os-ultra-debug-apk` (‏20.7MB) ב-run #14 | ✅ נוצר |
| Instrumented tests — 30 בדיקות (Migration, DAO, Backup, Design System, BlockScreen, PermissionStatus) | אמולטור API 34 ב-CI, run #15 | ⏳ ראו "תוצאות אמולטור" למטה |
| צילומי מסך מאמולטור | CI, run #15 | ⏳ ראו למטה |
| בדיקות על Galaxy S25 Ultra פיזי | — | ⛔ לא רץ (אין מכשיר בסביבה) |

## פירוט בדיקות ה-domain (285)
| תחום | בדיקות | כיסוי עיקרי |
|---|---|---|
| RecurrenceEngine | 18 | None/Daily/Weekly/Monthly, every-N, endDate, archived, clamp לסוף חודש |
| DueInstantResolver (DST) | 11 | ירושלים 27.3.2026 ו-25.10.2026, ניו יורק 8.3.2026 ו-1.11.2026, שעה בתוך "חור" (02:30), ימים של 23/25 שעות |
| RecurrenceCodec | 5 | round-trip, קלט פגום ← None |
| OccurrenceMaterializer | 16 | אידמפוטנטיות, rematerialize, sweepPast עם/בלי carry-over |
| TaskCommands | 34 | ולידציה, מעגלי תלות, אימות ביצוע, דחייה (מקסימום 3), דילוג, היסטוריה, תזכורות |
| DayPlan/Week | 7 | איחורים, מיון, ספירות |
| SmartScheduler | 15 | טופולוגיה, חלונות, חפיפות, unscheduled |
| BlockPolicyEngine | 20 | אין חובה ← פתוח; רשות לא חוסמת; חובה ← חסום; השלמה ← פתוח; דחייה עדיין חוסמת; carry-over; חבילות מוגנות תמיד מותרות; כבוי; מצב התאוששות; bypass פעיל/פג/הסתיים מוקדם; ריכוז; דטרמיניזם |
| BypassManager | 14 | מגבלה יומית, cooldown, חירום עוקף, איפוס בחצות מקומית, clamp |
| ObserveBlockPolicyInputUseCase | 5 | תגובה לשינויים, החלפת תאריך |
| FocusTimerStateMachine | 21 | מחזור מלא + הפסקה ארוכה, השהיה/המשך, דילוג, עצירה, שינה ארוכה (catch-up), אירועים לא חוקיים |
| FocusSessionManager | 13 | התמדה ושחזור, XP רק לסשנים שהושלמו |
| Gamification | — | עקומת רמות, XP, רצפים (פערים, ימים ניטרליים, הקפאה, היום בתהליך), הישגים אידמפוטנטיים |
| Statistics | — | נתונים ריקים בלי NaN, דילוגים לא נספרים, מגמה |
| Coach security | — | Guard (עברית ואנגלית, bidi, קיצור), validator (36 מקרי דחייה), CostGuard |
| CoachConversation | — | מגבלה יומית לא קוראת לספק, פעולות לא תקינות נזרקות, אישור יוצר משימה פעם אחת, דחייה, שגיאה ← הודעה |
| Cross-module integration | 3 | מחזור חיים מלא: יצירת חובה ← חסימה ← השלמה ← פתיחה + XP; ביטול השלמה מחזיר חסימה בלי XP כפול; הצעת מאמן נכתבת רק אחרי אישור ורק פעם אחת |

(סכום התחומים gamification/stats/coach = 103 בדיקות של סוכן B2.)

## פירוט בדיקות ה-app (JVM, 125)
AI remote provider (MockWebServer: streaming, מיפוי 401/402/429, אירוע פגום, ביטול), ולידציית URL, בחירת ספק; מיפוי entity↔model; PrefsCodec; BackupCodec (12: גודל, schemaVersion, שדות, הפניות שבורות); ReminderPlanner (כולל DST); EnforcementLogic (41: הסקת אפליקציה בחזית מאירועים, מרווחי polling, debounce); עזרי UI (גרפים, פורמט זמן, קלט צ'אט, onboarding, הגדרות).

## תוצאות אמולטור
_יתעדכן עם סיום run #15._

## מה לא נבדק (ונדרש לפני שימוש אמיתי)
1. התנהגות על Galaxy S25 Ultra: הרשאות, One UI battery, ריבוט, שלילת הרשאות בזמן ריצה, Accessibility.
2. סוללה לאורך 24 שעות עם חסימה פעילה.
3. TalkBack ידני ו-Dynamic Type ידני על כל המסכים (יש בדיקות אוטומטיות חלקיות לרכיבים).
4. ה-backend של AI לא הורץ (רק `tsc --strict`).

## איך להריץ בעצמך
הפקודה הראשונה לא דורשת Android SDK:
```bash
./gradlew -p verify-jvm test
```
```bash
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```
דורש אמולטור או מכשיר:
```bash
./gradlew :app:connectedDebugAndroidTest
```
