# NOA Personal Bridge — סקירת UX, נגישות וביצועים (מעבר שני, בלתי תלוי)

**סוקרים:** Agent 31 (UX Research & Accessibility, מעבר שני) · Agent 35 (Performance Engineer)
**תאריך:** 2026-11-15
**היקף:** `noa-personal-bridge/android/app/src/main/kotlin/ai/noa/bridge/app/ui/**`, `.../app/platform/**`, `noa-personal-bridge/android/core/**`
**מכשיר יעד:** Samsung Galaxy S25 Ultra (1440x3120, Android 15/16)

> **הערה על מדידות:** אין בסביבה הזו אמולטור או מכשיר (אין KVM). צילומי המסך הם רינדור אמיתי של מסכי Compose
> (לא מוקאפים), אבל לא נמדדו זמני ריצה של האפליקציה. כל מספר ביצועים במסמך מסומן **"הערכה"** ומבוסס על קריאת קוד
> ועל עלויות טיפוסיות של ה-API. מספרי ניגודיות (WCAG) **חושבו** בנוסחת WCAG 2.x מצבעי `ui/theme/Color.kt`.

---

## 1. איך הופקו צילומי המסך

- קובץ הבדיקה: `noa-personal-bridge/android/app/src/test/kotlin/ai/noa/bridge/app/screenshots/ScreenshotCapture.kt`
  - Robolectric `@GraphicsMode(NATIVE)`, `@Config(sdk = [35], qualifiers = "w384dp-h832dp-port-600dpi")`
    → 384x832dp ב-3.75x = **1440x3120 פיקסלים בדיוק** (הפאנל של S25 Ultra ב-WQHD+ בגודל התצוגה ברירת המחדל של Samsung).
  - מצב כהה: `@Config(qualifiers = "+night")` (עובר דרך `isSystemInDarkTheme()` האמיתי).
  - 200%: `@Config(fontScale = 2.0f)` — עובר דרך `Configuration` של המערכת, כך ש-Compose מפעיל את הסקיילינג הלא-לינארי של Android 14+ (כנראה; לכן טקסט גדול גדל פחות מפי 2).
  - נתונים: `FakeAppController` (דוגמה לכל מצב טיוטה), דרך `NoaApp` המלא (כולל ניווט תחתון), עם `liveClock = false`.
- **הפעלה (opt-in בלבד):**
  ```bash
  cd noa-personal-bridge/android && export ANDROID_HOME=/opt/android-sdk
  NOA_SCREENSHOTS=1 ./gradlew :app:testDebugUnitTest --tests 'ai.noa.bridge.app.screenshots.*' --rerun
  ```
  בלי `NOA_SCREENSHOTS=1` כל 16 הבדיקות מדולגות (`Assume`) — אומת: `tests="16" skipped="16"`. לא שונה אף קובץ build.
- **סטייה מכוונת מההנחיה:** `onRoot().captureToImage()` נכשל ב-Robolectric
  (`ComposeTimeoutException ... WindowCapture.forceRedraw`: הוא מחכה לפריים חומרה שלא מגיע תחת ה-looper המושהה).
  לכן הבדיקה מציירת את ה-`decorView` של החלון האמיתי לתוך Bitmap (`view.draw(canvas)`, אותו מסלול ציור של
  `View.drawToBitmap()` במכשיר). עבור דיאלוגים: חלון הדיאלוג האמיתי (נמצא דרך `WindowManagerGlobal`) מצויר
  ממורכז מעל צילום המסך שמאחוריו עם scrim של 32% שחור.
- **גופנים:** עברית מוצגת היטב — Robolectric native runtime כולל `NotoSansHebrew-Regular/Bold.ttf`.
- **מגבלות ידועות של הרינדור (לא באגים באפליקציה):**
  1. אין status bar / navigation bar של המערכת (אין insets מצוירים).
  2. חלון הדיאלוג מקבל ב-Robolectric רוחב מלא; במכשיר ל-`AlertDialog` יש שוליים צדדיים.
  3. הגופן הוא Noto Sans Hebrew, לא גופן One UI של Samsung; ל-Noto Hebrew יש רק Regular/Bold, ולכן
     במשקל Medium המילה הלטינית "WhatsApp" (Roboto Medium) נראית מודגשת לעומת העברית (ראו צ׳יפ "הועבר ל-WhatsApp").

