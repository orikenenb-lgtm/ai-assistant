# תוצאות בדיקות — NOA Personal Bridge

**צוות QA:** Agent 27 (QA Automation Lead) · Agent 28 (Android Test Engineer) · Agent 29 (Regression Testing Engineer)
**תאריך הרצה:** 2026-11-15 (UTC, ‏20:42–21:12)
**ענף:** `claude/serene-planck-84hxxm` · **HEAD בהרצה הסופית:** `48fc24e` (Android) / `5003758` (Python, רגרסיה, diff) — צוותי הפיתוח והאבטחה עבדו במקביל ו-HEAD התקדם תוך כדי (ראו §6).
**תוכנית ומטריצת עקיבות:** [TEST_PLAN.md](TEST_PLAN.md) · **בסיס:** [BASELINE_REGRESSION.md](BASELINE_REGRESSION.md)

---

## 1. תקציר

| חבילה | סה"כ | עברו | נכשלו | דולגו / xfail | מתוכן בדיקות QA חדשות |
|---|---|---|---|---|---|
| Android `:core:test` | **176** | 176 | 0 | 0 | 45 (45 עברו) |
| Android `:app:testDebugUnitTest` | **183** | 166 | 0 | 17 דולגו | 34 (33 עברו, 1 `@Ignore` = באג QA-03) |
| Android `:app:lintDebug` | — | 0 errors | — | 14 warnings | — |
| Android `:app:assembleDebug` | — | `app-debug.apk` נבנה | — | — | — |
| bridge-service `pytest` | **582** | 576 | **1** (לא של QA, ראו §3) | 5 xfail | 131 (126 עברו, 5 xfail = באגים QA-01, QA-02) |
| backend (רגרסיה) | 137 | 137 | 0 | 0 | — |
| frontend lint + build (רגרסיה) | — | עברו | — | — | — |
| smart-crm unit (רגרסיה) | 164 | 164 | 0 | 0 | — |
| smart-crm i18n / db bundle / typecheck / lint / build | — | עברו | — | — | — |

**סה"כ בדיקות QA חדשות: 210** (45 core + 34 app + 131 Python). כולן עוברות, חוץ מ-6 שמסמנות **3 באגים אמיתיים** שנמצאו (§4). אף קובץ קוד או בדיקה קיים לא שונה. אף קובץ מחוץ לתיקיות הגשר לא שונה (§5.3).

17 הדילוגים ב-app: ‏16 ב-`ScreenshotCapture` (בדיקות צילום מסך של צוות ה-UI, מדולגות כברירת מחדל) + 1 של QA (‏QA-03).

## 2. פקודות מדויקות

```bash
# Android — בריפו (כפי שנדרש), על עץ העבודה החי
cd /home/user/ai-assistant/noa-personal-bridge/android
export ANDROID_HOME=/opt/android-sdk
./gradlew :core:cleanTest :app:cleanTestDebugUnitTest \
          :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain --continue
# 21:10:17–21:11:24 UTC, HEAD 48fc24e → BUILD SUCCESSFUL
# ספירה: קבצי JUnit XML ב-core/build/test-results/test (11 קבצים) וב-app/build/test-results/testDebugUnitTest (23 קבצים)

# Python — בריפו
cd /home/user/ai-assistant/noa-personal-bridge/bridge-service
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q . -rxX --junitxml=<scratch>/logs/bridge_final.xml
# 21:11:32 UTC, Python 3.13.18 (ה-venv של השירות) → 1 failed, 576 passed, 5 xfailed

# רגרסיה — על עותק, לא בריפו
Q=/tmp/claude-0/-home-user-ai-assistant/f010ffe6-2a24-5262-b041-5bf173e21a8a/scratchpad/qa
git archive HEAD backend frontend smart-crm | tar -x -C $Q/head-copy       # HEAD 0ae2d67 בזמן החילוץ
cd $Q/head-copy/backend  && python3.11 -m venv $Q/venv-backend && $Q/venv-backend/bin/pip install -q -r requirements-dev.txt \
                         && $Q/venv-backend/bin/python -m pytest tests/ -v -p no:cacheprovider
cd $Q/head-copy/frontend && npm ci && npm run lint && npm run build
cd $Q/head-copy/smart-crm && npm ci \
  && npm run i18n:index && diff -q src/i18n/messages.generated.ts <מקור> \
  && npm run db:bundle  && diff -q supabase/deploy/all-migrations.sql <מקור> \
  && npm run typecheck && npm run lint && CI=1 NEXT_TELEMETRY_DISABLED=1 npm run test:unit \
  && CI=1 NEXT_TELEMETRY_DISABLED=1 npm run build
# 20:42:12–20:43:26 UTC (+ build ב-~21:00). לוגים: $Q/logs/*.log, סיכום: $Q/logs/summary.txt

# הוכחת אי-נגיעה
git diff --stat c4ce0d7 HEAD -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'
```

