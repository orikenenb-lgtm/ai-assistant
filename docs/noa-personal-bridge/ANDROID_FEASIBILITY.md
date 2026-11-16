# NOA Personal Bridge: בדיקת היתכנות לפלטפורמת Android ו-WhatsApp

| שדה | ערך |
|---|---|
| מסמך | `docs/noa-personal-bridge/ANDROID_FEASIBILITY.md` |
| צוות | PLATFORM RESEARCH: Agent 34 (WhatsApp Platform Compatibility Researcher, כותב ראשי), Agent 08 (Notifications), Agent 09 (Reply), Agent 12 (Samsung Device Compatibility) |
| תאריך | 2026-11-15 (כל הקישורים נבדקו בתאריך זה, אלא אם צוין אחרת) |
| מכשיר יעד | Samsung Galaxy S25 Ultra. הנחת הבסיס בבריף הייתה Android 15/16 עם One UI 7/8, אבל ראו ממצא F-0: ייתכן שהמכשיר כבר מריץ One UI 9 על Android 17 |
| אפליקציה | Kotlin, `minSdk 29`, `targetSdk 35`, `NotificationListenerService` ושליחה דרך פעולת ה-Reply של WhatsApp (`RemoteInput`) |
| מצב בדיקה | **שום דבר לא נבדק על מכשיר אמיתי.** אף אחד עדיין לא הריץ את האפליקציה על Galaxy S25 Ultra. כל מסקנה כאן נשענת על תיעוד, על קוד AOSP, על קוד פתוח של אפליקציות דומות ועל דיווחי משתמשים |

> **הסתייגות:** המסמך אינו ייעוץ משפטי. החלקים על תנאי השימוש של WhatsApp ועל דיני הפרטיות בישראל הם הערכת סיכון הנדסית בלבד.

---

## 0. סיכום מנהלים