---

## 2. גלריית צילומי מסך

| # | מסך | קובץ |
|---|------|------|
| 1 | בית — מצב תקין | ![](screenshots/01_home.png) |
| 1b | בית — גלילה לתחתית (השהיה + עצירת חירום) | ![](screenshots/01b_home_bottom.png) |
| 2 | בית — אחרי עצירת חירום | ![](screenshots/02_home_emergency_stopped.png) |
| 2b | בית — בלי הסכמה + שליחה ניסיונית פעילה | ![](screenshots/02b_home_no_consent_experimental.png) |
| 3 | רשימת טיוטות (פעילות) | ![](screenshots/03_drafts_list.png) |
| 3b | רשימת טיוטות (היסטוריה) | ![](screenshots/03b_drafts_list_history.png) |
| 3c | רשימת טיוטות ריקה | ![](screenshots/03c_drafts_empty.png) |
| 4 | פרטי טיוטה — ממתינה לאישור + באנר בטיחות | ![](screenshots/04_draft_detail_safety.png) |
| 4b | פרטי טיוטה — אזור הפעולות | ![](screenshots/04b_draft_detail_safety_actions.png) |
| 5 | דיאלוג אישור שליחה | ![](screenshots/05_approve_dialog.png) |
| 5b | דיאלוג "השליחה כבויה" (העתקה) | ![](screenshots/05b_approve_dialog_sending_off.png) |
| 5c | פרטי טיוטה — "הועבר ל-WhatsApp" | ![](screenshots/05c_draft_detail_send_attempted.png) |
| 6 | הגדרות | ![](screenshots/06_settings.png) |
| 6b | הגדרות — תחתית | ![](screenshots/06b_settings_bottom.png) |
| 7 | חיבור לשרת | ![](screenshots/07_pairing.png) |
| 7b | חיבור לשרת — שגיאות אימות | ![](screenshots/07b_pairing_validation.png) |
| 8 | Onboarding, עמוד 1 | ![](screenshots/08_onboarding_p1.png) |
| 9 | בית — מצב כהה | ![](screenshots/09_home_dark.png) |
| 10 | פרטי טיוטה — מצב כהה | ![](screenshots/10_draft_detail_dark.png) |
| 11 | פרטי טיוטה — גופן 200% | ![](screenshots/11_draft_detail_font200.png) |
| 11b | פרטי טיוטה — גופן 200%, אזור הפעולות | ![](screenshots/11b_draft_detail_font200_actions.png) |
| 11c | דיאלוג אישור — גופן 200% | ![](screenshots/11c_approve_dialog_font200.png) |
| 12 | בית — גופן 200% | ![](screenshots/12_home_font200.png) |

**רושם כללי:** המראה מקצועי ועקבי — פלטת אינדיגו על ניטרלים חמים, טיפוגרפיה עברית מרווחת, פריסת RTL נכונה
(חץ חזרה מצביע ימינה, אייקון שליחה ו-chevron משוקפים, מתגים RTL, בועות נכנסות בצד ימין). זה לא נראה כמו דמו AI גנרי.
טקסטי הסטטוס כנים: אין בשום מקום "נשלח" / "נמסר" — רק "הועבר ל-WhatsApp — אין אישור מסירה" ו"לא ידוע אם נשלח".

---

## 3. נגישות

### 3.1 ניגודיות (מחושב, WCAG 2.2 — 1.4.3 / 1.4.11)