כלים: Gradle wrapper (AGP 8.13.2, Kotlin 2.2.21, Robolectric 4.16.1, SDK 35), Python 3.11.18 לרגרסיה (כמו ב-CI), Python 3.13.18 ל-bridge-service, Node v22.23.4, npm 10.9.9.

## 3. פירוט לפי חבילה

### 3.1 Android core — ‏176/176
| מחלקה | בדיקות | תוצאה |
|---|---|---|
| `qa.AndroidFlowScenariosQaTest` (חדש) | 24 | 24 עברו |
| `qa.ApprovalSafetyScenariosQaTest` (חדש) | 21 | 21 עברו |
| 9 מחלקות קיימות (`BridgeCoordinatorTest`, `ApprovalGuardTest`, `ConversationFilterTest` ועוד) | 131 | 131 עברו |

### 3.2 Android app — ‏183: ‏166 עברו, 0 נכשלו, 17 דולגו
| מחלקה | בדיקות | תוצאה |
|---|---|---|
| `qa.EndToEndPipelineQaTest` (חדש) | 23 | 23 עברו |
| `qa.ListenerServiceQaTest` (חדש) | 4 | 4 עברו |
| `qa.NoInternetQaTest` (חדש) | 3 | 3 עברו |
| `qa.MessageContentQaTest` (חדש) | 4 | 3 עברו, 1 `@Ignore` (‏QA-03) |
| מחלקות קיימות / של צוותים אחרים (platform, ui, screenshots, ReviewFixes*) | 149 | 133 עברו, 16 דולגו (`ScreenshotCapture`) |

`:app:lintDebug`: ‏0 errors, 14 warnings (`app/build/reports/lint-results-debug.txt`). `:app:assembleDebug`: ‏`app/build/outputs/apk/debug/app-debug.apk`.

### 3.3 bridge-service — ‏582: ‏576 עברו, 1 נכשל, 5 xfail
| קובץ | בדיקות | תוצאה |
|---|---|---|
| `tests/test_qa_ai_scenarios.py` (חדש) | 112 | 107 עברו, 5 xfail (strict) |
| `tests/test_qa_api_scenarios.py` (חדש) | 19 | 19 עברו |
| שאר הקבצים (של צוותי Backend/AI/אבטחה) | 451 | 450 עברו, **1 נכשל** |

**הכישלון היחיד אינו של QA:** `tests/test_security_review_server.py:98` (קובץ חדש של צוות האבטחה, בעבודה) מצפה שה-README של השירות יזכיר "overwrite" ו-"X-Forwarded-For" — ה-README עוד לא עודכן. זו בדיקת תיעוד בתהליך עבודה פעיל, לא רגרסיה בקוד. **לטיפול צוות האבטחה.**

## 4. באגים שנמצאו (הבדיקות נשארו, מסומנות)

