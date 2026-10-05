# דוח מצב: JARVIS Desktop V1

**תאריך:** 5 באוקטובר 2026
**ענף:** `ccr-5bb40fe0-ybqwr9` (Pull Request #6)

## בקצרה

JARVIS V1 בנוי: קוד מלא, בדיקות, מתקין ל-Windows ותיעוד.

הבדיקות רצו בשני מקומות:

- **סביבת Linux בענן**, בלי Windows.
- **מכונת Windows אמיתית** ב-GitHub Actions (`windows-latest`).

**על המחשב שלך שום דבר לא נבדק.** לא הייתה לי גישה אליו, ולא פתחתי בו שום תוכנה. סעיף 2 מפרט בדיוק מה לבדוק אצלך ואיך.

| | |
|---|---|
| בדיקות יחידה | {{UNIT_COUNT}} בדיקות, עוברות ב-Linux וב-Windows |
| בדיקות E2E (האפליקציה האמיתית, Playwright + Electron) | {{E2E_LINUX}} ב-Linux, {{E2E_WINDOWS}} ב-Windows |
| typecheck + lint | נקיים |
| מתקין | `JARVIS Setup 0.1.0.exe` + ZIP נבנים ב-CI על Windows ומועלים כ-artifact |

## 1. עובד ונבדק

**חשוב:** בדיקה שמסומנת **(mock)** מחליפה רק את השירות בענן (Claude, OpenAI, Azure) בתשובה מתוסרטת. היא מוכיחה שהצינור **בתוך JARVIS** עובד: אימות, כלים, הרשאות, מצבים וממשק. **היא לא מוכיחה שהחיבור לשירות החי עובד עם המפתח שלך.** את זה בודקים לפי סעיף 2.

### על Windows אמיתי (CI)

- **פתיחת תוכנה אמיתית:** `spawn` של `notepad.exe`, במקום EPLAN, דרך המסלול המלא של JARVIS. הבדיקה מוודאת עם `tasklist` שהתהליך באמת רץ.
- **פתיחת קובץ פרויקט** דרך שיוך הקבצים של Windows (`shell.openPath`). הבדיקה מוודאת שהקובץ לא השתנה.
- **(mock)** "תפתח את פרויקט הגמר שלי": `open_project`, ותשובה שמבוססת על תוצאת הכלי המאומתת.
- **צילום מסך אמיתי** (`desktopCapturer`), רק אחרי אישור.
- **מיקרופון:** קובץ WAV עברי שמוזן כמיקרופון של Chromium. האודיו עובר דרך `getUserMedia`, ‏AudioWorklet, ‏VAD ו-WAV עד התמלול.
- **מילת הפעלה:** "Hey Jarvis" מתוך אודיו אמיתי מפעיל האזנה. ה-openWakeWord המקומי עושה זאת בלי שום בקשת רשת.
- **אריזה:**
  - נבנים מתקין NSIS ו-ZIP.
  - Fuses פעילים: `RunAsNode` כבוי, `OnlyLoadAppFromAsar` פעיל, ובדיקת שלמות של `app.asar`.
  - מזהה האפליקציה זהה בין `setAppUserModelId` למתקין. זה נדרש להתראות Windows.

### ב-Linux וב-Windows

| תחום | מה נבדק |
|---|---|
| אבטחה | ב-renderer אין Node או `require`, ויש רק API קפוא. CSP חוסם סקריפט מוזרק ורשת. IPC לא תקין נדחה (zod). ניווט וחלונות חדשים חסומים. מפתחות הם לכתיבה בלבד. |
| תוכנות מאושרות | renderer לא יכול לרשום תוכנה עם ארגומנטים בלי אישור בחלון נייטיבי. `cmd.exe`, ‏PowerShell, סקריפטים, נתיבי רשת וסימני כיווניות מוסתרים נחסמים. |
| מצב מערכת | ערכי CPU, ‏RAM ודיסק אמיתיים. בלי טמפרטורות. |
| משימות ותזכורות | נשמרות אחרי הפעלה מחדש. תזכורת מתריעה בזמן. תזכורת שהוחמצה מוצגת פעם אחת אחרי "כיבוי", בלי כפילויות. שעון קיץ ושעה דו-משמעית מבקשים הבהרה. |
| (mock) Claude | כלי לא מוכר ופרמטרים לא תקינים נדחים ולא מבוצעים. בקשה שנשלחה שוב לא מבצעת פעולה פעמיים. ניתוק רשת עובר למצב מקומי. מפתח שגוי מחזיר שגיאה ברורה, לא "הצלחה". |
| (mock) ראייה | צילום רק אחרי אישור. הוראות בתוך צילום המסך לא מבוצעות, ופעולה אחרי ניתוח מסך דורשת אישור. דחייה = אין צילום ואין שליחה. |
| (mock) קול | לחיצה לדיבור עוברת מיקרופון ← תמלול ← Claude ← כלי ← אימות ← הקראה, ומצבי ה-HUD משקפים את מה שקורה באמת. לחיצה בזמן הקראה עוצרת אותה ומקשיבה. |
| מילת הפעלה | המימוש ב-TypeScript של openWakeWord נותן את אותם ציונים כמו המימוש הרשמי ב-Python, על אותם קובצי אודיו. |

## 2. דורש בדיקה על ה-Windows שלך

בסדר הזה. כל שלב בונה על הקודם.

1. **התקנה:** מורידים את `JARVIS-windows-x64` מ-GitHub Actions ומתקינים. ראה [SETUP-WINDOWS.md](SETUP-WINDOWS.md), כולל SmartScreen ו-Smart App Control.
2. **EPLAN ופרויקט הגמר (בלי AI):**
   - **הגדרות ← תוכנות ופרויקטים** ← "זיהוי אוטומטי" או "בחר קובץ…" ל-`EPLAN.exe`, ואז "אמת".
   - בוחרים את קובץ ה-`.elk`, ואז "אמת" ו"בדיקת פתיחה".
   - **מצופה:** EPLAN נפתח עם הפרויקט, והקובץ לא משתנה.
3. **מצב מקומי:** כותבים "תפתח את פרויקט הגמר שלי" בתיבת הטקסט. זה עובד גם בלי מפתח Claude.
4. **Claude:** מדביקים מפתח ← "בדוק חיבור". אחר כך שוב "תפתח את פרויקט הגמר שלי".
   - **מצופה:** כרטיס פעולה עם "✓ אומת ע״י הכלי", ותשובה שמתארת את מה שקרה בפועל.
5. **קול:**
   - **הגדרות ← קול** ← מפתח OpenAI ← "בדיקת תמלול". אומרים משפט בעברית עם "EPLAN" או "Spotify" ובודקים את הדיוק.
   - הקראה: Azure (`he-IL-AvriNeural`) ← "השמע דוגמה", או קול המערכת Asaf (צריך להתקין אותו ב-Windows).
6. **המטרה:** לוחצים על המיקרופון (או `Ctrl+Alt+J`) ואומרים "תפתח את פרויקט הגמר שלי".
   - **מצופה:** מקשיב ← חושב ← מבצע ← כרטיס פעולה מאומת ← JARVIS אומר בקול שהפרויקט נפתח.
7. **הד:** עם רמקולים (בלי אוזניות), JARVIS לא אמור "לשמוע את עצמו".
8. **תזכורת:** "תזכיר לי בעוד 2 דקות לשתות מים". ממזערים למגש ומחכים.
   - **מצופה:** התראה של Windows.
   - אחר כך בודקים גם תזכורת שעוברת בזמן שהמחשב במצב שינה.
9. **מילת הפעלה:**
   - **"Hey Jarvis" (openWakeWord):** מפעילים, ובודקים כמה פעמים JARVIS מתעורר בטעות בזמן שיחה רגילה בחדר.
   - **"Jarvis" (Porcupine):** לא נבדק עם מפתח אמיתי. צריך AccessKey מ-Picovoice ו-Visual C++ Redistributable.
10. **צילום מסך:** "תסתכל על המסך ותגיד לי מה לא בסדר". אם יש שני מסכים, בודקים שנבחר המסך הנכון, גם עם הגדלת תצוגה (DPI) של 125% או 150%.
11. **מצב מערכת במחשב נייד:** אחוז הסוללה וטעינה.
12. **הפעלה עם Windows:** מפעילים בהגדרות, מפעילים את המחשב מחדש, ובודקים ש-JARVIS עלה למגש.

אם משהו נכשל, צלם מסך ושלח. שגיאות נרשמות גם ב-`%APPDATA%\JARVIS\logs\`.

## 3. חסום או מוגבל

| נושא | מצב |
|---|---|
| מחשב Windows | אין גישה למחשב שלך. כל בדיקות Windows רצו על מכונת CI נקייה, בלי EPLAN, בלי מיקרופון פיזי ובלי רמקולים. |
| EPLAN אמיתי | לא זמין ב-CI. הבדיקה משתמשת ב-notepad במקומו. פתיחת `.elk` תלויה בשיוך הקבצים במחשב שלך. |
| שירותי ענן חיים | לא היו מפתחות. Claude, ‏OpenAI ו-Azure נבדקו רק עם mock. |
| Porcupine ("Jarvis" במילה אחת) | נבדק רק מסלול "מפתח לא תקין". מפתח אמיתי לא נבדק. |
| "Jarvis" בלי מפתח | לא אפשרי כרגע. openWakeWord מזהה רק "Hey Jarvis". "Jarvis" לבד קיבל ציון 0.29, מתחת לסף. |
| מתקין חתום | לא. אין תעודת חתימה. תופיע אזהרת SmartScreen, ו-Smart App Control חוסם. |
| תזכורת כשהמחשב כבוי | לא אפשרי מקומית. היא מוצגת כ"הוחמצה" בהפעלה הבאה. פתרון: V2, סנכרון לענן ופוש לטלפון. |
| שליטה בניגון ב-Spotify | לא מחוברת. JARVIS פותח את Spotify ואומר שאת השיר בוחרים ב-Spotify. |
| תמלול מקומי (ivrit-ai) | נתמך דרך שרת תואם OpenAI. האיכות והמהירות על המחשב שלך לא נמדדו. |
| אתרי תיעוד | חלק מאתרי התיעוד חסומים מסביבת הבנייה (platform.openai.com, ‏picovoice.ai). השתמשתי במקורות הרשמיים שלהם ב-GitHub, וסימנתי למטה מה הגיע ממקור משני. |

## 4. מה מדומה בבדיקות

- **שירותי ענן:** Claude, ‏OpenAI ו-Azure מוחלפים בפונקציה בתהליך הראשי שמחזירה תשובות מתוסרטות. כל בדיקה כזו מסומנת `(mock)` בשמה.
- **בורר קבצים ודיאלוג אישור נייטיבי:** מוחלפים בבדיקה אחת. הבדיקה מוודאת שהדיאלוג **הוצג** ושבלי אישור לא נשמר כלום.
- **`shell.openExternal`** (פתיחת `spotify:`) ב-Linux: מוחלף בספי שרק רושם את הקריאה.
- **אמיתי, לא מדומה:**
  - Electron, ‏SQLite, המתזמן והשעון.
  - מצב המערכת.
  - `spawn` ו-`openPath` ב-Windows.
  - `desktopCapturer`.
  - נתיב המיקרופון של Chromium.
  - openWakeWord עם מודלי ONNX אמיתיים.
  - ההשמעה.

## 5. מקורות לבחירת הספקים

**רשמי** = תיעוד או מפרט של היצרן. **משני** = סיכום חיפוש של עמוד רשמי שהיה חסום כאן. כדאי לאמת אותו בעצמך.

### Claude (Anthropic) — רשמי

- **מודלים ומזהים** (`claude-opus-5-5`): https://platform.claude.com/docs/en/models/overview
- **Messages API:** https://platform.claude.com/docs/en/api/messages/create
- **כלים עם `strict` ופלט מובנה:** https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- **תאריכי הוצאה משימוש:** https://platform.claude.com/docs/en/about-claude/model-deprecations

### OpenAI תמלול

- **רשמי — מפרט ה-API:** https://github.com/openai/openai-openapi
  - `gpt-transcribe`, ‏`languages`, ‏`keywords` ופורמטי קבצים.
- **רשמי — מדריך מעבר:** https://github.com/openai/openai-cookbook/blob/main/examples/migrating_from_whisper_to_gpt_transcribe.ipynb
  - לא שולחים `language` ו-`languages` יחד.
  - מילות מפתח הן מחרוזות בשורה אחת.
- **רשמי — עברית במודל Whisper:** https://github.com/openai/whisper/blob/main/whisper/tokenizer.py
- **משני — הוצאה משימוש:** `whisper-1`, ‏`gpt-4o-transcribe` ו-`gpt-4o-mini-transcribe` יוסרו ב-26.2.2027. המקור: https://developers.openai.com/api/docs/deprecations
- **משני — מחירים:** https://developers.openai.com/api/docs/pricing
  - JARVIS לא מציג מחירים. ראה [COSTS-AND-USAGE.md](COSTS-AND-USAGE.md).

### Azure AI Speech — רשמי

המקור לכל הקישורים: ‏MicrosoftDocs/azure-ai-docs ב-GitHub, שממנו נבנה learn.microsoft.com.

- **שפות וקולות:** `he-IL`, ‏`he-IL-AvriNeural`, ‏`he-IL-HilaNeural`
  https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/language-support.md
- **הקראה (REST):**
  https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/rest-text-to-speech.md
- **תמלול לקטעים קצרים (REST):**
  https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/rest-speech-to-text-short.md
- **מכסות ומגבלות:**
  https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/speech-services-quotas-and-limits.md

### מילת הפעלה

- **Porcupine** (`@picovoice/porcupine-node` 4.0.2; המילה המובנית "jarvis"; AccessKey שמאומת אונליין): https://github.com/Picovoice/porcupine
- **openWakeWord** (המודל `hey_jarvis_v0.1`; רישיון המודלים CC BY-NC-SA 4.0): https://github.com/dscripka/openWakeWord

### Electron

- **הנחיות אבטחה:** https://www.electronjs.org/docs/latest/tutorial/security
- **Breaking changes:** https://github.com/electron/electron/blob/main/docs/breaking-changes.md
- **Fuses:** https://www.electronjs.org/docs/latest/tutorial/fuses

## 6. מה הלאה

ראה [ROADMAP-V2.md](ROADMAP-V2.md): טלפון (Galaxy S25 Ultra), שעון, בית חכם, וסנכרון זיכרון ותזכורות לענן.