| זוג צבעים | יחס | עובר? |
|-----------|-----|-------|
| onSurface / background (בהיר) | 16.20:1 | AA/AAA |
| onSurfaceVariant / background (בהיר) | 8.94:1 | AAA |
| onSurfaceVariant / surfaceContainerHigh (שעה בבועה, צ׳יפים) | 7.57:1 | AAA |
| primary / background (כותרות סעיף, TextButton) | 6.76:1 | AA |
| primary / מכל הדיאלוג (כפתורי דיאלוג) | 5.72:1 | AA |
| לבן / primary (כפתור "אשר ושלח") | 7.17:1 | AAA |
| danger / מכל הדיאלוג (אישור הרסני) | 5.22:1 | AA |
| לבן / danger (עצירת חירום) | 6.54:1 | AA |
| באנר אזהרה (452900 / FFE6C2) | 11.05:1 | AAA |
| צ׳יפ הצלחה / סכנה / מידע | 10.55 / 11.32 / 13.50:1 | AAA |
| טקסט הצלחה "העריכה נשמרה" / background | 6.15:1 | AA |
| outline / background (מסגרת שדה טקסט) | 4.41:1 | 1.4.11 ✓ |
| **outlineVariant / background (מסגרת OutlinedButton וכרטיסים)** | **1.52:1** | **1.4.11 ✗** (ראו A11Y-07) |
| מצב כהה: onSurface / onSurfaceVariant / primary על רקע | 14.57 / 11.02 / 10.76:1 | AAA |
| מצב כהה: כפתור אישור (24178F על C5BFFF) | 7.70:1 | AAA |
| מצב כהה: באנר אזהרה / סכנה / הצלחה / מידע | 8.12 / 7.05 / 7.94 / 7.48:1 | AAA |
| מצב כהה: outlineVariant / background | 1.97:1 | 1.4.11 ✗ |
| טקסט מושבת (38% onSurface) — "שמור עריכה" | 2.35:1 | פטור (רכיב מושבת) |

הטענה ב-`Color.kt:9-13` ("כל זוג עומד ב-AA") נכונה לטקסט; היא לא נכונה לגבולות של `OutlinedButton` (Material 3 1.4 משתמש ב-`outlineVariant`).

### 3.2 ממצאי נגישות