- **המנגנון קיים ומשמש בפועל ב-2026.** אפליקציות קוד פתוח (Watomatic, commit `e9a6416` מ-2026-05-11, `targetSdk 35`) קוראות את התראות WhatsApp דרך `NotificationListenerService`. הן משיבות בדיוק בשיטה שלנו: `RemoteInput.addResultsToIntent` ואז `PendingIntent.send`. עם זאת, כל זה עדיין לא נבדק אצלנו על המכשיר.
- **חוסם ברירת מחדל ב-Android 15 ומעלה: הסתרת תוכן "רגיש".** בגרסאות אלה מערכת ההפעלה מסתירה ממאזיני התראות "לא מהימנים" את תוכן ההתראות שסווגו כרגישות. במקום התוכן מתקבל הטקסט "Sensitive notification content hidden", וכותרת ההתראה מוחלפת בשם האפליקציה. לפי דיווח של AutoResponder, הסיווג פוגע גם בהודעות **ממספרים שאינם שמורים באנשי הקשר** (כי שם הצ'אט הוא מספר), בהודעות עם רצפי ספרות, ובהודעות שמגיעות אחרי הודעה רגישה עד שהיא נקראת. ב-WhatsApp פרטי זה חלק משמעותי מהתנועה. יש עקיפה רשמית-למחצה לשימוש אישי: `adb shell cmd appops set --user 0 <pkg> RECEIVE_SENSITIVE_NOTIFICATIONS allow`. העקיפה פוגעת בהגנה מפני גניבת קודי OTP, ולכן דורשת החלטה מודעת של המשתמש (ראו F-2).
- **דרישת ה-mutability של `PendingIntent` אינה חוסם.** קוד ה-AOSP של `NotificationManagerService` **זורק חריגה ואינו מפרסם** התראה שיש בה פעולה עם `RemoteInput` אם ה-`PendingIntent` שלה בלתי-ניתן-לשינוי (immutable). מכאן שכל פעולת Reply ש-WhatsApp מצליח לפרסם היא בהכרח mutable וניתנת למילוי על ידינו (ביטחון גבוה).
- **אין אישור מסירה, ואין שליחה בטוחה אחרי שההתראה נעלמה.** `PendingIntent.send()` מחזיר רק "נמסר ל-WhatsApp" ולא "ההודעה נשלחה". התוקף של ה-`PendingIntent` אחרי עדכון או הסרה של ההתראה לא מתועד ותלוי ב-WhatsApp. ההמלצה: לשלוח **רק** כשההתראה עדיין פעילה ב-`getActiveNotifications()`, תמיד עם ה-Action העדכני ביותר, ובלי שום ניסיון חוזר אוטומטי.
- **אחרי מוות של התהליך אפשר להשיב רק במקרים מסוימים.** את ה-`PendingIntent` עצמו אי אפשר לשמור, אבל אחרי חיבור מחדש (`onListenerConnected`) אפשר לשלוף מחדש את ההתראה הפעילה. לכן תשובה אחרי מוות התהליך אפשרית רק אם ההתראה עדיין פעילה, ורק אם הטיוטה והאישור נשמרו מקומית.
- **הבחנה בין צ'אט פרטי לקבוצה אפשרית ברוב המקרים.** ההבחנה נשענת על `EXTRA_IS_GROUP_CONVERSATION`, שבו גם Watomatic משתמש. כשהערך חסר או סותר, יש להיכשל לצד הבטוח (`UNKNOWN_CHAT_KIND`). אנשי קשר חסומים אינם מייצרים התראות כלל, ולכן אי אפשר (וגם לא צריך) לזהות אותם.
- **Samsung:** צריך להגדיר את האפליקציה כ-"Never sleeping", עם סוללה "Unrestricted", לכבות את "Put unused apps to sleep", ולטפל ב-Auto Blocker ובהגדרות המוגבלות (Restricted settings) בהתקנה עצמאית של APK. Dual Messenger (‏WhatsApp שני, משתמש מערכת 95 לפי דיווחי קהילה) עלול לשלוח את התשובה מ**המספר השני**. לכן יש לסנן לפי `sbn.user`.
- **תנאי השימוש של WhatsApp:** התנאים אוסרים "bulk messaging, auto-messaging, auto-dialing" ולקוחות לא רשמיים. אנחנו משתמשים בלקוח הרשמי ושולחים תשובה אחת בכל פעם, באישור אנושי. לכן הסיכון **נמוך-בינוני**, אבל הוא לא אפס ואין אישור רשמי. שליחה אוטומטית ללא אישור תעלה את הסיכון בצורה חדה.

**המלצה:** להמשיך עם הארכיטקטורה הנוכחית (קריאה בלבד, טיוטה, אישור מפורש, שליחה אחת), עם שלושה שינויים:

1. **ברירת המחדל לשליחה היא "העתק ופתח צ'אט"** (המשתמש מדביק ושולח בעצמו). השליחה דרך `RemoteInput` נשארת אופציה ניסיונית שהמשתמש מפעיל במפורש, כמו שכבר מוגדר ב-`BridgeSettings.sendingEnabled = false`.
2. **זיהוי מפורש של התראות מוסתרות** (טקסט redaction, `HIDDEN_CONTENT`) והצגת הסבר למשתמש. אסור לשלוח טקסט מוסתר ל-AI.
3. **לבצע את פרוטוקול הבדיקה בסעיף 5 לפני כל שליחה אמיתית.** בדיקות השליחה (S1-S3) מותנות באישור מפורש של המשתמש ובאיש קשר שהסכים מראש (למשל הטלפון השני של המשתמש עצמו).

---

## 1. טבלת יכולות

**מקרא סטטוסים** (רק הערכים האלה):
- `VERIFIED`: נבדק על מכשיר. **אין כרגע אף שורה כזו.**
- `IMPLEMENTED_UNVERIFIED`: הפלטפורמה תומכת, והתכנון או החוזה שלנו מטפלים בזה.
- `LIMITED`: הפלטפורמה תומכת חלקית או בתנאים.
- `UNSUPPORTED`: בלתי אפשרי.
- `BLOCKED`: חסום כברירת מחדל על ידי מערכת ההפעלה או מדיניות, אלא אם המשתמש מבצע פעולה חריגה.

> **הערת כנות לגבי `IMPLEMENTED_UNVERIFIED`:** נכון ל-2026-11-15, הקוד בריפו הוא **חוזה בלבד**. `core/.../Model.kt` מגדיר את הממשקים, ו-`core/.../Stubs.kt` מכיל מימושי `TODO()`. במודול `app` עדיין אין `NotificationListenerService`. לכן `IMPLEMENTED_UNVERIFIED` כאן פירושו "מכוסה בחוזה ובתכנון (`NotificationSnapshot`, `RejectReason`, `SendOutcome`), טרם מומש סופית וטרם נבדק". יש לעדכן את הטבלה כשהקוד ייכנס.

| # | יכולת | סטטוס | עדות (בקצרה) | ביטחון | מקורות |
|---|---|---|---|---|---|
| 1 | קריאת טקסט של הודעה פרטית מהתראת WhatsApp | `LIMITED` | עובד דרך `EXTRA_MESSAGES` (MessagingStyle) או `EXTRA_TEXT`, כפי ש-Watomatic ו-AutoResponder עושים. התוכן חסר בכמה מקרים: הסתרה "רגישה" ב-15+ (שורה 19), Chat Lock, נעילת אפליקציה, ותצוגה מקדימה כבויה | גבוה שהמנגנון קיים; בינוני לגבי שיעור הכיסוי | [W1], [A1], [AR1] |
| 2 | שם השולח | `LIMITED` | `EXTRA_TITLE` או `Person.name` של ההודעה. השם כפי שנשמר באנשי הקשר, או מספר טלפון לשולח לא מוכר. ב-15+ שולח לא מוכר עלול להיות מוסתר (`[name_error]` לפי AutoResponder) | בינוני | [AR1], [W1] |
| 3 | זהות שיחה יציבה | `LIMITED` | אין מזהה צ'אט ציבורי. אפשר לגזור מזהה מ-`shortcutId`, `tag` ו-`sbn.key` ולהצפין ב-hash (`ConversationKey`). הפורמט של `tag` לא מתועד: ייתכן JID כמו `…@s.whatsapp.net`, ובשנים האחרונות אולי `…@lid`. זו השערה שטעונה בדיקה ב-R4 | נמוך-בינוני | [A2], פרוטוקול R4 |
| 4 | הבחנה בין פרטי לקבוצה | `IMPLEMENTED_UNVERIFIED` | `EXTRA_IS_GROUP_CONVERSATION` / `MessagingStyle.isGroupConversation()`. Watomatic מסתמך עליו ל-WhatsApp, וגם על `android.hiddenConversationTitle`. החוזה כולל `ChatKind.UNKNOWN`, כלומר כשל לצד הבטוח | בינוני-גבוה | [W2], [A2] |
| 5 | הודעות רצופות (burst) | `IMPLEMENTED_UNVERIFIED` | MessagingStyle צובר הודעות (ב-AOSP `MAXIMUM_RETAINED_MESSAGES = 25`). כל הודעה חדשה מפרסמת מחדש את אותה התראה עם ההיסטוריה. דחיית 15 שניות (`DEFAULT_DEBOUNCE_MILLIS`) מתאימה לזה. כמה הודעות WhatsApp כולל בפועל לא ידוע | בינוני | [A2] |
| 6 | כפילויות | `IMPLEMENTED_UNVERIFIED` | כל עדכון מחזיר את כל ההיסטוריה, ובנוסף יש התראת summary של הקבוצה. נדרש dedup לכל הודעה (`EventIds` + `LruDeduplicator` בחוזה). Watomatic נתקל בבעיה דומה ("infinite loop", issue #15) ומסנן התראות ישנות מ-2 דקות | גבוה שיהיו כפילויות | [W1], [W3] |
| 7 | תוכן מוסתר ("N הודעות חדשות", "Sensitive notification content hidden") | `LIMITED` | אפשר לזהות את המצב (טקסט placeholder, כותרת = "WhatsApp") ולדחות עם `HIDDEN_CONTENT`. אי אפשר לשחזר את התוכן | גבוה (זיהוי), אפס (שחזור) | [A3], [AR1] |
| 8 | התראות שהוסרו | `IMPLEMENTED_UNVERIFIED` | `onNotificationRemoved(sbn, rankingMap, reason)` עם `REASON_APP_CANCEL` (8), `REASON_CLICK` (1), `REASON_CANCEL` (2) ועוד. החוזה כולל `onNotificationRemoved(conversationKey)` | גבוה (API); בינוני (התנהגות WhatsApp) | [A4] |
| 9 | הודעות שנערכו או נמחקו | `LIMITED` | לפי דיווחים, ב"מחיקה לכולם" WhatsApp מחליף את התוכן ב-"This message was deleted" או מסיר את ההתראה. על עריכה לא נמצא מקור. חובה לבטל טיוטה שנבנתה על הודעה שנמחקה | נמוך | [D1] |
| 10 | התנהגות במסך נעילה | `LIMITED` | הגדרות "הסתר תוכן" במסך הנעילה משפיעות על **התצוגה** ב-SystemUI בלבד (`publicVersion`). המאזין מקבל את ההתראה המלאה. ההסתרה של OTP במסך הנעילה ב-Android 16 היא תצוגתית. מה שמשפיע על המאזין הוא ההסתרה של שורה 19 | בינוני (מבוסס קוד; לבדוק ב-R9) | [A1], [A5] |
| 11 | זיהוי הודעות שכבר נקראו | `LIMITED` | אין API של סטטוס קריאה. כשקוראים במכשיר אחר (Web/Desktop) או פותחים את הצ'אט, WhatsApp כנראה מסיר את ההתראה, ואנחנו מקבלים removal. אם ההתראה נשארת, אין לנו דרך לדעת | בינוני-נמוך | פרוטוקול R7 |
| 12 | זיהוי אנשי קשר חסומים | `UNSUPPORTED` | הודעות מאנשי קשר חסומים לא נמסרות לנמען (וי אפור אחד אצל השולח), ולכן אין התראה. גם אחרי ביטול החסימה ההודעות לא יגיעו. אין צורך לזהות | בינוני-גבוה | [B1] |
| 13 | תשובה דרך `RemoteInput` | `IMPLEMENTED_UNVERIFIED` | אותו מנגנון כמו Wear OS, Android Auto ו-Watomatic. ה-`PendingIntent` חייב להיות mutable, אחרת ההתראה לא מתפרסמת בכלל (קוד AOSP) | גבוה (מנגנון); בינוני (WhatsApp הנוכחי על S25) | [A6], [W1] |
| 14 | תוקף התשובה אחרי 15 שניות או כמה דקות | `LIMITED` | `PendingIntent` נשאר תקף עד ש-WhatsApp מבטל אותו או מחליף אותו (`FLAG_CANCEL_CURRENT`). לא מתועד. Watomatic משיב רק להתראות שזמנן (`when`) עד 2 דקות. 15 שניות סביר; דקות ארוכות לא ידוע | בינוני (15 שניות), נמוך (דקות) | [W1], פרוטוקול S2 |
| 15 | תשובה אחרי עדכון או הסרה של ההתראה | `LIMITED` | אחרי **עדכון**: להשתמש תמיד ב-Action מה-`sbn` העדכני. אחרי **הסרה**: לא ידוע אם ה-`PendingIntent` עדיין עובד. מדיניות שלנו: לא שולחים (`FAILED_NO_ACTION`) | נמוך (התנהגות), גבוה (המדיניות בטוחה) | [W1], [A4] |
| 16 | תשובה אחרי מוות של התהליך | `LIMITED` | אי אפשר לשמור `PendingIntent` בדיסק. אחרי rebind אפשר לקרוא `getActiveNotifications()` ולשלוף מחדש את ה-Action, בתנאי שההתראה עדיין פעילה ושהטיוטה והאישור נשמרו. ב-Android 15, Force-stop מבטל את ה-`PendingIntent`s **שלנו** ומשאיר את האפליקציה במצב stopped | בינוני | [A4], [A7] |
| 17 | אישור מסירה | `UNSUPPORTED` | `send()` לא מחזיר סטטוס מ-WhatsApp. סימן עקיף: לפעמים WhatsApp מעדכן את ההתראה ומוסיף את התשובה כהודעה "ממני". זה לא אישור מסירה. בחוזה אין `DELIVERED`, וזה נכון | גבוה | [A6] |
| 18 | שרידות ברקע ב-Samsung | `LIMITED` | Samsung מוסיפה את "Put unused apps to sleep", "Sleeping/Deep sleeping apps" ו-Auto-optimize, והגדרות עלולות להתאפס אחרי עדכון One UI. נדרשת הגדרה ידנית (סעיף 6) ומעקב בריאות | בינוני | [S1], [S2], [S3] |
| 19 | הסתרת OTP/תוכן רגיש ב-Android 15 ומעלה | `BLOCKED` (ברירת מחדל) | מאזין לא מהימן מקבל התראה מוסתרת. מהימן = הרשאת `RECEIVE_SENSITIVE_NOTIFICATIONS`, חתימת פלטפורמה, appop `RECEIVE_SENSITIVE_NOTIFICATIONS=allow`, או שיוך CDM (companion device). יש עקיפה ב-adb (appops) לשימוש אישי | גבוה (מנגנון); בינוני (מה Samsung מסווג כרגיש) | [A1], [A3], [H1], [AR1] |
| 20 | התקנה עצמאית והפעלת Notification Access | `LIMITED` | Restricted settings (13+) ו-Enhanced Confirmation Mode (15+) חוסמים הפעלת Notification Access לאפליקציה שהותקנה מקובץ. יש לאשר "Allow restricted settings". Auto Blocker של Samsung חוסם התקנה ממקורות לא מורשים | בינוני-גבוה | [R1], [S4] |
| 21 | הפרדה בין WhatsApp ראשי ל-Dual Messenger / Secure Folder | `LIMITED` | ה-WhatsApp השני רץ כמשתמש מערכת נפרד (95 לפי דיווחים). יש לסנן לפי `sbn.user == Process.myUserHandle()`. לגבי Secure Folder (Knox) לא נמצא מקור. לבדוק ב-R12 | בינוני-נמוך | [S5] |

---

## 2. ממצאים מפורטים לפי שאלת מחקר

### F-0. גרסת מערכת ההפעלה בפועל: ייתכן שהמכשיר כבר על Android 17

לפי דיווחים מספטמבר-אוקטובר 2026, Samsung הפיצה את One UI 9 (Android 17) ל-Galaxy S25. הגרסה היציבה התחילה בקוריאה, ואחריה ארה"ב (Verizon מ-2026-10-02) וגרמניה [V1]. לכן ה-S25 Ultra של המשתמש עשוי להיות כבר על **Android 17**.

- סקרנו את דף שינויי ההתנהגות של Android 17 [A8] ולא מצאנו בו שינוי ישיר ל-`NotificationListenerService`. השינויים הרלוונטיים הם הגנת OTP ב-SMS (לא נוגעת להתראות WhatsApp), מגבלות זיכרון לאפליקציה, וחיזוק BAL שהורחב ל-`IntentSender`.
- חיזוק ה-BAL (Background Activity Launch) רלוונטי **רק אם** ה-`PendingIntent` של Reply ב-WhatsApp הוא מסוג Activity. בדרך כלל זה Broadcast או Service, אבל צריך לבדוק עם `PendingIntent.isActivity()/isBroadcast()/isService()` (API 31) בבדיקה R5.
- **פעולה:** ברישום של כל בדיקה, לתעד `Build.VERSION.SDK_INT`, `Build.DISPLAY` וגרסת One UI.

### F-1 (שאלה 1). מה NotificationListenerService מקבל מ-WhatsApp

**מבנה ההתראה (מבוסס AOSP ו-Watomatic, לא נבדק על מכשיר):**
- `extras["android.messages"]` (`EXTRA_MESSAGES`): מערך Bundles של `MessagingStyle.Message` (טקסט, חותמת זמן, שולח `Person`). AOSP שומר עד 25 הודעות (`MAXIMUM_RETAINED_MESSAGES`), וייתכן ש-WhatsApp כולל פחות. [A2]
- `extras["android.isGroupConversation"]` (`EXTRA_IS_GROUP_CONVERSATION`). מ-API 28 הערך הוא מה שהאפליקציה קבעה ב-`setGroupConversation`. מתחת ל-P הוא נגזר מקיום `conversationTitle` [A2]. ‏WhatsApp מכוון ל-SDK עדכני, אז הערך המפורש קובע.
- `extras["android.conversationTitle"]` (שם הקבוצה), ו-`android.hiddenConversationTitle`. ‏Watomatic קורא את השני כשם הקבוצה ומסיר ממנו סיומת "(N messages)" [W2].
- `extras["android.title"]` ו-`android.text`: בצ'אט פרטי בדרך כלל שם איש הקשר והטקסט האחרון.
- `Notification.getShortcutId()` (שיחות, API 30+), `sbn.tag`, `sbn.id`, `sbn.key`, `groupKey`, `FLAG_GROUP_SUMMARY`. ‏WhatsApp מפרסם גם התראת summary ("X הודעות מ-Y צ'אטים"), ויש לדחות אותה (`GROUP_SUMMARY`).
- `actions[]`: פעולת Reply עם `RemoteInput` שבה `allowFreeFormInput = true`, ובנוסף "Mark as read". ‏Watomatic סורק גם את `WearableExtender.getActions()` ומעדיף Action שהכותרת שלו מכילה "reply" [W1]. **אצלנו הכותרת תהיה בעברית ("השב")**, ולכן אסור להסתמך על הכותרת. צריך לבחור לפי `RemoteInput.allowFreeFormInput` ולפי `SEMANTIC_ACTION_REPLY` (`Action.getSemanticAction()`) אם קיים.

**מקרים מיוחדים:**

| מצב | התנהגות צפויה | ביטחון | הערה |
|---|---|---|---|
| "N הודעות חדשות" או תצוגה מקדימה כבויה | טקסט כללי בלי תוכן | נמוך-בינוני | המקורות סותרים לגבי קיום מתג "Show preview" ב-WhatsApp ל-Android [P1]. לבדוק ב-R8 |
| Chat Lock (צ'אט נעול) | לפי מקורות משניים, ההתראה מסתירה שם ותוכן | נמוך | [P2]. יש לדחות כ-`HIDDEN_CONTENT` |
| נעילת אפליקציה (טביעת אצבע) ב-WhatsApp | Watomatic מציין שחייבים לכבות אותה כדי שהתשובה תעבוד | בינוני | [W4] |
| צ'אט מושתק | לא נמצא מקור מוסמך. צפוי: אין התראה, או התראה שקטה | נמוך | R10 |
| צ'אט בארכיון | תלוי בהגדרה "Keep chats archived". לא נמצא מקור | נמוך | R10 |
| שיחות קוליות או וידאו | התראת `category=call`, ongoing / full-screen. החוזה מסנן (`ONGOING_OR_SYSTEM`) | בינוני | |
| ערוצים (Channels), קהילות, סטטוס | קהילות וקבוצות הכרזות הן שיחות קבוצתיות. ערוצים וסטטוס כנראה בערוץ התראות אחר ובלי Reply. מדיניות: כל דבר בלי Reply או בלי `isGroupConversation == false` מפורש נדחה | נמוך | R11 |
| מדיה (תמונה, קול, מדבקה) | placeholder טקסטואלי (למשל "📷 Photo") ולפעמים URI של תמונה בהודעה (`Message.getDataUri`). לא שולחים מדיה ל-AI | בינוני | |
| נמחק לכולם | "This message was deleted", או הסרת ההתראה | נמוך | [D1] |
| נקרא במכשיר אחר או בצ'אט עצמו | ההתראה מוסרת (`REASON_APP_CANCEL`) | בינוני-נמוך | R7 |
| Advanced Chat Privacy (‏WhatsApp, אפריל 2025) | הגדרה לכל צ'אט שחוסמת ייצוא ו-AI **בתוך WhatsApp**. אין סימן לכך בהתראה ואין לנו דרך לדעת שהצד השני הפעיל אותה | בינוני | [P3]. זו שאלה אתית, ראו סעיף 3 |

**אמינות המאזין:**
- המערכת עלולה לנתק את המאזין, למשל אחרי עדכון האפליקציה, קריסה, או לחץ זיכרון. בזמן `onListenerDisconnected()` מותר לקרוא רק ל-`requestRebind(ComponentName)` [A4]. Watomatic עושה בדיוק את זה [W1].
- ב-`onListenerConnected()` צריך לבצע `getActiveNotifications()` כדי לסנכרן מחדש, כי ייתכן שהתראות התפספסו.
- כדי לזהות שהגישה בוטלה (Settings), אפשר לבדוק `NotificationManagerCompat.getEnabledListenerPackages(context)` בכל פתיחה ובבדיקת בריאות מחזורית. Watomatic מציג התראה "Notification Access Disabled" [W1].
- כפילויות: ראו שורה 6. המפתח ל-dedup צריך להיות hash של (`ConversationKey`, `timestamp`, שולח, טקסט), ולא `sbn.key`, שנשאר זהה בין עדכונים.

### F-2 (שאלה 2). Android 15-17: תוכן רגיש, הסתרת OTP, PendingIntent

**2.1 הסתרת תוכן רגיש (Android 15+): חסם ברירת המחדל המשמעותי ביותר**

- התיעוד הרשמי [A3]: "Android will stop untrusted apps that implement a `NotificationListenerService` from reading unredacted content from notifications where an OTP has been detected. Trusted apps such as companion device manager associations are exempt."
- הקוד (AOSP `NotificationManagerService`, הפונקציות `isAppTrustedNotificationListenerService` ו-`redactStatusBarNotification`) [A1]:
  - מהימן = `checkUidPermission(RECEIVE_SENSITIVE_NOTIFICATIONS)` **או** חתימת פלטפורמה **או** `noteOp(OP_RECEIVE_SENSITIVE_NOTIFICATIONS) == MODE_ALLOWED` **או** שיוך CDM פעיל לאותה חבילה.
  - בהתראה המוסתרת: הכותרת מוחלפת **בשם האפליקציה** ("WhatsApp"), הטקסט מוחלף במחרוזת `redacted_notification_message`, ו-`MessagingStyle` מוחלף בהודעה אחת עם `Person` ריק. `EXTRA_SUB_TEXT` ו-`EXTRA_TEXT_LINES` נמחקים. **הפעולות נשמרות** (אותו `actionIntent` ואותם `RemoteInput`), אבל הכותרת שלהן מוחלפת. `sbn.key` ו-`tag` נשמרים (`cloneShallow`).
  - **השלכה:** גם בהתראה מוסתרת יש כפתור Reply. **אסור** לייצר טיוטה ואסור להשיב, כי אנחנו לא יודעים למה משיבים. יש לדחות כ-`HIDDEN_CONTENT`.
- מי מסווג: ה-`NotificationAssistantService` של המערכת, שמסמן `Adjustment.KEY_SENSITIVE_CONTENT`. ב-Pixel זה Android System Intelligence [M1]. ב-Samsung יש דיווחי קהילה על "Sensitive notification content hidden" ב-One UI 7 (שעונים מחוברים, Phone Link) [M2], [M3]. כלומר זה קורה גם ב-Samsung, אבל לא ברור איזה רכיב מסווג.
- **היקף הסיווג (קריטי ל-WhatsApp):** לפי AutoResponder, אפליקציית תגובה אוטומטית מסחרית ל-WhatsApp, ההסתרה פוגעת ב: (א) הודעות משולחים לא מוכרים, כי שם הצ'אט הוא מספר טלפון; (ב) הודעות עם רצפי ספרות; (ג) הודעות שאחרי הודעה רגישה, עד שהיא נקראת. זה הגיוני, כי MessagingStyle צובר את ההיסטוריה ולכן כל ההתראה רגישה [AR1]. **שורה (א) לבדה מבטלת את המוצר לשולחים לא שמורים** אם לא מבצעים את העקיפה.
- **עקיפות:**
  1. `adb shell cmd appops set --user 0 <applicationId> RECEIVE_SENSITIVE_NOTIFICATIONS allow`. מגיבים ב-Home Assistant אישרו במאי 2025 שזה עובד, והמתחזק סגר את הנושא כ-"by design" [H1]. AutoResponder ממליץ על אותה פקודה [AR1]. **מחיר אבטחתי:** האפליקציה שלנו תקבל גם קודי OTP אמיתיים (בנקים, Google, WhatsApp עצמו). אם האפליקציה תיפרץ, זה בדיוק התרחיש שההגנה נועדה למנוע. **המלצה:** לאפשר את זה רק בהחלטה מודעת של המשתמש, ולחזק את המסנן כך שלעולם לא יעביר ל-AI הודעות שנראות כמו OTP (כבר קיים `sensitiveRequest` ב-`SafetyFlags`).
  2. כיבוי "Enhanced notifications" (ב-Pixel). ב-Samsung לא נמצא מתג כזה באופן ודאי, ומשתמשים דיווחו שהוא לא קיים או הוזז [M4]. לא להמליץ כפתרון עד שתתבצע בדיקה.
  3. שיוך CDM (companion device). זה מתאים לאפליקציות שעון ולא לנו, ולכן לא מומלץ.
- **ב-Android 16** נוספה הסתרה של OTP **במסך הנעילה** (תצוגה בלבד) [M5]. התיעוד הרשמי של שינויי ההתנהגות ב-16 לא מציין שינוי נוסף ל-NLS [A9].
- **Android 16 QPR: סיכומי התראות ומארגן התראות.** מדובר בתכונות SystemUI ו-ASI, בעיקר ב-Pixel. לא נמצאה עדות שהן משנות את מה שמאזין מקבל, ולא נמצאה עדות שהן פעילות ב-Samsung [M6]. ביטחון נמוך. לבדוק אם WhatsApp מופיע תחת "bundle" כלשהו (`REASON_UNAUTOBUNDLED`, `REASON_GROUP_OPTIMIZATION`).

**2.2 mutability של PendingIntent: לא חוסם (ביטחון גבוה)**
- AOSP `NotificationManagerService.checkDisqualifyingFeatures` [A6]:
  ```java
  if ((action.getRemoteInputs() != null || action.getDataOnlyRemoteInputs() != null)
          && hasFlag(mAmi.getPendingIntentFlags(action.actionIntent.getTarget()),
          PendingIntent.FLAG_IMMUTABLE)) {
      throw new IllegalArgumentException(r.getKey() + " Not posted."
              + " PendingIntents attached to actions with remote inputs must be mutable");
  }
  ```
  כלומר מערכת ההפעלה **מסרבת לפרסם** התראה עם Reply שה-`PendingIntent` שלו immutable. לכן כל Reply שאנחנו רואים הוא mutable, ו-`fillIn` של תוצאות `RemoteInput` (‏ClipData / extras) יעבוד. זה גם התנאי ש-Wear OS ו-Android Auto מסתמכים עליו.
- מגבלה: ב-`fillIn` אפשר למלא רק שדות שלא נקבעו, ו-WhatsApp קובע את היעד. אנחנו מוסיפים רק את תוצאות ה-`RemoteInput` [A10].
- הסתייגות: הקוד נלקח מ-mirror של AOSP ב-GitHub (`aosp-mirror/platform_frameworks_base`, ענף `main`), ומועד ה-snapshot המדויק לא אומת. Samsung עשויה לשנות את ה-framework, אבל שינוי כזה ישבור את Wear OS ואת Galaxy Watch, ולכן לא סביר.
- **עדות מעשית מ-2026:** ב-Watomatic, `NotificationService.sendActualReply` (commit `e9a6416`, 2026-05-11, `targetSdk 35`) [W1]:
  ```java
  RemoteInput.addResultsToIntent(new RemoteInput[]{ finalRemoteIn }, localIntent, localBundle);
  notificationWear.getPendingIntent().send(this, 0, localIntent);
  ```
  זה בדיוק המנגנון שלנו. אחרי השליחה Watomatic קורא ל-`cancelNotification(sbn.getKey())`. **אנחנו לא נעשה זאת**, כדי לא להעלים מהמשתמש התראות.

**2.3 עדכון עדכני של Watomatic ואפליקציות דומות**
- Watomatic: הקוד נקרא ישירות משכפול git של הריפו. חיפוש issues לפי "android 15" לא העלה באגים רלוונטיים [W3]. ‏Watomatic לא מטפל בהסתרה הרגישה בקוד שנבדק.
- AutoResponder: מתעד את בעיית ה-redaction ב-Android 15+ ואת העקיפה ב-adb (מקור: תוצאות חיפוש. הדף עצמו חסום ב-proxy, ראו סעיף 9) [AR1].
- WaReply: לא נמצא מידע עדכני.

### F-3 (שאלה 3). תוקף פעולת ה-Reply לאורך זמן

- **מה ידוע:** `PendingIntent` הוא אסימון שהמערכת מחזיקה. הוא נשאר תקף גם אם התהליך של WhatsApp מת, עד ש-WhatsApp קורא ל-`cancel()` או יוצר אסימון חדש עם `FLAG_CANCEL_CURRENT`. עם `FLAG_UPDATE_CURRENT` האסימון הקיים נשאר תקף, והתוכן הפנימי שלו מתעדכן [A10]. אחרי ביטול מתקבלת `PendingIntent.CanceledException`. Watomatic תופס אותה [W1], והחוזה שלנו ממפה אותה ל-`FAILED_CANCELED`.
- **מה לא ידוע (מבחינת WhatsApp):** איך WhatsApp יוצר את ה-PendingIntent (‏requestCode לכל צ'אט? `CANCEL_CURRENT`?). האם הוא מבטל את ה-Reply כשההתראה מוסרת, כשהמשתמש פותח את הצ'אט, או כשהודעה נקראת במכשיר אחר. לא נמצא מקור. **זו השאלה הפתוחה החשובה ביותר לבדיקת S2.**
- **עדות עקיפה:** Watomatic מסרב להשיב להתראות שה-`when` שלהן ישן מ-2 דקות (`MAX_OLD_NOTIFICATION_CAN_BE_REPLIED_TIME_MS`), כדי לא להשיב שוב להתראות שפורסמו מחדש. זה לא מעיד על תוקף ה-PendingIntent [W1].
- **מדיניות מומלצת (Agent 09):**
  1. בלחיצה על "אשר ושלח": לקרוא `getActiveNotifications()`, למצוא את ההתראה העדכנית של אותה `ConversationKey`, ולקחת **ממנה** את ה-Action. אין להשתמש באובייקט שנשמר ב-cache מלפני 15 שניות.
  2. אם אין התראה פעילה: `FAILED_NO_ACTION`, עם הצעה למשתמש "העתק ופתח צ'אט".
  3. אם ההתראה התעדכנה בהודעה חדשה מאז שנבנתה הטיוטה: הטיוטה כבר לא עדכנית (`revision` עולה), והאישור מתבטל. זה כבר קיים בחוזה (`Approval.revision`).
  4. לעולם לא לנסות שוב אוטומטית (`UNKNOWN` לא חוזר על עצמו).
- **מוות תהליך:** את ה-`PendingIntent` אי אפשר לשמור בדיסק כי הוא Parcelable שמחזיק binder. אחרי rebind, הדרך היחידה היא לשלוף מחדש מ-`getActiveNotifications()`. הטיוטה והאישור צריכים להישמר (מוצפנים) כדי שהזרימה תשרוד. אם ההתראה כבר לא פעילה, אי אפשר לשלוח (שורה 16).
- **Force-stop ב-Android 15+:** המערכת מבטלת את כל ה-`PendingIntent`s **של האפליקציה שלנו**, והאפליקציה נשארת stopped עד פעולה של המשתמש [A7]. ייתכן שגם ה-listener לא יחובר מחדש עד שהמשתמש יפתח את האפליקציה. לבדוק ב-R14.

### F-4 (שאלה 4). פרטי לעומת קבוצה; אנשי קשר חסומים

- **פרטי לעומת קבוצה:** נבדוק בשלוש שכבות:
  1. `EXTRA_IS_GROUP_CONVERSATION` (העיקרי; ב-API 28+ זה מה שהאפליקציה קבעה).
  2. אם יש `EXTRA_CONVERSATION_TITLE` או `hiddenConversationTitle` שונה מ-`EXTRA_TITLE`, יש להתייחס לזה כחשד לקבוצה.
  3. אם `Message.getSenderPerson()` מכיל יותר משולח אחד שאינו "אני" באותה התראה, זו קבוצה.
  כל סתירה בין השכבות היא `UNKNOWN`, וההודעה נדחית. **ביטחון בינוני-גבוה** שהדגל הראשון מספיק: Watomatic מחליט עליו לבדו ומציע "תגובה לקבוצות" כאופציה נפרדת [W2]. עם זאת, לפי מקורות משניים WhatsApp מאחד כמה צ'אטים ל-summary, ולכן חובה לדחות `FLAG_GROUP_SUMMARY`.
- **צ'אט עם עצמי ("You"), Meta AI, עסקים ובוטים:** צ'אט עם חשבון עסקי או עם Meta AI הוא פרטי מבחינה טכנית. מומלץ לאפשר רשימת החרגה (`excludedConversations`). לבדוק ב-R11.
- **אנשי קשר חסומים:** לפי WhatsApp, דרך מקורות משניים, הודעות מאיש קשר חסום אינן נמסרות לנמען. אצל השולח מופיע וי אפור אחד, וגם אחרי ביטול החסימה ההודעות לא יגיעו [B1]. לכן לא נוצרת התראה, ואין מה לזהות. **הסטטוס `UNSUPPORTED` הוא גם המצב הרצוי.** חריג: בקבוצה משותפת רואים את ההודעות של החסום, אבל קבוצות ממילא מסוננות.

### F-5 (שאלה 5). Samsung One UI

- **סוללה ושינה:** ‏Samsung מוסיפה מנגנונים שאינם ב-AOSP: "Put unused apps to sleep", הרשימות Sleeping / Deep sleeping / Never sleeping, Auto-optimize ו-Adaptive battery. dontkillmyapp מגדיר את "Put unused apps to sleep" כ"כאב הראש העיקרי ב-Samsung": אפליקציה שלא נפתחה X ימים (לעיתים 3) מוגבלת ברקע [S1]. דף התמיכה של Samsung מתאר את הנתיב Settings > Battery > Background usage limits ואת הרשימה "Never auto sleeping apps" (שם התווית משתנה בין גרסאות) [S2]. עדכוני One UI עלולים להחזיר אפליקציות להגבלות [S3].
- **NLS ו-Samsung:** מאזין התראות הוא שירות שהמערכת עצמה מחברת (bound by system_server), ולכן הוא חי יותר משירות רקע רגיל. אבל העבודה שמתבצעת אחריו (קריאת רשת ל-AI, debounce) כפופה להגבלות התהליך. ב-Android 15 קריאת רשת מחוץ ל-lifecycle תקף נכשלת [A7]. ב-Android 16 יש מכסות JobScheduler/WorkManager לפי standby bucket [A9]. **המלצה:** לבצע את קריאת ה-AI כשהמאזין מחובר, עם timeout קצר, ואם צריך, כ-WorkManager expedited.
- **עמידות ההרשאה:** דווח שאחרי עדכון One UI 7 הגישה להתראות הפסיקה לעבוד ל-Tasker ו-AutoInput [S3]. לא נמצאה עדות לביטול אוטומטי של Notification Access על ידי Samsung. המלצה: בדיקת בריאות בכל פתיחה, והתראה למשתמש כשהגישה כבויה (כמו Watomatic).
- **Dual Messenger:** ה-WhatsApp השני מותקן בפרופיל משתמש נפרד (ID ‏95 לפי פוסטים בקהילה. ה-ID עלול להשתנות, ואפשר לבדוק עם `adb shell pm list users`) [S5]. **סיכון חמור:** אם המאזין מקבל התראות גם מהפרופיל הזה, תשובה תישלח מ**המספר השני**. חובה לסנן `sbn.getUser() == android.os.Process.myUserHandle()`, ולהוסיף `userId` לחישוב `ConversationKey`. לבדוק ב-R12.
- **Secure Folder:** ‏Knox, פרופיל נפרד. לא נמצא מקור על התנהגות המאזין מול Secure Folder. מומלץ לא להתקין WhatsApp או את NOA ב-Secure Folder. התיעוד של Android מציין שמאזין בפרופיל עבודה מתעלמים ממנו [A4].
- **Edge lighting:** תכונת תצוגה של SystemUI. לא צפויה השפעה על המאזין (ביטחון בינוני, לא נמצא מקור).
- **מצבי מערכת:** מצב שינה, DND, Modes & Routines משפיעים על ההפרעה ולא על המסירה למאזין (ביטחון בינוני). לבדוק ב-R13.
- **Auto Blocker** (One UI 6.1.1+, Settings > Security and privacy > Auto Blocker) חוסם התקנה שלא דרך Play Store או Galaxy Store. במכשירים שיצאו עם 6.1.1 ומעלה הוא פעיל כברירת מחדל [S4]. ייתכן שהוא חוסם גם פקודות USB (adb). זה לא אומת, ראו שאלה פתוחה Q8.
- **Restricted settings / ECM:** אפליקציה שהותקנה מקובץ (דפדפן, מנהל קבצים) לא תוכל לקבל Notification Access עד שהמשתמש יאשר App info > ⋮ > "Allow restricted settings". האפשרות מופיעה רק אחרי ניסיון ראשון שנחסם [R1]. התקנה דרך adb או Android Studio כנראה לא מסומנת כ-sideload מוגבל (ביטחון בינוני).
- **Play Protect "Enhanced fraud protection":** חוסם התקנה של APK ממקור אינטרנטי שמבקש NLS, SMS או Accessibility. התכונה פעילה במדינות מסוימות (סינגפור, הודו, ברזיל, תאילנד, מלזיה ועוד). לא מצאנו שישראל ברשימה [R2]. **אימות מפתחים** לאפליקציות מחוץ ל-Play נאכף מ-2026-09-30 בברזיל, אינדונזיה, סינגפור ותאילנד, וגלובלית ב-2027 [R3]. בישראל זה עוד לא חל (נכון לתאריך המסמך), אבל צריך לתכנן קדימה.

### F-6 (שאלה 6). תנאי השימוש של WhatsApp ומדיניות Google Play

ראו סעיף 3 להערכת הסיכון. עובדות:
- תנאי השימוש (ציטוט ממקור ראשוני, גרסת EEA מ-2021, דרך תוצאות חיפוש. האתר עצמו חסום ב-proxy): השימוש אסור לשליחת "illegal or impermissible communications such as **bulk messaging, auto-messaging, auto-dialing**, and the like" [T1]. מקורות משניים מציינים גם איסור על "non-personal use" ועל גישה "through automated means" בגרסת UK מ-2025 [T2].
- מרכז העזרה של WhatsApp: "not intended for bulk or automated messaging, both of which have always been a violation of our Terms of Service". הודעה מ-2019 על נקיטת צעדים משפטיים [T3].
- לקוחות לא רשמיים (GB/Plus): חסימה זמנית, ואחריה עלולה לבוא חסימה קבועה [T4]. **אנחנו לא לקוח לא רשמי**: המשתמש משתמש ב-WhatsApp הרשמי, ו-NOA מפעילה פעולה ש-WhatsApp עצמו חושף למערכת ההפעלה.
- **WhatsApp Business Platform (Cloud API)** דורש מספר עסקי רשום, ואינו מאפשר להשתמש במספר האישי במקביל לאפליקציה הרגילה. מאוקטובר 2025 ה-Business Solution Terms אוסרים "AI Providers" של צ'אטבוטים כלליים (חל על ספקים קיימים מ-2026-01-15). הרשות האיטלקית (AGCM) הטילה צעדי ביניים בדצמבר 2025, והנציבות האירופית פתחה הליך. מצב ההחלטה הסופית לא ברור [T5]. כל זה נוגע ל-Business Platform בלבד, לא לחשבון אישי.
- **Google Play:** לא מצאנו טופס הצהרה ייעודי ל-Notification Listener. חלה המדיניות הכללית של "Permissions and APIs that Access Sensitive Information": שימוש רק לפונקציה מרכזית, גילוי בולט, וכיבוד סירוב [G1]. Play Protect מתייחס ל-NLS כהרשאה בסיכון גבוה באפליקציות שהותקנו מחוץ לחנות [R2]. **רלוונטי רק אם יפורסם.** ל-APK אישי שמותקן ידנית, Play לא חל, אבל Play Protect, Restricted settings ו-Auto Blocker כן חלים.

### F-7 (שאלה 7). פרטיות בישראל: תמצית מעשית (לא ייעוץ משפטי)

- **תיקון 13 לחוק הגנת הפרטיות** נכנס לתוקף ב-2025-08-14. הוא הרחיב הגדרות (כולל מזהים דיגיטליים ומידע בעל רגישות מיוחדת), הקנה סמכויות אכיפה ועיצומים לרשות להגנת הפרטיות, ושינה חובות לגבי מאגרים [L1]. הרשות פרסמה ב-2025-04-30 טיוטת הנחיה לגבי AI. הטיוטה ממליצה על תסקיר השפעה (DPIA) לפני עיבוד מידע אישי ב-AI ומדגישה בסיס חוקי, שקיפות ואבטחה [L2].
- **ההקשר שלנו:** NOA מעבדת הודעות של **צדדים שלישיים** (אנשי הקשר) ושולחת אותן לספק AI בענן, ייתכן מחוץ לישראל. גם אם יש החרגה לשימוש אישי שאינו עסקי, הצעדים המעשיים הבאים מומלצים:
  1. **מינימיזציה:** לשלוח רק את הטקסט הנחוץ לטיוטה (ההודעות האחרונות בצ'אט), בלי מספרי טלפון, ועם `ConversationKey` מוצפן ב-hash, כפי שהחוזה כבר מגדיר.
  2. **ספק עם zero-retention ובלי אימון על הנתונים.** הסכם עיבוד אם קיים. להבין לאן הנתונים מועברים (תקנות העברת מידע לחו"ל).
  3. **הסכמה:** `cloudConsentGiven` של המשתמש. מומלץ ליידע אנשי קשר קבועים שהמשתמש נעזר ב-AI לניסוח, ולאפשר החרגה פשוטה לכל צ'אט.
  4. **החרגת תוכן רגיש:** לא לשלוח ל-AI הודעות שנראות כמו OTP, מידע רפואי, פיננסי או סיסמאות, ולא צ'אטים שהמשתמש סימן. Advanced Chat Privacy של הצד השני הוא אות ש**אין לנו** דרך לזהות. זו עוד סיבה להחרגה ידנית.
  5. **שמירה:** לא לשמור תוכן הודעות בלוגים, לא בצד הלקוח ולא בצד השרת. למחוק טיוטות אחרי שליחה או פקיעה. במצב אבחון (בדיקות R) לשמור רק מטא-דאטה (מפתחות, סוגים, אורכים).
  6. **אבטחה:** הצפנה בתעבורה (כבר קיים ב-API_CONTRACT: HTTPS, device token, nonce) ובאחסון המקומי.

---

## 3. הערכת סיכון: תנאי השימוש של WhatsApp

| תרחיש | הערכה | נימוק |
|---|---|---|
| **תשובה אחת, מאושרת ידנית, לצ'אט פרטי שבו הצד השני פנה ראשון, מהחשבון האישי, דרך ה-Reply של ההתראה** | **נמוך-בינוני** | לקוח רשמי. מנגנון זהה ל-Wear OS, Android Auto ותשובה ישירה מההתראה. נפח אנושי. אין פנייה יזומה ואין שליחה המונית. האיסור מכוון ל-"bulk / auto-messaging". עם זאת: (א) אין שום אישור רשמי של WhatsApp ל-AI שמנסח בשם המשתמש; (ב) לפי התנאים, WhatsApp רשאי לחסום לפי שיקול דעתו; (ג) דיווחי ספאם מהצד השני הם טריגר חסימה מוכר |
| אותו דבר, אבל שליחה אוטומטית בלי אישור | **בינוני-גבוה** | זה בדיוק "auto-messaging". אפליקציות כמו Watomatic ו-AutoResponder פועלות כך שנים, ואין בידינו נתונים על שיעורי חסימה. **לא לעשות** |
| שליחה יזומה (צ'אט חדש), שליחה לרבים, קבוצות | **גבוה** | נוגע ישירות ב-bulk ובספאם. מחוץ לתחום, וחסום בתכנון |
| כל שימוש ב-WhatsApp Web, ספריות לא רשמיות, WhatsApp מותאם, Accessibility | **גבוה** | לקוח לא רשמי או אוטומציה. מחוץ לתחום, לפי הבריף |

> **עיקרון:** הסיכון הנמוך נשען על כך ש**ההתנהגות עצמה** אנושית (מעט הודעות, אישור לכל אחת, רק תשובות), ולא על כך ש-WhatsApp "לא יכול לזהות" את האפליקציה. אין לתכנן מנגנוני הסוואה.

**בקרות מומלצות** (חלקן כבר בחוזה):
1. אישור מפורש לכל הודעה (`Approval`, single-use, קשור ל-hash של הטקסט). אין שליחה אוטומטית.
2. מגבלת קצב: לדוגמה, לא יותר מתשובה אחת לכל צ'אט בכל burst. יעד סביר לשימוש אישי: עד 30 שליחות ביום. המספר הוא שיקול תכנוני ולא סף של WhatsApp.
3. משיבים רק לצ'אט שבו יש הודעה נכנסת פעילה (התראה קיימת). אין פנייה יזומה.
4. מתג חירום (`emergencyStopped`) ועצירה גלובלית.
5. **ברירת מחדל בטוחה יותר: "העתק ופתח צ'אט".** הטיוטה מועתקת ללוח, ו-NOA מפעילה את `contentIntent` של ההתראה מתוך Activity בחזית כדי לפתוח את הצ'אט. המשתמש מדביק ולוחץ "שלח" בעצמו. מבחינת WhatsApp זו הקלדה רגילה של המשתמש, כמעט אפס סיכון. החיסרון: עוד שתי לחיצות.

**חלופה: WhatsApp Business Platform.** הפלטפורמה הרשמית לאוטומציה, אבל דורשת **מספר נפרד** שמזוהה כעסק. המשתמש **אינו רוצה** מספר נפרד שיתחזה למספר האישי, ואנחנו מסכימים: חשבון עסקי שמשיב בשם אדם פרטי יבלבל את אנשי הקשר, ולכן הוא לא מתאים לשימוש אישי. בנוסף, תנאי ה-Business Solution מגבילים צ'אטבוטים כלליים (2025-2026, בהליכים רגולטוריים באיחוד האירופי) [T5]. **אם בעתיד יהיה ל-NOA שימוש עסקי** (נפרד מהחשבון האישי, בשם העסק), זה המסלול הנכון לאותו שימוש. אין להשתמש בו כתחליף לחשבון האישי.

---

## 4. השלכות על התכנון (Agents 07/08/09)

1. **`HIDDEN_CONTENT` מורחב:** לזהות את (א) מחרוזת ה-redaction של המערכת (בעברית ובאנגלית, מתועדת ב-R3); (ב) כותרת = label של WhatsApp + MessagingStyle עם `Person` ריק; (ג) טקסטים כלליים ("N new messages", "הודעה חדשה"). ההחלטה צריכה להתבסס על **מבנה**, ולא רק על מחרוזת, כי השפה תלויה ב-locale.
2. **סינון משתמש:** `sbn.user == myUserHandle()`. להכניס את `userId` לחישוב `ConversationKey`.
3. **בחירת Action:** לפי `RemoteInput.allowFreeFormInput` ו-`semanticAction == SEMANTIC_ACTION_REPLY`, ולא לפי כותרת.
4. **שליחה:** תמיד מ-`getActiveNotifications()` טרי, ותמיד `send(context, 0, fillIn)` עם `addResultsToIntent` ו-`RemoteInput.setResultsSource(intent, SOURCE_FREE_FORM_INPUT)`. לתפוס `CanceledException`. לא לקרוא ל-`cancelNotification`.
5. **מעקב תוצאה עקיף:** אחרי שליחה, להאזין 10-20 שניות לעדכון ההתראה. אם מופיעה הודעה "ממני" עם הטקסט ששלחנו, אפשר לרשום "WhatsApp קלט את התשובה". **זה לא `DELIVERED`.** להציג למשתמש "נשלח ל-WhatsApp, בדוק בצ'אט".
6. **בריאות:** לבדוק `getEnabledListenerPackages`, `onListenerDisconnected` → `requestRebind`, ו-`onListenerConnected` → resync. להציג מסך "מצב מערכת" עם: הרשאה, Never-sleeping, Unrestricted, ו-appop של תוכן רגיש (אפשר לבדוק עם `AppOpsManager.unsafeCheckOpNoThrow` למחרוזת `android:receive_sensitive_notifications`. זמינות המחרוזת לא אומתה, ראו Q6).
7. **פרטיות במצב אבחון:** dump של מבנה ההתראה (מפתחות, סוגים, אורכים, דגלים) **בלי תוכן**, אלא אם מדובר באיש הקשר המיועד לבדיקה.

---

## 5. פרוטוקול בדיקה על מכשיר אמיתי (Galaxy S25 Ultra)

**כללים:**
- **אף אחת מבדיקות R (קריאה בלבד) לא שולחת הודעה.** ב-build הבדיקה `sendingEnabled` חייב להיות `false`, ויש לוודא זאת במסך ההגדרות לפני תחילת הבדיקות.
- **בדיקות S (שליחה) מותנות באישור מפורש ובכתב של המשתמש לפני כל בדיקה**, ונעשות רק מול **איש קשר שהסכים מראש**. ההמלצה: הטלפון השני של המשתמש עצמו, עם מספר WhatsApp אחר. כל בדיקת S שולחת **הודעה אחת** בלבד.
- בכל בדיקה יש לרשום: תאריך ושעה, `Build.DISPLAY`, `SDK_INT`, גרסת One UI, גרסת WhatsApp (Settings › Apps › WhatsApp), גרסת NOA, ותוצאה **צפויה** מול **בפועל**.
- שלא לשתף צילומי מסך עם תוכן הודעות של צדדים שלישיים. להשתמש רק בהודעות מהטלפון השני.
- כלי עזר (אופציונלי, דורש USB debugging): `adb shell dumpsys notification --noredact` כדי לראות את רשומות ההתראות. **הפלט מכיל תוכן**, ולכן יש להפעיל אותו רק כשההתראות הפעילות שייכות לטלפון הבדיקה, ולמחוק אותו אחרי כן.

### שלב A: הכנה

| # | בדיקה | צעדים | צפוי | לתעד |
|---|---|---|---|---|
| R0 | התקנה והרשאה | להתקין את ה-APK (מומלץ דרך adb או Android Studio). לפתוח NOA ולבקש Notification Access | אם הותקן מקובץ: חסימת "Restricted setting", ואז App info › ⋮ › Allow restricted settings, ואז הפעלה מוצלחת. ייתכן דיאלוג Auto Blocker או Play Protect | שיטת ההתקנה, אילו דיאלוגים הופיעו (צילום בלי תוכן), האם הגישה הופעלה |
| R1 | חיבור המאזין | לפתוח את מסך "מצב מערכת" ב-NOA | `onListenerConnected` נקרא, והרשאה = מופעלת | חותמת זמן החיבור |

### שלב B: קריאה בלבד (בלי שליחה)

| # | בדיקה | צעדים | צפוי | לתעד |
|---|---|---|---|---|
| R2 | הודעה פרטית בסיסית מאיש קשר שמור | מהטלפון השני (שמור באנשי הקשר) לשלוח "בדיקה 1" | התראה מתקבלת. `isGroupConversation=false`. יש Reply עם `allowFreeFormInput=true`. טיוטה נוצרת אחרי כ-15 שניות (אם יש הסכמה לענן; אחרת רק סטטוס) | `sbn.key`, `tag`, `id`, `channelId`, `category`, `shortcutId`, `groupKey`, flags, רשימת מפתחות extras, מספר `EXTRA_MESSAGES`, מבנה Actions (כותרות, `semanticAction`, `resultKey`) |
| R3 | **הסתרת תוכן רגיש** | (א) מהטלפון השני לשלוח "הקוד שלך הוא 482913". (ב) לשלוח מ**מספר לא שמור**: למחוק זמנית את איש הקשר או להשתמש בטלפון שלישי שהסכים. (ג) לשלוח "שלום" רגיל אחרי (א), לפני קריאה | (א) ו-(ב) מוסתרים: כותרת "WhatsApp" וטקסט redaction. (ג) כנראה גם מוסתר, כי ההיסטוריה מצטברת. NOA דוחה עם `HIDDEN_CONTENT` ולא שולחת כלום ל-AI | הטקסט המדויק של ה-redaction (לצורך הזיהוי), האם ה-Reply קיים בהתראה המוסתרת, מתי ההסתרה נעלמת |
| R3b | (אופציונלי, החלטת משתמש) appop | **רק אחרי שהמשתמש קרא את סעיף F-2 והחליט.** להריץ `adb shell cmd appops set --user 0 <applicationId> RECEIVE_SENSITIVE_NOTIFICATIONS allow` ולחזור על R3 | התוכן גלוי. המסנן של NOA עדיין מסמן OTP כ-`sensitiveRequest` ולא שולח ל-AI | האם עבד, ופקודת הביטול: `... deny` / `default` |
| R4 | זהות שיחה | שתי הודעות מאותו איש קשר בהפרש של דקה, ואז הודעה מאיש קשר אחר | `ConversationKey` יציב לאותו איש קשר ושונה לאחר | פורמט `tag` ו-`shortcutId` (**להסתיר** ספרות בתיעוד: `972*****@s.whatsapp.net` או `@lid`) |
| R5 | סוג ה-PendingIntent | מתוך R2: לרשום `actionIntent.isImmutable()`, `isBroadcast()`, `isService()`, `isActivity()` (API 31+), ו-`creatorPackage` | mutable = true. Broadcast או Service | התוצאה. אם זה Activity, לסמן סיכון BAL ב-Android 17 |
| R6 | burst ו-debounce | 5 הודעות ברצף מהטלפון השני, בהפרש של כ-3 שניות | התראה אחת מתעדכנת 5 פעמים. dedup לכל הודעה. טיוטה אחת כ-15 שניות אחרי האחרונה | מספר `onNotificationPosted`, מספר ההודעות ב-`EXTRA_MESSAGES` בכל עדכון, כפילויות שנחסמו |
| R7 | נקרא במכשיר אחר / נפתח | (א) לפתוח את הצ'אט ב-WhatsApp בטלפון. (ב) בהודעה חדשה, לקרוא ב-WhatsApp Web | ההתראה מוסרת עם `REASON_APP_CANCEL`. הטיוטה מתבטלת או מסומנת "ההתראה נעלמה" | `reason` של ההסרה, ובאיזה עיכוב |
| R8 | תוכן מוסתר ב-WhatsApp | ב-WhatsApp › Settings › Notifications לבדוק אם קיים "Show preview" ולכבות. לשלוח הודעה | טקסט כללי, ו-NOA מסמנת `HIDDEN_CONTENT` | אם המתג קיים, הטקסט הכללי. להחזיר את ההגדרה למצב הקודם |
| R9 | מסך נעילה | Settings › Notifications › Lock screen notifications › "Hide content". לנעול את המכשיר ולשלוח הודעה | המסך מסתיר את התוכן, אבל NOA מקבלת את התוכן המלא | האם NOA קיבלה תוכן מלא |
| R10 | מושתק / ארכיון | להשתיק את צ'אט הבדיקה, לשלוח הודעה. אחר כך להעביר לארכיון ולשלוח | מושתק: אין התראה או התראה שקטה. ארכיון: תלוי ב-"Keep chats archived" | האם הגיעה התראה, ומה ה-importance |
| R11 | קבוצה, ערוץ, סטטוס, קהילה, שיחה, Meta AI | הודעה בקבוצת בדיקה שבה הטלפון השני חבר. תגובה לסטטוס. שיחה קולית מהטלפון השני (לא לענות) | קבוצה: `isGroupConversation=true` ונדחית (`GROUP`). שיחה: `ONGOING_OR_SYSTEM`. אין טיוטה באף מקרה | הדגלים בכל מקרה. **אם הגיעה טיוטה בקבוצה, זה כשל חוסם** |
| R12 | Dual Messenger (רק אם מותקן) | לשלוח הודעה ל-WhatsApp השני | NOA מסננת (`sbn.user` אחר) | `sbn.user.identifier`. האם בכלל התקבלה |
| R13 | DND / מצב שינה | להפעיל Do not disturb ולשלוח הודעה | NOA מקבלת את ההתראה (ייתכן שבלי צליל) | האם התקבלה |
| R14 | שרידות | (א) להשאיר את המכשיר 8 שעות או יותר בלי לפתוח את NOA ולשלוח הודעה. (ב) להחליק את NOA מ-Recents. (ג) לאתחל. (ד) Force stop (ב-Android 15 צפוי ש-NOA לא תחזור עד פתיחה) | (א) עד (ג): הודעה נקלטת. (ד): לא נקלטת עד פתיחה | זמני חיבור וניתוק, מצב ה-Sleeping lists ב-Battery |
| R15 | מחיקה ועריכה | מהטלפון השני: לשלוח, ואז "מחק לכולם" לפני 15 שניות. בפעם אחרת: לערוך הודעה | מחיקה: הטיוטה מתבטלת (placeholder או removal). עריכה: לתעד מה קורה | השינוי בהתראה |
| R16 | עדכון מערכת | אחרי כל עדכון One UI או WhatsApp, לחזור על R1, R2, R3, R5 | ללא שינוי | גרסאות לפני ואחרי |

### שלב C: שליחה (כל בדיקה מחייבת אישור מפורש ובכתב של המשתמש לפני הביצוע)

> **תנאי סף:** כל בדיקות R2, R5, R6, R7 ו-R11 עברו. איש הקשר בבדיקה הוא הטלפון השני של המשתמש או אדם שהסכים במפורש. המשתמש הפעיל `sendingEnabled` בעצמו. **הודעה אחת לכל בדיקה.**

| # | בדיקה | צעדים | צפוי | לתעד |
|---|---|---|---|---|
| S1 | **שליחה אחת מאושרת** | הטלפון השני שולח "בדיקת שליחה". NOA מכינה טיוטה (או טקסט קבוע "בדיקת NOA ✓"). המשתמש מאשר במסך האישור | `SendOutcome.ATTEMPTED`. ההודעה מופיעה בטלפון השני **פעם אחת**, מהמספר האישי. ההתראה בטלפון הראשי מתעדכנת או נעלמת | האם הגיעה, כמה פעמים, ממי, עיכוב, השינוי בהתראה (הודעה "ממני"?), סימני הווי |
| S2 | תוקף לאורך זמן | הודעה חדשה מהטלפון השני. **לא לפתוח את הצ'אט.** לחכות 2 דקות, ואז לאשר ולשלוח | ATTEMPTED וההודעה מגיעה, או `FAILED_CANCELED` | התוצאה. אם עבר, אפשר (באישור נפרד) לחזור עם 10 דקות |
| S3 | אחרי הסרה | הודעה חדשה, ואז החלקת ההתראה (dismiss), ואז ניסיון לאשר ב-NOA | NOA מחזירה `FAILED_NO_ACTION` ו**לא שולחת**, ומציעה "העתק ופתח צ'אט" | שלא נשלח כלום |

אם משהו לא צפוי קורה (למשל שתי הודעות, שליחה לצ'אט אחר, או שליחה מהמספר השני), **לעצור מיד** (`emergencyStop`), לא לחזור על הבדיקה, ולפתוח באג חוסם.

---

## 6. רשימת הגדרות Samsung למשתמש

> שמות התפריטים מבוססים על מקורות באנגלית (One UI 6-7). בממשק העברי ובגרסאות 8 ו-9 הניסוח עשוי להיות שונה מעט. השמות שבסוגריים הם תרגום משוער ולא בהכרח הטקסט המדויק במכשיר.

1. **התקנה:**
   - אם מתקינים מקובץ: Settings › Security and privacy › **Auto Blocker** (חוסם אוטומטי). לכבות זמנית להתקנה, ולהחזיר אחריה (שים לב: עדכונים עתידיים ידרשו שוב).
   - חלופה מומלצת: התקנה דרך adb או Android Studio. אם Auto Blocker חוסם גם USB, לכבות אותו לזמן ההתקנה.
2. **הרשאות מוגבלות:** אחרי ניסיון ראשון שנחסם להפעיל גישה להתראות: Settings › Apps › NOA Bridge › ⋮ › **Allow restricted settings** (התר הגדרות מוגבלות).
3. **גישה להתראות:** מתוך NOA, הכפתור "פתח הגדרות" (מוביל ל-`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS`). ידנית: Settings › Notifications › Advanced settings › **Notification access / Device & app notifications** (גישה להתראות) › NOA Bridge › הפעלה. *(הנתיב המדויק ב-One UI 9 טרם אומת.)*
4. **סוללה, לא להרדים:** Settings › Battery › **Background usage limits** (הגבלות שימוש ברקע) ›
   - **Never sleeping apps** (אפליקציות שלעולם אינן נרדמות; בחלק מהגרסאות "Never auto sleeping apps") › הוספת NOA Bridge.
   - לוודא ש-NOA **לא** מופיעה ב-Sleeping apps או ב-Deep sleeping apps.
   - לשקול לכבות **Put unused apps to sleep** (הרדם אפליקציות שאינן בשימוש). חלופה: לוודא ש-NOA ברשימת Never sleeping.
5. **סוללה, לא להגביל:** Settings › Apps › NOA Bridge › Battery › **Unrestricted** (ללא הגבלה).
6. **לא להסיר הרשאות:** Settings › Apps › NOA Bridge › לכבות **Remove permissions if app is unused** / **Pause app activity if unused** (הסר הרשאות אם האפליקציה אינה בשימוש).
7. **WhatsApp:**
   - Settings › Apps › WhatsApp › Notifications: מופעלות, כולל קטגוריית ההודעות.
   - ב-WhatsApp: Settings › Notifications: התראות הודעות פעילות. לבדוק "Show preview" (אם קיים) כמופעל.
   - ב-WhatsApp: Settings › Privacy › **App lock / Fingerprint lock**: כבוי (אחרת התשובה עלולה להיכשל, לפי Watomatic).
   - צ'אטים שרוצים ש-NOA תטפל בהם: לא נעולים ב-Chat lock ולא מושתקים.
8. **לא להשתמש ב-NOA על Dual Messenger או Secure Folder.** אם Dual Messenger מותקן, לוודא ש-NOA מציגה "מסנן משתמש פעיל".
9. **תוכן רגיש (Android 15+):** להחליט במודע (ראו F-2) אם להריץ את פקודת ה-appops. בלעדיה, הודעות משולחים לא שמורים ומהודעות עם ספרות לא יטופלו.
10. **אחרי כל עדכון One UI:** לחזור על סעיפים 3-6, ולהריץ את בדיקה R16.

---

## 7. שאלות פתוחות

| # | שאלה | איך נסגור |
|---|---|---|
| Q1 | האם WhatsApp מבטל את ה-PendingIntent של Reply כשההתראה מוסרת, כשהצ'אט נפתח, או כשההודעה נקראת במכשיר אחר? | S2, S3, R7 |
| Q2 | איזה רכיב מסווג "תוכן רגיש" ב-Samsung, ומה בדיוק הוא תופס בהודעות WhatsApp בעברית (מספרי טלפון, תאריכים, סכומים)? | R3 על מגוון הודעות |
| Q3 | פורמט `tag` ו-`shortcutId` של WhatsApp ב-2026 (JID / LID), והאם הם יציבים בין עדכונים | R4, R16 |
| Q4 | האם קיים ב-WhatsApp ל-Android מתג "Show preview", ומה הטקסט כשהוא כבוי? מה מציג Chat lock? | R8 ו-Chat lock בבדיקה ידנית |
| Q5 | התנהגות במחיקה או עריכה, בצ'אט מושתק ובארכיון | R10, R15 |
| Q6 | האם `AppOpsManager` חושף למאזין דרך לבדוק את ה-appop של תוכן רגיש? (שם המחרוזת לא אומת) | בדיקת קוד על המכשיר |
| Q7 | האם המאזין ב-user 0 מקבל התראות מ-Dual Messenger (user 95) ומ-Secure Folder? | R12 |
| Q8 | האם Auto Blocker חוסם גם adb install ב-S25 על One UI 9? | R0 |
| Q9 | האם One UI 9 (Android 17) שינה משהו ב-Notification Access, בסיווג רגיש או ב-BAL של PendingIntent? | R0-R5 על המכשיר, ו-[A8] |
| Q10 | האם ההתראה של WhatsApp מתעדכנת עם התשובה שלנו כהודעה "ממני", ואפשר להסתמך על זה כאות "נקלט"? | S1 |
| Q11 | עמדה רשמית של WhatsApp לגבי ניסוח בעזרת AI מחשבון אישי: לא נמצאה. האם יש עדכון בתנאים ל-2026? | בדיקה חוזרת של whatsapp.com/legal כשהגישה תתאפשר |

---

## 8. מקורות (נבדקו ב-2026-11-15)

**Android / AOSP**
- [A1] AOSP `NotificationManagerService.java`: `isAppTrustedNotificationListenerService`, `redactStatusBarNotification`. https://github.com/aosp-mirror/platform_frameworks_base/blob/main/services/core/java/com/android/server/notification/NotificationManagerService.java (נקרא דרך raw.githubusercontent.com. מועד ה-snapshot לא אומת)
- [A2] AOSP `Notification.java`: `EXTRA_MESSAGES`, `EXTRA_IS_GROUP_CONVERSATION`, `MessagingStyle.isGroupConversation`, `MAXIMUM_RETAINED_MESSAGES = 25`. https://github.com/aosp-mirror/platform_frameworks_base/blob/main/core/java/android/app/Notification.java
- [A3] Android 15, Behavior changes: all apps (OTP Redaction). https://developer.android.com/about/versions/15/behavior-changes-all
- [A4] `NotificationListenerService` reference (`requestRebind`, `onListenerDisconnected`, work profiles) ו-`REASON_*` ב-AOSP `NotificationListenerService.java`. https://developer.android.com/reference/android/service/notification/NotificationListenerService
- [A5] `Notification.Builder#setPublicVersion` (בהקשר screenshare ומסך נעילה), מתוך [A3]
- [A6] AOSP `NotificationManagerService.checkDisqualifyingFeatures`: "PendingIntents attached to actions with remote inputs must be mutable". ראו [A1]
- [A7] Android 15, package stopped state (ביטול PendingIntents ב-force stop) והגבלות רשת ברקע, מתוך [A3]
- [A8] Android 17, Behavior changes: all apps / targeting 17. https://developer.android.com/about/versions/17/behavior-changes-all , https://developer.android.com/about/versions/17/behavior-changes-17
- [A9] Android 16, Behavior changes: all apps. https://developer.android.com/about/versions/16/behavior-changes-all
- [A10] Pending intents risks / mutability and `fillIn`. https://developer.android.com/privacy-and-security/risks/pending-intent

**אפליקציות דומות וקהילה**
- [W1] Watomatic `NotificationService.java`, `NotificationUtils.java` (commit `e9a6416`, 2026-05-11, `targetSdk 35`). https://github.com/adeekshith/watomatic (נקרא דרך `git clone`. ה-API של gh חסום ל-repo זה בסשן)
- [W2] Watomatic `NotificationReplyDecider.java` (`android.isGroupConversation`), ו-`NotificationUtils.getTitle` (`android.hiddenConversationTitle`). אותו מקור
- [W3] Watomatic issues (חיפוש "android 15"; issue #15 על לולאת תגובות). https://github.com/adeekshith/watomatic/issues?q=is%3Aissue+android+15
- [W4] Watomatic README, Troubleshooting (fingerprint lock). https://github.com/adeekshith/watomatic#troubleshooting
- [AR1] AutoResponder: "Sensitive notification content hidden from AutoResponder since Android 15 (fixable)" ו-"Android 15+: Optionally allow AutoResponder to receive sensitive notifications". https://www.autoresponder.ai/post/sensitive-notification-content-hidden-since-android-15 , https://www.autoresponder.ai/post/android-15-allow-sensitive-notifications (**האתר חסום ב-proxy. התוכן מתוך תוצאות WebSearch**)
- [H1] home-assistant/android issue #5153, "Sensitive notification content hidden" (Mar-Nov 2025, פקודת appops). https://github.com/home-assistant/android/issues/5153
- [M1] Android Authority, "Here's how Android 15 protects your two-factor authentication codes" (ASI מסווג). https://www.androidauthority.com/android-15-two-factor-authentication-codes-3492585/ (חסום. מתוך WebSearch)
- [M2] Samsung Community EU, "Sensitive notification content hidden" (One UI 7). https://eu.community.samsung.com/t5/discussion/sensitive-notification-content-hidden/td-p/11954709 (מתוך WebSearch)
- [M3] Microsoft Q&A, "Hidden content notification" (Phone Link). https://learn.microsoft.com/en-us/answers/questions/5858122/hidden-content-notification (מתוך WebSearch)
- [M4] Samsung Community US, "How to disable Sensitive notification content hidden". https://us.community.samsung.com/t5/Galaxy-Watch/How-to-disable-Sensitive-notification-content-hidden/m-p/3223593 (חסום. מתוך WebSearch)
- [M5] PhoneArena, "Android 16 might finally fix a privacy problem…" (הסתרת OTP במסך הנעילה). https://www.phonearena.com/news/android-16-might-finally-fix-a-privacy-problem-you-didnt-know-you-had_id170453 (מתוך WebSearch)
- [M6] 9to5Google, "Android 16 notification summaries". https://9to5google.com/2025/03/13/android-16-notification-summaries/ ; TechCrunch 2025-12-02 (מתוך WebSearch)
- [D1] Digit, "Deleted WhatsApp messages can still be read via Android notification logs". https://www.digit.in/news/apps/deleted-whatsapp-messages-can-still-be-read-via-android-notification-logs-report-38159.html (מקור ישן, ביטחון נמוך)
- [P1] Android Central Forums, "WhatsApp shows entire message content even when preview is turned off". https://forums.androidcentral.com/threads/whatsapp-shows-entire-message-content-even-when-preview-is-turned-off.940680/ (מתוך WebSearch)
- [P2] Android Authority, "How to use WhatsApp Chat Lock". https://www.androidauthority.com/how-to-use-whatsapp-chat-lock-3328372 (מתוך WebSearch)
- [P3] WhatsApp Blog, "Introducing Advanced Chat Privacy" (אפריל 2025). https://blog.whatsapp.com/introducing-advanced-chat-privacy (מתוך WebSearch)
- [B1] Business Insider NL / Android Authority, מה קורה כשחוסמים ב-WhatsApp. https://www.businessinsider.nl/what-happens-when-you-block-someone-on-whatsapp/ , https://androidauthority.com/how-to-block-unblock-whatsapp-1097787 (מתוך WebSearch)

**Samsung**
- [S1] dontkillmyapp, Samsung (קוד מקור של האתר ב-GitHub, commit מ-2026-06-09). https://github.com/urbandroid-team/dont-kill-my-app/blob/master/_vendors-content/samsung/user.md (האתר dontkillmyapp.com עצמו חסום)
- [S2] Samsung US Support, "Get the most out of your Galaxy phone or tablet battery" (Background usage limits, Never auto sleeping apps). https://www.samsung.com/us/support/answer/ANS10002534/ (חסום. מתוך WebSearch)
- [S3] SamMobile, "Why did my notification settings change after an update" (2026-10-13). https://www.sammobile.com/news/why-did-my-notification-settings-change-after-an-update/ ; Samsung Community EU, "notification access not working" (Tasker/AutoInput, One UI 7). https://eu.community.samsung.com/t5/question/notification-access-not-working/td-p/11397239 (מתוך WebSearch)
- [S4] Neowin / Android Authority, Auto Blocker חוסם התקנה עצמאית (One UI 6.1.1). https://www.neowin.net/guides/samsung-phones-running-one-ui-611-block-sideloading-by-default-heres-how-to-fix-it/ (מתוך WebSearch)
- [S5] Samsung Community, Dual Messenger (`pm list users`, user 95). https://r2.community.samsung.com/t5/Tech-Talk/Dual-Messenger-For-Signal-App/m-p/6728655 (מתוך WebSearch)
- [V1] Android Authority / Droid Life / SamMobile, One UI 9 (Android 17) ל-Galaxy S25 (ספטמבר-אוקטובר 2026). https://www.droid-life.com/2026/10/02/one-ui-9-update-rolling-out-to-galaxy-devices-in-us/ , https://www.sammobile.com/news/samsung-one-ui-9-beta-update-galaxy-s25-series/ (מתוך WebSearch)

**Sideload / Play**
- [R1] Android Authority, "Android 15 restricted settings / Enhanced Confirmation Mode". https://www.androidauthority.com/android-15-enhanced-confirmation-mode-3436697 ; 9to5Google 2024-09-12. https://9to5google.com/2024/09/12/android-15-sideloaded-apps-restrictions/ (מתוך WebSearch)
- [R2] Google Malaysia Blog 2026-04-14, Enhanced fraud protection; TechCrunch 2024-02-07 (Singapore). https://blog.google/intl/en-my/company-news/technology/google-launches-enhanced-protection-in-google/ (מתוך WebSearch); Play Protect developer guidance https://developers.google.com/android/play-protect/warning-dev-guidance (חסום)
- [R3] TechCrunch 2025-08-25, "Google will require developer verification for Android apps outside the Play Store"; median.co. https://median.co/blog/android-developer-verification-2026 (מתוך WebSearch)
- [G1] Google Play Console Help, Permissions and APIs that Access Sensitive Information. https://support.google.com/googleplay/android-developer/answer/9888170 (מתוך WebSearch, לא נקרא ישירות)

**WhatsApp תנאים ומדיניות**
- [T1] WhatsApp Terms of Service, EEA (revision 2021-01-04). https://www.whatsapp.com/legal/terms-of-service-eea/revisions/20210104 (**חסום. ציטוט מתוך WebSearch**)
- [T2] WhatsApp Terms of Service, UK (2025-03-17); conductatlas provision record. https://www.whatsapp.com/legal/terms-of-service-uk , https://conductatlas.com/platform/whatsapp/whatsapp-terms-of-service/provision/CA-P-030669/prohibition-on-bulk-and-auto-messaging/ (מתוך WebSearch)
- [T3] WhatsApp Help Center, "Unauthorized use of automated or bulk messaging on WhatsApp". https://faq.whatsapp.com/5957850900902049 (חסום. מתוך WebSearch)
- [T4] Beebom / TelecomTalk, חסימות זמניות למשתמשי אפליקציות לא רשמיות. https://beebom.com/whatsapp-says-third-party-apps-violate-terms-of-service (מתוך WebSearch)
- [T5] TechCrunch 2025-10-18 (איסור צ'אטבוטים כלליים); Mobile Ecosystem Forum 2026-01-20 (AGCM); ppc.land (הנציבות האירופית). https://mobileecosystemforum.com/2026/01/20/meta-ordered-to-suspend-clauses-excluding-rival-ai-chatbots-from-whatsapp/ (מתוך WebSearch)

**פרטיות בישראל**
- [L1] IAPP, "Israel marks a new era in privacy law: Amendment 13". https://iapp.org/news/a/israel-marks-a-new-era-in-privacy-law-amendment-13-ushers-in-sweeping-reform ; Pearl Cohen. https://www.pearlcohen.com/major-amendment-to-israeli-privacy-law-set-to-take-effect/ (מתוך WebSearch)
- [L2] Pearl Cohen, "Israeli privacy regulator issues draft guidelines on privacy in AI"; Gornitzky 2025-05-11. https://www.pearlcohen.com/israeli-privacy-regulator-issues-draft-guidelines-on-privacy-in-ai/ (מתוך WebSearch)

---

## 9. מקורות שלא היו נגישים בסשן הזה

ה-proxy של הסשן חסם את WebFetch ו-curl ל-hosts הבאים. התוכן הרלוונטי נלקח מתקצירי WebSearch, ולכן הביטחון בהם נמוך יותר:

`www.whatsapp.com`, `faq.whatsapp.com`, `bugs.kde.org`, `www.autoresponder.ai`, `www.androidauthority.com`, `gadgetbridge.org`, `dontkillmyapp.com` (נעקף דרך קוד המקור ב-GitHub), `www.samsung.com`, `us.community.samsung.com` (ו-mirror של cloudfront), `techcrunch.com`, `developers.google.com`, `android.googlesource.com` (נעקף דרך `aosp-mirror` ב-GitHub).

בנוסף, `gh api` ל-`adeekshith/watomatic` נדחה ("GitHub access to this repository is not enabled for this session"), ולכן הקוד נקרא דרך `git clone` ציבורי.

**לפני החלטות סופיות** (בעיקר לגבי תנאי השימוש של WhatsApp ומתגי Samsung), מומלץ לאפשר את `www.whatsapp.com`, `faq.whatsapp.com` ו-`www.samsung.com` ולקרוא את המקור הראשוני.