| מזהה | חומרה | תרחיש | מיקום | תיאור | בדיקה |
|---|---|---|---|---|---|
| **QA-01** | נמוכה-בינונית | 13.3 Prompt injection + ערבוב שפות | `bridge-service/bridge_service/ai/safety.py` — `_RULES`: הכלל העברי (כרגע שורה 89) דורש פועל **ושם עצם** בעברית, והכלל האנגלי (שורה 104) דורש את שניהם באנגלית | הזרקה בשפה מעורבת לא מזוהה: `"תתעלמי מ-all previous instructions"`, `"ignore כל ההוראות הקודמות"` → `injection_suspected=False`, בלי הערה למשתמש ובלי סעיף "התראה" בפרומפט. **ההגנה המבנית מחזיקה** (הטקסט עטוף כנתונים, אין כלים, אישור אנושי) — נבדק ב-`test_injection_mixed_language_is_still_contained_structurally` | `test_qa_ai_scenarios.py::test_injection_mixed_language_is_flagged` (2 פרמטרים, `xfail(strict=True)`) |
| **QA-02** | נמוכה | 13.3 תשובות שגויות / עברית טבעית | `bridge-service/bridge_service/ai/output_guard.py` — `_strip_wrapping` (כרגע שורה 126): `a not in t[1:-1].replace(b, "")` — כשתו הפתיחה זהה לתו הסגירה (`"`, `'`, `״`, `` ` ``) ה-`replace` מוחק את כל המופעים, והתנאי תמיד אמת | תשובה שמתחילה ונגמרת במירכאות אבל מכילה כמה קטעים מצוטטים נפגמת: `"הארי פוטר" או "שר הטבעות"` → `הארי פוטר" או "שר הטבעות`; גם `״כן״ או ״לא״`, `'א' או 'ב'`. המשתמש רואה את הטיוטה הפגומה לפני אישור. תיקון מוצע: כש-`a == b` לדרוש `t[1:-1].count(a) == 0` | `test_qa_ai_scenarios.py::test_wrong_answer_guard_never_corrupts_a_reply_with_several_quoted_parts` (3 פרמטרים, `xfail(strict=True)`) |
| **QA-03** | נמוכה | 13.3 הודעות ארוכות + אימוג'י | `noa-personal-bridge/android/app/src/main/kotlin/ai/noa/bridge/app/platform/BridgeApiClient.kt:275` — `it.text.trim().take(MAX_TEXT)` חותך לפי יחידות UTF-16 | הודעה של יותר מ-2000 יחידות שבה אימוג'י יושב על נקודת החיתוך: זוג ה-surrogate נחצה, וה-surrogate הבודד נשלח לשרת כ-`?` (אומת: הסיומת שנשלחה היא `אא?`). פוגע רק בהקשר שנשלח ל-AI. תיקון מוצע: אם התו האחרון הוא high surrogate — להשמיט אותו (או חיתוך לפי code points) | `MessageContentQaTest::content_cutAt2000NeverSplitsAnEmoji` (`@Ignore("BUG: QA-03 — …")`) |

שלושת הבאגים נמצאו בבדיקות חדשות בלבד. **לא תיקנו קוד** (לפי ההנחיה). `strict=True` / `@Ignore` מבטיחים שאחרי תיקון הבדיקה תתריע ויהיה צריך להסיר את הסימון.

### תצפיות (לא באגים, לתשומת לב)
- **O-QA-1:** הצגת טוקן אישור ישן (למשל מדיאלוג קודם) מבטלת גם את האישור הנוכחי של אותה טיוטה (חוזרת ל-`AWAITING_APPROVAL`). Fail-closed; המשתמש מאשר שוב. מתועד ב-`approval_reApprovalIssuesNewToken_oldTokenNeverWorks`.
- **O-QA-2:** השרת מקבל טקסט שכולו רווחים (החוזה סופר תווים); הטלפון לעולם לא שולח כזה (`content_blankOnlyMessagesAreNeverSent`).
- **O-QA-3:** `prompt.neutralize()` מסיר ZWJ בתוך הפרומפט בלבד, כך ש-👨‍👩‍👧 מגיע למודל כ-👨👩👧. הפלט לא נפגע.
- **O-QA-4:** החרגת שיחה עוברת דרך ההגדרות קודם, ולכן הטיוטה מסתיימת כ-`EXPIRED` ("השיחה הוחרגה מהגשר") ולא `CANCELLED`. התנהגות תקינה; `DefaultAppControllerTest` לא רואה זאת כי הוא עובד מול `FakeCoordinator`.
- **O-QA-5:** ה-Output Guard לא מזהה פלט עם כמה אפשרויות ("1. … 2. …") ולא עובדות מומצאות — נשען על הפרומפט ועל האישור האנושי.
- **O-QA-6 (כלי):** ב-Robolectric ‏`ShadowNotificationListenerService.addActiveNotification(pkg, id, n)` מפרסם כ-`UserHandle{-2}`, והשירות (נכון) מתעלם ממנו. הבדיקות בונות `StatusBarNotification` עם `Process.myUserHandle()` במפורש.

## 5. רגרסיה מול ה-baseline

### 5.1 השוואה
| # | רכיב | Baseline (‏BASELINE_REGRESSION.md, ‏`c4ce0d7`) | עכשיו (עותק של HEAD) | מצב |
|---|---|---|---|---|
| 1 | backend התקנה | הותקן | הותקן (11s) | = |
| 2 | **backend pytest** | 137 passed, 0 failed, 1 warning | **137 passed, 0 failed, 1 warning** (אותה `StarletteDeprecationWarning`) | **זהה** |
| 3 | frontend `npm ci` | הותקן | הותקן | = |
| 4 | **frontend lint** | 0 problems | 0 problems | **זהה** |
| 5 | **frontend build** | 159 modules; css 29.81kB; js 359.84kB | 159 modules; css 29.81kB; js 359.84kB | **זהה** |
| 6 | smart-crm `npm ci` | הותקן | הותקן | = |
| 7 | smart-crm i18n index | זהה לקובץ בריפו | זהה (44 namespaces) | **זהה** |
| 8 | smart-crm db bundle | זהה לקובץ בריפו | זהה (15 migrations) | **זהה** |
| 9 | **smart-crm typecheck** | עבר | עבר | **זהה** |
| 10 | **smart-crm lint** | 0 problems | 0 problems | **זהה** |
| 11 | **smart-crm unit** | 12 files, 164 passed | **12 files, 164 passed** | **זהה** |
| 12 | smart-crm build | Compiled; 68/68 | Compiled; 68/68 | **זהה** |
| — | voice-agents | 60 passed (עותק ענף אחר) | לא הורץ — אינו בענף הזה ואינו בהיקף ההנחיה (backend/frontend/smart-crm) | — |

גרסאות שנפתרו ב-backend (לא מוצמדות, כמו ב-baseline): ‏`fastapi 0.163.1`, ‏`starlette 1.10.0`, ‏`httpx 0.28.1`, ‏`pytest 9.2.0`, ‏`pydantic 2.14.3`, ‏`supabase 2.34.1`.

### 5.2 לא הורץ (ולמה) — ללא שינוי מה-baseline
| שלב | מקור | סיבה |
|---|---|---|
| `rls` (migrations + `test_rls.sql` על PostgreSQL 16) | `ci.yml` | דורש שרת Postgres; ב-sandbox ‏`initdb` נכשל ואין docker |
| `test:integration` | `smart-crm.yml` | דורש Postgres (`TEST_DATABASE_URL`) |
| Schema drift (`db.ts reset` + `db:check`) | `smart-crm.yml` | דורש Postgres |
| `test:e2e` (Playwright) | `smart-crm.yml` | דורש Postgres + Chromium `--with-deps` |

### 5.3 הוכחת אי-נגיעה
```text
$ git rev-parse HEAD
5003758ed2a851c0b2842aabed376eb33ddaa1d4
$ git diff --stat c4ce0d7 HEAD -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'
(ריק — exit 0, 0 שורות)
$ git diff --stat c4ce0d7 -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'   # כולל עץ העבודה
(ריק)
$ git status --porcelain -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge'
(ריק)
$ git diff --stat 0ae2d67 HEAD -- backend frontend smart-crm      # מאז חילוץ עותק הרגרסיה
(ריק — לכן תוצאות הרגרסיה תקפות גם ל-HEAD הסופי)
$ git diff --name-status c4ce0d7 HEAD -- .github/workflows
A	.github/workflows/noa-personal-bridge.yml
```
**מסקנה:** המערכות הקיימות עובדות בדיוק כמו ב-baseline, ושום קובץ קיים מחוץ לגשר לא השתנה.

## 6. הערות על תנאי ההרצה

- **עבודה מקבילה:** צוותי הפיתוח והאבטחה ביצעו במקביל "תיקוני ביקורת קוד" ו"תיקוני אבטחה", וה-orchestrator ביצע commits מסוג WIP תוך כדי (`8f5ce0a`, `48fc24e`, `c95423d`, `ec1e588`, `5003758`). השפעות:
  1. ריצות Gradle מקבילות על אותה תיקיית `build` גרמו פעמיים לכשל קומפילציה חולף (`StatusColors.class`/`PairRequestBody.class` נמחקו באמצע) ופעם אחת לדריסת קבצי ה-XML. המספרים ב-§1 הם מהריצה הנקייה האחרונה (‏21:10–21:11, ‏BUILD SUCCESSFUL), שנספרה מה-XML.
  2. ריצת אימות נוספת על snapshot מבודד (`git archive 48fc24e` בתיקיית scratch, ‏build נפרד) נתנה: core ‏176/176, app ‏183 עם **כישלון 1 בבדיקה החדשה של צוות ה-UI** `ReviewFixesUiTest.h2_textOverTheLimitShowsAnErrorInsteadOfBeingSilentlyDropped` (בגרסה ה-committed; בעץ העבודה היא כבר עוברת), lint ‏0 errors, ‏APK נבנה. ה-bridge-service באותו snapshot לא היה עקבי פנימית (`main.py` קורא ל-`Database.purge` שהיה רק בעץ העבודה) — ארטיפקט של commit באמצע עבודה, לא ממצא QA.
  3. בזמן העבודה צוות הפיתוח שינה את החתימה של `RemoteInputReplySender` (נוסף `sendGate` ואימות מול ההתראה ה**חיה**). קבצי ה-QA (בלבד) עודכנו לחווט אותו בדיוק כמו `PlatformGraph`, ונוספה בדיקה שמכסה את ההתנהגות החדשה (`e2e_notificationSlotReusedByAnotherChat_neverRepliesIntoTheWrongConversation`).
- **בלי רשת חיצונית:** HTTP של האפליקציה רק ל-`127.0.0.1` (פורט סגור / MockWebServer); Anthropic רק דרך respx עם מפתח מזויף; "שליחה" = broadcast מוקלט של Robolectric. רשת שימשה רק להתקנת חבילות npm/PyPI לרגרסיה.

## 7. מה לא נבדק, ולמה — במיוחד מה שדורש את ה-Galaxy S25 Ultra

הבדיקות האוטומטיות מוכיחות את **הלוגיקה שלנו**. הן **לא** מוכיחות את ההתנהגות של WhatsApp, של One UI ושל החומרה. לפני הפעלת שליחה אמיתית יש לבצע במכשיר את רשימת R0–R16 ו-S1–S3 מ-[ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md) §5:

| נושא | למה לא אוטומטי | בדיקת מכשיר |
|---|---|---|
| **חיסכון בסוללה**, Sleeping / Deep sleeping apps, Adaptive battery, Doze | התנהגות ייחודית ל-One UI, אין סימולציה נאמנה | R14 (8+ שעות בלי לפתוח, החלקה מ-Recents, אתחול, Force stop) + רשימת ההגדרות ב-§6 שם |
| מבנה ההתראה האמיתי של WhatsApp (MessagingStyle, shortcutId, tag, Reply action, mutable PendingIntent) | אפליקציה סגורה; הבדיקות משתמשות בהתראות שבנינו בצורה דומה | R2, R4, R5 |
| איך WhatsApp מעדכן/מסיר התראה (אילו `reason`, האם cancel+repost) | כנ"ל | R6, R7, R15 |
| שליחה בפועל דרך Reply של WhatsApp, והאם ההודעה נמסרה | Android לא מחזיר אישור מסירה | S1, S2, S3 |
| הסתרת תוכן רגיש ב-Android 15+ (OTP) על המכשיר | תלוי ב-NotificationAssistant של Samsung | R3, R3b |
| נעילת מסך אמיתית (`KeyguardManager`) ותוכן במסך הנעילה | ב-Robolectric הנעילה מוזרקת | R9 |
| ביטול Notification Access בפועל, rebind אחרי עדכון One UI / WhatsApp | דורש Settings אמיתי | R0, R1, R16 |
| Dual Messenger (‏WhatsApp שני, משתמש 95) — סכנת שליחה מהמספר השני | דורש התקנה כפולה | R12 (הלוגיקה של סינון `sbn.user` כן נבדקה ב-`ListenerServiceQaTest`) |
| DND, צ'אט מושתק/בארכיון, Chat Lock, קבוצות/ערוצים/סטטוס/קהילות | התנהגות WhatsApp/מערכת | R8, R10, R11, R13 |
| קריסה אמיתית של התהליך (חריגה לא נתפסת) וחזרה | בבדיקות: קריסת רכיב + "תהליך חדש" מדומה | R14(ד) + בדיקה ידנית |
| אין אינטרנט אמיתי (מצב טיסה) — ומה WhatsApp עושה עם תשובה שנמסרה לו בלי רשת | בבדיקות: loopback בלבד | בדיקה ידנית; לזכור ש-`ATTEMPTED` ≠ "נמסר" |
| איכות העברית ונכונות עובדתית של מודל אמיתי (`anthropic` / `noa_persona`) | עלות + שיפוט אנושי; בבדיקות רק respx | הערכה ידנית על סט הודעות מייצג, אחרי הסכמת המשתמש לעלות |
| RLS, אינטגרציה ו-e2e של smart-crm | דורש Postgres | GitHub CI |