| מזהה | חומרה | ממצא | מיקום | WCAG | תיקון מוצע |
|------|-------|------|-------|------|-------------|
| A11Y-01 | **גבוהה** | בועת הודעה נכנסת מגדירה `contentDescription = "הודעה של X, בשעה T"` על צומת ממוזג. TalkBack מקריא `contentDescription` **במקום** הטקסט, ולכן משתמש עיוור שומע "הודעה של יוסי לוי, בשעה 20:39" ולא את תוכן ההודעה שעליה הוא עומד להשיב (מבוסס על סדר העדיפויות של TalkBack; צריך לאמת במכשיר). | `ui/drafts/DraftDetailScreen.kt:431,441` | 1.1.1, 1.3.1, 4.1.2 | `contentDescription = "$cd: ${message.text}"`, או להשאיר את הטקסט ולשים תיאור רק על השעה. |
| A11Y-02 | **בינונית** | הודעות שגיאה/תוצאה שמופיעות דינמית לא מוכרזות: באנר `detailError` (אישור נכשל), באנר התוצאה בהגדרות (מחיקה/ניתוק), באנר כישלון/הצלחה בחיבור, וגם `SendUiState.Crashed`. רק בחלק מהמקרים יש `liveRegion`. | `DraftDetailScreen.kt:253-255, 486-491`; `SettingsScreen.kt:107-109`; `PairingScreen.kt:208-221` | 4.1.3 | להוסיף `semantics { liveRegion = LiveRegionMode.Polite }` (Assertive לשגיאת אישור), או לבנות את זה פעם אחת בתוך `NoticeBanner` כפרמטר. |
| A11Y-03 | **בינונית** | באג bidi: `pairing_url_error` ("...להתחיל ב-https:// ולכלול...") מוצג כ-`//:https` — הסימנים הניטרליים `://` אחרי הרצף הלטיני מקבלים כיוון RTL (נראה בצילום 07b). אותו סיכון ב-`BridgeApiClient.MSG_BAD_URL`. | `res/values/strings.xml:236`; `platform/BridgeApiClient.kt:221` | 1.3.2 | לעטוף כתובות ב-LRI/PDI: `⁦https://⁩`, או `BidiFormatter.unicodeWrap()` לכל פרמטר URL (`home_server_address`, `settings_pair_desc_paired`, `pairing_already_paired`). |
| A11Y-04 | נמוכה-בינונית | החץ "בהגדרות → פרטיות" מצביע ימינה, כלומר "אחורה" ב-RTL. | `strings.xml:70, 266` | 1.3.2 | `←` או "בהגדרות, בקטע פרטיות". |
| A11Y-05 | נמוכה-בינונית | כרטיס טיוטה (`Card(onClick)`) ממזג צאצאים, ובהם שם השולח עם `heading()`. בגלל מדיניות המיזוג כל כרטיס מוכרז כ"כותרת" + כפתור, והניווט לפי כותרות ברשימה מאבד ערך. אותו דבר ב-`PauseRow` (מתג שהוא גם כותרת). | `DraftsListScreen.kt:111`; `HomeScreen.kt:340` | 1.3.1, 2.4.6 | להסיר `heading()` מתוך רכיבים לחיצים; להשאיר כותרות רק לכותרות הסעיפים ("פעילות" / "היסטוריה"). |
| A11Y-06 | נמוכה | ב-`StatusPill` של כרטיס "טיוטות ממתינות" התווית היא רק "3", עם אייקון בלי תיאור. TalkBack מקריא "3" בלי הקשר. | `HomeScreen.kt:182`; `Components.kt:103` | 1.3.1 | תווית נגישה: "3 ממתינות". |
| A11Y-07 | נמוכה | גבול `OutlinedButton` ("ביטול", "אל תציע לשיחה הזו", "ניהול") ביחס 1.52:1 (בהיר) / 1.97:1 (כהה). הטקסט כן מזהה את הכפתור, ולכן זה גבולי. בכפתורי פעולה במסך טיוטה זה מחליש את ההבחנה. | theme `outlineVariant`, `Color.kt:33, 45` | 1.4.11 | `OutlinedButton(border = BorderStroke(1.dp, colorScheme.outline))` (4.41:1). |
| A11Y-08 | נמוכה | אייקונים בגודל קבוע (16-22dp) לא גדלים עם הגופן. ב-200% אייקון ה-ⓘ בצ׳יפ ואייקון האזהרה נראים זעירים ליד הטקסט (צילומים 11, 12). זה לא כשל WCAG, אבל פוגע בקריאוּת. | `Components.kt:103`; `DraftStateUi.kt` (chip icon) | — | להגדיל את גודל האייקון לפי `LocalDensity.current.fontScale`, עם תקרה. |
| A11Y-09 | נמוכה | אייקונים לא מדויקים סמנטית: DEBOUNCING מקבל לוח שנה (`DateRange`); UNKNOWN_RESULT מקבל `Refresh` שמרמז "נסה שוב" (אין ניסיון חוזר!). | `DraftStateUi.kt:99, 106` | 1.1.1 (משני) | שעון/חול לממתין; `Help`/סימן שאלה ל"לא ידוע". |
| A11Y-10 | מידע | גופן 200%: כל הפעולות נגישות בגלילה (גם בדיקת `FontScaleTest` הקיימת מאשרת). אבל במסך טיוטה עם באנר בטיחות, כפתור "אשר ושלח" נמצא כ-3 מסכים למטה (צילומים 11, 11b). | `DraftDetailScreen.kt:181-308` | 1.4.4 ✓ | לשקול כפתורי פעולה דביקים בתחתית (bottomBar) כשהגופן מוגדל. |
| A11Y-11 | מידע ✓ | אזורי מגע: כל רכיב לחיץ ≥ 48dp (`MinTouchTarget`, כפתורים ראשיים 52-56dp, `IconButton` 48dp). צ׳יפים ו-pills לא לחיצים. | — | 2.5.8 ✓ | — |
| A11Y-12 | מידע ✓ | מצב לא מועבר בצבע בלבד: לכל צ׳יפ/pill/באנר יש אייקון + טקסט; לאייקון הבאנר יש תיאור ("אזהרה"/"שגיאה"). | `Components.kt`, `DraftStateUi.kt` | 1.4.1 ✓ | — |
| A11Y-13 | מידע ✓ | RTL: `NoaApp` כופה RTL גם כשהטלפון באנגלית; אייקונים `AutoMirrored`; שדות URL/קוד נכפים ל-LTR; שעות וזמנים יחסיים מוצגים נכון. | `NoaApp.kt`, `PairingScreen.kt` | — | — |

---

## 4. ממצאי UX

| מזהה | חומרה | ממצא | מיקום | הצעה |
|------|-------|------|-------|------|
| UX-01 | **גבוהה** | ברשימת הטיוטות, הפריטים שדורשים פעולה (ממתין לאישורך, 3 פריטים) **לא מופיעים במסך הראשון**. המיון הוא לפי `updatedAt`, ולכן מצבים חולפים בלי פעולה למשתמש (התקבלה / נבדקה / ממתין לסיום / נועה מנסחת) דוחפים אותם מתחת לקפל (צילום 03). | `DraftsListScreen.kt:57-59` | שלושה סעיפים: "ממתין לאישורך" (PendingStates) קודם, "בתהליך", "היסטוריה". כדאי גם להציג בכרטיס שורת תצוגה מקדימה של התשובה המוצעת. |
| UX-02 | **בינונית-גבוהה** | המילה "ביטול" משמשת לשתי פעולות הפוכות: בכפתור במסך הטיוטה היא **מבטלת את הטיוטה** (הרסני), ובדיאלוג האישור היא **סוגרת את הדיאלוג**. משתמש שלוחץ "ביטול" כדי לחזור עלול לבטל טיוטה (אמנם יש דיאלוג אישור נוסף). | `strings.xml:139` (`detail_cancel_draft`); `Components.kt:255` | "מחיקת הטיוטה" / "לא לענות" לכפתור במסך, ו"חזרה" בדיאלוג. |
| UX-03 | **בינונית** | עצירת החירום, שה-onboarding מבטיח שהיא "בלחיצה אחת בכל רגע", נמצאת רק בתחתית מסך הבית ודורשת גלילה גם ב-S25 Ultra בגופן רגיל (צילומים 01, 01b). היא לא קיימת במסך הטיוטה. | `HomeScreen.kt:143-145` | פעולה קבועה ב-TopAppBar (אייקון עצירה עם תווית) בכל המסכים, או כפתור בראש מסך הבית. |
| UX-04 | **בינונית** | דיאלוג האישור לא חוזר על אזהרת הבטיחות. בטיוטה שסומנה "בקשה לקוד אימות" / "ניסיון הזרקה", האישור זהה לטיוטה רגילה. | `DraftDetailScreen.kt:312-344` | כשיש `safety` להציג בדיאלוג שורת אזהרה, ולשקול השהיה קצרה או תיבת סימון "בדקתי" לפני שהכפתור "כן, לשלוח" נפתח. |
| UX-05 | **בינונית** | אם מגיעה הודעה חדשה בזמן שדיאלוג האישור פתוח, הטיוטה חוזרת ל-DEBOUNCING אבל הדיאלוג נשאר ומציג טקסט ישן. לחיצה על "כן, לשלוח" נכשלת עם שגיאה כללית. זה בטוח (לא נשלח כלום), אבל מבלבל. | `DraftDetailScreen.kt:167-169, 319-329` | לסגור את הדיאלוג אוטומטית כש-`draft.revision` או `state` משתנים, ולהציג באנר "הגיעה הודעה חדשה — הטיוטה מתעדכנת". |
| UX-06 | **בינונית** | SEND_ATTEMPTED מוצג בצבע ירוק עם ✓ ("Done"). הטקסט כן, אבל הצבע והאייקון אומרים "הצלחה/נמסר". בנוסף, במסך הטיוטה אחרי שליחה הכותרת עדיין "התשובה המוצעת" / "נוסח התשובה", ו"אשר ושלח" מוצג מושבת (צילום 05c). | `DraftStateUi.kt:104`; `DraftDetailScreen.kt:209-241, 266-287` | צבע ניטרלי או info עם אייקון "יצא" (חץ החוצה). במצבים סופיים: כותרת "הנוסח שהועבר ל-WhatsApp", ולהסתיר את כפתור האישור במקום להשבית אותו. |
| UX-07 | נמוכה-בינונית | כשהשליחה כבויה, הכפתור "אשר והעתק" לא מאשר כלום: הוא רק מעתיק, והטיוטה נשארת "ממתין לאישורך" (והתג ממשיך לספור אותה). | `strings.xml:138`; `DraftDetailScreen.kt:345-367` | "העתקת הנוסח". אחרי ההעתקה להציע "סמן כטופל" (ביטול מקומי). |
| UX-08 | נמוכה-בינונית | באנר הבטיחות מחבר 3 שורות עם `\n` בלי תבליטים. הערת השרת ("בקשה לקוד אימות") חוזרת על המשפט הקודם. ב-200% הבאנר תופס כמסך וחצי (צילום 11). | `DraftDetailScreen.kt:413-426` | `BulletLine` לכל סיבה, ולהשמיט הערות שרת שזהות לסיבה מקומית. |
| UX-09 | נמוכה | מצבים פנימיים של הצנרת ("התקבלה", "נבדקה") חשופים למשתמש ברשימה. | `DraftStateUi.kt` / `strings.xml:87-88` | לאחד ל"בתהליך" אחד. |
| UX-10 | נמוכה | כרטיס ההרשאות מופיע גם בבית וגם בהגדרות, ומאריך את הבית. כשהכול תקין, כרטיסי "שרת" + "WhatsApp" + "הרשאות" הם 3 כרטיסים ירוקים. | `HomeScreen.kt:129-135` | בבית: שורת סטטוס מקובצת אחת ("הכול תקין") שנפתחת לפרטים רק כשיש בעיה. |
| UX-11 | נמוכה | ב-`ActionRow` (הגדרות) הכותרות מוזחות פנימה ביחס לשורות האחרות בכרטיס, בגלל ה-padding של `TextButton` (צילום 06b). ה-chevron רומז ניווט, אבל "מחיקה"/"ניתוק" פותחים דיאלוג. | `SettingsScreen.kt:333-365` | `Modifier.clickable` על Row במקום `TextButton`; בלי chevron לפעולות הרסניות. |
| UX-12 | נמוכה | התראה נפרדת לכל טיוטה, בלי קבוצה. כמה שולחים יוצרים כמה התראות, ו-`ensureChannel()` נקרא בכל פרסום. | `platform/DraftNotifier.kt:61-89` (ensureChannel ב-73) | `setGroup` + התראת סיכום ("3 טיוטות ממתינות"), ולקרוא ל-`ensureChannel` פעם אחת. |
| UX-✓ | — | זרימת האישור חזקה: הנמען ("אל: דנה כהן") והנוסח המדויק מוצגים בדיאלוג. הנוסח שנשלח הוא `dialogText` שצולם בפתיחת הדיאלוג. השליחה חד-פעמית (`SendTracker`) ונבדקת בליבה (hash, revision, TTL). כל פעולה הרסנית (עצירה, חידוש, ביטול, החרגה, מחיקה, ניתוק, הפעלת שליחה, הסכמה) עוברת דיאלוג. יש empty state מסביר (03c) ושגיאות אימות ברורות (07b). | | |

---

## 5. ממצאי ביצועים

כל העלויות הן **הערכות** (לא נמדדו). הנחות המעבד: Snapdragon 8 Elite. "Main" = ה-UI thread / ה-thread של ה-callbacks של ה-listener.

| מזהה | חומרה | ממצא | מיקום | עלות (הערכה) | תיקון |
|------|-------|------|-------|---------------|-------|
| PERF-01 | **בינונית** | Keystore על ה-main thread בזמן אתחול: `DefaultAppController` קורא בבנאי ל-`secureStore.exclusions()` + `loadCredentials()` (3 פענוחי AES-GCM). כל `read()` יוצר `KeyStore.getInstance().load(null)` חדש. ה-`PlatformGraph` נוצר בעצלתיים בגישה הראשונה: `MainActivity.onCreate` או `onListenerConnected`, ושניהם על ה-main thread. | `platform/DefaultAppController.kt:149,155`; `platform/SecureStore.kt:66-69`; `platform/KeystoreCipher.kt:39-52` | 3 × (load + begin/update/finish ל-keystore2 ב-TEE): **~15-90ms** בהפעלה קרה | לשמור את ה-`SecretKey` בזיכרון (cache); לטעון credentials/exclusions ב-`Dispatchers.IO` ולפרסם ל-StateFlow. |
| PERF-02 | **בינונית** | כתיבות דיסק סינכרוניות על ה-main thread: `SettingsStore.save()` עושה `commit()` בכל מתג (השהיה, הסכמה, שליחה, עצירת חירום). `persistExclusions` עושה הצפנת Keystore + `commit()` בלחיצה על "אל תציע". | `platform/SettingsStore.kt:26-33`; `DefaultAppController.kt:229-240`; `SecureStore.kt:71-76` | `commit()`: **~1-10ms** (fsync); החרגה: **~10-40ms** → jank אפשרי בלחיצה | `apply()` ל-SettingsStore (הסדר נשמר); הצפנה וכתיבה ב-IO עם עדכון אופטימי של ה-StateFlow. |
| PERF-03 | נמוכה-בינונית | אין הגבלת קצב לבקשות שרת לכל שיחה. בקשה אחת לכל **פרץ** (debounce של 15 שניות) — תקין. אבל שולח שכותב כל ~20 שניות יוצר בקשה לכל הודעה, ובקשה ב-PROCESSING מבוטלת ונשלחת שוב (העבודה בשרת מתבזבזת). | `core/DefaultBridgeCoordinator.kt:115-118, 149-178` | שיחה של 30 הודעות במרווח 20 שניות → **עד ~30 בקשות** (כל אחת עד 8KB ועוד זמן מודל) | debounce אדפטיבי (למשל 15s → 30s → 60s בפרצים חוזרים), או מרווח מינימלי בין בקשות לאותה שיחה. |
| PERF-04 | נמוכה | `LruDeduplicator.purgeExpired` עובר על **כל** הרשומות (עד 2,000) בכל `checkAndRecord`, וזה נקרא לכל הודעה בהתראה (עד 20). מכיוון שהמפה access-ordered וה-TTL נמדד מהגישה האחרונה, הרשומות כבר ממוינות לפי זמן, ואפשר לעצור ברשומה הראשונה שלא פגה. | `core/LruDeduplicator.kt:37-43` | עד 20 × 2,000 = **40K איטרציות להתראה, ~0.2-0.5ms** על ה-main | `else break` בלולאה → O(1) בממוצע. |
| PERF-05 | נמוכה | מסלול ה-listener לכל התראה (main thread): `MessagingStyle.extractMessagingStyleFromNotification` (unparcel), ואחר כך `filter.evaluate` **פעמיים** (פעם ב-`wouldAccept` של ה-ingestor ופעם בקואורדינטור). כל הערכה מחשבת `ConversationKeys.derive` + `EventIds` (SHA-256 לכל הודעה, עם `MessageDigest.getInstance` חדש בכל קריאה). אחר כך מיון ופרסום של כל הטיוטות. | `platform/PlatformGraph.kt:49`; `platform/NotificationIngestor.kt:111-118`; `core/Hashing.kt:9-10` | **~1-2ms להתראת WhatsApp** (≈40 SHA-256 + unparcel + מיון ≤80). כולל התראות קבוצה, שממופות לפני שנדחות. | להעריך פעם אחת ולהעביר את `FilterResult` הלאה; `ThreadLocal<MessageDigest>`; סינון זול (`EXTRA_IS_GROUP_CONVERSATION == true`) לפני המיפוי המלא. |
| PERF-06 | נמוכה | `ListenerState.activeNotificationKeys()` משתמש ב-`getActiveNotifications()` על **כל** ההתראות של כל האפליקציות (parcel של bitmaps וכו׳), רק כדי לבדוק מפתח אחד לפני שליחה. גם `onListenerConnected` ממפה את כל הפעילות על ה-main. | `platform/ListenerState.kt:36-44`; `NoaNotificationListenerService.kt:28-35` | **~5-50ms לקריאה** (תלוי בכמות ההתראות); פעם אחת לשליחה / לחיבור | `getActiveNotifications(arrayOf(handle.notificationKey))`; את המיפוי ב-connect להריץ ב-`Dispatchers.Default`. |
| PERF-07 | נמוכה | ה-debouncer שומר `buffers` של `IncomingMessage` שהקואורדינטור מתעלם מהם (`onFire = { key, _ -> ... }`). אין לבאפר תקרה: אם הודעות ממשיכות להגיע כל פחות מ-15 שניות, הוא גדל עד שהטיימר יורה. זה גם עותק נוסף של תוכן פרטי בזיכרון. | `core/CoroutineConversationDebouncer.kt:29,35`; `DefaultBridgeCoordinator.kt:57-61` | זיכרון קטן, אבל לא חסום | debouncer שמחזיק רק מפתחות/טיימרים, או `takeLast(MAX_MESSAGES)` בבאפר. |
| PERF-08 | נמוכה | `produceState` של השעון ב-`NoaApp` מתקתק כל 30 שניות כל עוד ה-Activity קיים, גם ברקע (בלי פריימים, אבל עם wakeup של ה-main looper). | `ui/NoaApp.kt:77-82` | זניח (wakeup אחד ל-30 שניות; לא alarm ולא wake lock) | להריץ רק ב-`Lifecycle.State.RESUMED` (`repeatOnLifecycle`). |
| PERF-09 | נמוכה | `DraftDetailScreen` מקבל את כל רשימת הטיוטות, ולכן כל פרסום (כל טיוטה אחרת שמשתנה) גורם ל-recompose של כל המסך, כולל `firstOrNull`. `SendTracker.attempts` גדל בלי גבול במשך חיי ה-ViewModel. | `ui/NoaApp.kt:144-153`; `ui/drafts/SendTracker.kt` | זניח (≤80 טיוטות, עמודה קטנה) | `remember(drafts, id)` / `derivedStateOf` לטיוטה הבודדת; לנקות attempts של טיוטות שנעלמו. |
| PERF-✓ | — | **תקין:** אין foreground service, wake lock, `AlarmManager` או polling (ב-Manifest רק `INTERNET` ו-`POST_NOTIFICATIONS`). בדיקת health רק באתחול ובחיבור. **OkHttpClient אחד** בלבד (`BridgeApiClient` יחיד ב-`DefaultAppController`), עם timeouts (10/30/30/40s), בלי retry שקט, וביטול הקריאה כשה-coroutine מבוטל (`invokeOnCancellation { cancel() }`). LazyColumn עם `key` ו-`contentType`; המיון ב-`remember(drafts)`. תקרות זיכרון: 30 טיוטות פעילות + 50 סופיות (שעה), 20 הודעות לטיוטה, dedup 2,000 / 6h, registry 50, approvals עם TTL של 2 דקות ו-purge. טיימרי debounce מבוטלים כשהם מוחלפים, וה-engine job מבוטל כשהטיוטה מתיישנת או נעצרת — לא נמצאה דליפת coroutine. | | | |
| PERF-RISK | לאימות | `delay()` של ה-debounce לא מחזיק wake lock. כשהמסך כבוי וב-Doze, הטיימר של 15 שניות עלול להתעכב עד חלון תחזוקה, ובקשת הרשת עלולה להיחסם. זו **השהיה, לא סוללה**. צריך למדוד במכשיר (מסך כבוי + `adb shell dumpsys deviceidle force-idle`). | `CoroutineConversationDebouncer.kt:43-44` | לא ידוע | אם ההשהיה לא מקובלת: wake lock חלקי וקצר (≤20s) רק בזמן debounce פעיל, או לקבל את ההשהיה, כי הטיוטה ממילא דורשת שהמשתמש יפתח את המכשיר. |

---

## 6. סדר עדיפויות לתיקון

1. **A11Y-01** — TalkBack לא מקריא את תוכן ההודעה הנכנסת (שינוי של שורה אחת).
2. **UX-01** — "ממתין לאישורך" בראש הרשימה.
3. **UX-02 / UX-03 / UX-04** — שמות פעולות לא דו-משמעיים, עצירת חירום נגישה תמיד, אזהרת בטיחות בדיאלוג.
4. **A11Y-02, A11Y-03** — live regions ו-bidi של כתובות URL.
5. **PERF-01 / PERF-02** — Keystore ו-`commit()` מחוץ ל-main thread.
6. **UX-05 / UX-06** — דיאלוג מתיישן, ייצוג "הועבר" בלי סמנטיקת הצלחה.
7. השאר (נמוכה) — כשנוח.
