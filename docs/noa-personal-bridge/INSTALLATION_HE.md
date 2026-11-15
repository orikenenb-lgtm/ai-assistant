# מדריך התקנה — NOA Personal Bridge

המדריך מיועד להתקנה על **Samsung Galaxy S25 Ultra**, עם שרת הגשר שרץ על **מחשב Windows** שלך.

> **לפני שמתחילים, בכנות:**
> - האפליקציה עוד לא נבדקה על מכשיר אמיתי. ייתכן שחלק מהדברים יתנהגו אחרת ממה שמתואר כאן. אם משהו לא תואם, תעד אותו (ראו [ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md), סעיף 5).
> - השליחה מתוך האפליקציה **ניסיונית ולא אומתה**, ואין אישור מסירה. בהתחלה היא כבויה, וכך היא צריכה להישאר עד שתסיים את כל הבדיקות בסעיף 7.
> - ב-Android 15 ומעלה חלק מהשיחות לא יקבלו טיוטה, כי המערכת מסתירה מהאפליקציה התראות "רגישות". זה צפוי (ראו [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).
>
> פקודות שמסומנות **(לא נבדק כאן)** נכתבו לפי התיעוד הרשמי של הכלי, אבל לא הורצו בסביבת הפיתוח שלנו (Linux, בלי Windows ובלי טלפון). כל השאר נבדק מול הקוד ומול שרת מקומי.

## תוכן
0. [מה צריך](#0-מה-צריך)
1. [השגת קובץ ה-APK](#1-השגת-קובץ-ה-apk)
2. [התקנה על ה-S25 Ultra](#2-התקנה-על-ה-s25-ultra)
3. [הרצת שרת הגשר על Windows](#3-הרצת-שרת-הגשר-על-windows)
4. [חיבור הטלפון לשרת (Pairing)](#4-חיבור-הטלפון-לשרת-pairing)
5. [מדריך חיבור לנועה](#5-מדריך-חיבור-לנועה)
6. [הגדרות Samsung](#6-הגדרות-samsung)
7. [בדיקה שהכול עובד, כשהשליחה כבויה](#7-בדיקה-שהכול-עובד-כשהשליחה-כבויה)

---

## 0. מה צריך

| מה | למה | הערות |
|---|---|---|
| Galaxy S25 Ultra עם WhatsApp האישי (לא Business) | האפליקציה קוראת רק את `com.whatsapp` | WhatsApp Business, ‏Dual Messenger ו-Secure Folder לא נתמכים |
| מחשב Windows עם Python ‏3.12 או 3.13 | השרת | ה-CI וה-Dockerfile משתמשים ב-3.12. בסביבת הפיתוח נבדק גם 3.13 |
| ה-Repository משוכפל למחשב (`git clone`) | קוד השרת | |
| כבל USB ו-`adb` (מומלץ) | התקנה ולוגים | `adb` מגיע עם Android Studio או עם Platform Tools |
| מנהרת HTTPS (Tailscale או Cloudflare) | הטלפון מתחבר לשרת רק ב-HTTPS | שירותים של צד שלישי, ייתכן שיידרש חשבון. לא נדרש שירות בתשלום |
| טלפון שני (שלך) עם WhatsApp | לשלוח לעצמך הודעות בדיקה | לא לבדוק על אנשים שלא הסכימו |

---

## 1. השגת קובץ ה-APK

### א. מ-GitHub Actions (הכי פשוט)

ה-workflow בשם **NOA Personal Bridge** (הקובץ `.github/workflows/noa-personal-bridge.yml`) בונה APK לדיבוג בכל push שנוגע בתיקייה `noa-personal-bridge/`, ומעלה אותו כ-artifact בשם `noa-personal-bridge-debug-apk`. ה-artifact נשמר 14 יום. ל-workflow אין הפעלה ידנית: הוא רץ רק על push או pull request עם שינוי בתיקייה הזו.

**דרך האתר:** ב-GitHub נכנסים ל-Actions, בוחרים ב-workflow ‏"NOA Personal Bridge" ובריצה ירוקה אחרונה, ובתחתית העמוד מורידים מתוך Artifacts את `noa-personal-bridge-debug-apk`. מתקבל קובץ ZIP, ובתוכו `app-debug.apk`.

**דרך `gh` (לא נבדק כאן):**

```powershell
gh run list --workflow "NOA Personal Bridge" --limit 5
gh run download <RUN_ID> -n noa-personal-bridge-debug-apk -D .\apk
```

### ב. בנייה מקומית

**עם Android Studio:** פותחים את התיקייה `noa-personal-bridge\android` (לא את שורש ה-Repository), מחכים לסנכרון של Gradle, ובוחרים Build ‏› Build App Bundle(s) / APK(s) ‏› Build APK(s). Android Studio מגיע עם JDK משלו ויוצר לבד את הקובץ `local.properties`, עם הנתיב ל-SDK.

**משורת הפקודה (PowerShell, לא נבדק כאן על Windows):** צריך JDK ‏17 ומעלה (ה-CI משתמש ב-21) ו-Android SDK עם `platforms;android-36`. אם אין Android Studio, צריך להגדיר את הנתיב ל-SDK:

```powershell
cd noa-personal-bridge\android
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat :app:assembleDebug
```

הקובץ נוצר כאן:

```text
noa-personal-bridge\android\app\build\outputs\apk\debug\app-debug.apk
```

הבנייה עצמה (`./gradlew :app:assembleDebug`) נבדקה על Linux, וב-CI היא רצה על Ubuntu.

> **שים לב לחתימה:** APK לדיבוג נחתם במפתח דיבוג שנוצר על המחשב שבנה אותו. סביר שכל ריצה של GitHub Actions חותמת במפתח אחר, ובוודאי שהמפתח של המחשב שלך שונה ממנו. אם מתקינים גרסה חדשה מעל גרסה שנחתמה במפתח אחר, ההתקנה תיכשל ("App not installed" או `INSTALL_FAILED_UPDATE_INCOMPATIBLE`). במקרה כזה צריך להסיר את הגרסה הקודמת, ואז ייאלצו לחבר מחדש את השרת ולתת שוב גישה להתראות. כדי לחסוך את זה, עדיף לבנות תמיד על אותו מחשב.

---

## 2. התקנה על ה-S25 Ultra

שם האפליקציה בהגדרות המערכת הוא **NOA Personal Bridge**. בתוך האפליקציה מופיעה הכותרת **נועה · גשר אישי**. מזהה החבילה הוא `ai.noa.personalbridge`.

> שמות התפריטים של Samsung כתובים כאן באנגלית, לפי מקורות של One UI ‏6 ו-7. בממשק העברי ובגרסאות חדשות יותר הניסוח עשוי להיות שונה מעט.

### 2.1 Auto Blocker

ב-One UI ‏6.1.1 ומעלה, **Auto Blocker** חוסם התקנה של אפליקציות שלא הגיעו מ-Play Store או מ-Galaxy Store. במכשירים שיצאו עם הגרסה הזו הוא פעיל כברירת מחדל, וייתכן שהוא חוסם גם `adb` דרך USB (לא אומת).

- Settings ‏› Security and privacy ‏› **Auto Blocker** ‏› לכבות **זמנית**.
- להדליק אותו שוב מיד אחרי ההתקנה. כל עדכון של ה-APK ידרוש לכבות אותו שוב.

### 2.2 התקנה דרך USB עם `adb` (מומלץ)

ראשית מפעילים אפשרויות מפתחים: Settings ‏› About phone ‏› Software information ‏› שבע הקשות על Build number. אחר כך מפעילים את Developer options ‏› **USB debugging**, ומחברים את הכבל. אז:

```powershell
adb devices
adb install -r .\app-debug.apk
```

לפי מחקר ההיתכנות, התקנה דרך `adb` כנראה לא מסומנת כ"התקנה מקובץ מוגבלת", ולכן ייתכן שלא תצטרך את סעיף 2.4 (ביטחון בינוני, לא אומת).

### 2.3 התקנה מקובץ (חלופה)

1. מעבירים את `app-debug.apk` לטלפון ופותחים אותו מתוך My Files.
2. Android ישאל אם לאפשר ל-My Files להתקין אפליקציות: **Install unknown apps** ‏› Allow from this source.
3. אם Play Protect מציג אזהרה, קוראים אותה. זו אפליקציה שבנית בעצמך, ואפשר לבחור להתקין בכל זאת.
4. אחרי ההתקנה כדאי לבטל שוב את ההרשאה Install unknown apps של My Files.

### 2.4 גישה להתראות, ו-"Allow restricted settings"

1. פותחים את האפליקציה ועוברים על מסכי הפתיחה. במסך **עיבוד בענן** אפשר לבחור **קריאת הפרטים ומתן הסכמה** או **דילוג בינתיים**. בלי הסכמה לא נוצרות טיוטות, ואפשר לתת אותה מאוחר יותר בהגדרות ‏› פרטיות.
2. במסך **בית**, בכרטיס **הרשאות**, ליד **גישה להתראות**, לוחצים **מתן הרשאה**. נפתחת רשימת הגישה להתראות של Android. מדליקים את **NOA Personal Bridge**.
3. **אם האפליקציה הותקנה מקובץ**, Android 13 ומעלה יחסום את זה ויציג "Restricted setting". זה צפוי. כדי לשחרר:
   - Settings ‏› Apps ‏› **NOA Personal Bridge** ‏› ⋮ (שלוש הנקודות למעלה) ‏› **Allow restricted settings**, ומאשרים.
   - האפשרות מופיעה **רק אחרי** ניסיון ראשון שנחסם.
   - חוזרים לשלב 2 ומדליקים את הגישה.
4. ליד **הצגת התראות** לוחצים **מתן הרשאה**, כדי לקבל התראה כשטיוטה מוכנה.
5. בכרטיס **גשר WhatsApp** צריך להופיע: "מאזין להתראות של שיחות פרטיות בלבד."

האפליקציה מבקשת רק שתי הרשאות במניפסט, אינטרנט והצגת התראות. היא לא מבקשת גישה לאנשי קשר, ל-SMS, לטלפון, לנגישות (Accessibility) או לתצוגה מעל אפליקציות. גישה להתראות היא הרשאת מערכת שאתה מפעיל בהגדרות.

---

## 3. הרצת שרת הגשר על Windows

השרת לא קורא קובץ `.env` בעצמו. את המשתנים מגדירים בחלון PowerShell, והם תקפים רק לאותו חלון.

### 3.1 התקנה (פעם אחת)

```powershell
cd <הנתיב-לריפו>\noa-personal-bridge\bridge-service
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

הפקודות קוראות ישירות ל-`.\.venv\Scripts\python.exe`, ולכן לא צריך להפעיל את ה-venv (`Activate.ps1`) ולא לשנות את ה-Execution Policy. אם אין לך `py`, אפשר להשתמש ב-`python -m venv .venv`.

רוצה להריץ גם את הבדיקות? (על Linux זה עובר: ‏348 passed)

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

### 3.2 הפעלה עם המנוע `stub` (חינם, בלי רשת)

```powershell
$env:BRIDGE_ENABLED = "true"
$env:BRIDGE_ENGINE = "stub"
.\.venv\Scripts\python.exe -m bridge_service.admin init-db
.\.venv\Scripts\python.exe -m bridge_service.main
```

השרת מאזין ל-`http://127.0.0.1:8787`, רק במחשב עצמו. מסד הנתונים נוצר ב-`data\bridge.sqlite3` בתוך התיקייה (התיקייה `data/` מוחרגת ב-`.gitignore`). המסד מכיל רק hash של טוקנים וקודי חיבור, בלי תוכן הודעות.

הפלט נראה בערך כך (JSON, בלי תוכן הודעות):

```text
{"ts": "...", "level": "INFO", "logger": "bridge_service", "msg": "bridge started", "event": "startup", "engine": "stub"}
{"ts": "...", "level": "INFO", "logger": "uvicorn.error", "msg": "Uvicorn running on http://127.0.0.1:8787 (Press CTRL+C to quit)"}
```

עוצרים עם Ctrl+C.

### 3.3 בדיקת בריאות

בחלון PowerShell נוסף (ב-Windows צריך לכתוב `curl.exe`, כי `curl` לבד הוא כינוי לפקודה אחרת):

```powershell
curl.exe http://127.0.0.1:8787/health
```

התשובה הצפויה:

```json
{"ok":true,"enabled":true,"engine":"stub","version":"0.1.0"}
```

אם מופיע `"enabled":false`, המשתנה `BRIDGE_ENABLED` לא הוגדר באותו חלון שבו השרת רץ.

### 3.4 חשיפת השרת לטלפון, רק ב-HTTPS

**למה לא פשוט Wi-Fi ביתי?** האפליקציה לא מתחברת ב-`http://` לכתובת ברשת המקומית (כמו `192.168.1.20`). זה נכון בגרסת release, וגם בגרסת הדיבוג: גרסת הדיבוג מתירה `http` רק ל-`localhost`, ל-`127.0.0.1` ול-`10.0.2.2` (האמולטור), ומסך **חיבור לשרת** דורש כתובת שמתחילה ב-`https://`. בנוסף, האפליקציה סומכת רק על תעודות של רשויות מוכרות (System CAs). תעודה בחתימה עצמית או CA שהתקנת בעצמך לא יעבדו. הפתרון הוא מנהרה (tunnel) שמספקת כתובת HTTPS עם תעודה אמיתית.

**כללים לכל אפשרות:**
- השרת ממשיך להאזין רק ל-`127.0.0.1`, והמנהרה מעבירה אליו. לא לשנות את `BRIDGE_HOST` ל-`0.0.0.0`.
- להשאיר `BRIDGE_TRUST_PROXY_HEADERS=false`, שזו ברירת המחדל. המשמעות: כל הבקשות שעוברות במנהרה נראות לשרת כאילו הן מאותה כתובת, ולכן מגבלת ניסיונות החיבור (10 בשעה) משותפת לכולן.
- המנהרה הופכת את `/health` ואת `/v1/pair` לנגישים לכל מי שיודע את הכתובת. הם מוגנים בקוד חד-פעמי ובמגבלת ניסיונות, אבל כדאי לסגור את המנהרה כשלא משתמשים בה.
- המחשב צריך להישאר דלוק ולא במצב שינה, אחרת הטלפון יקבל "השרת לא זמין".
- אלה שירותים של צד שלישי. התנאים והתוכניות החינמיות שלהם עלולים להשתנות.

**אפשרות א (מומלצת לפרטיות): Tailscale Serve.** הכתובת נגישה רק למכשירים ברשת ה-Tailscale הפרטית שלך, ולא לכל האינטרנט. צריך חשבון Tailscale (יש תוכנית אישית חינמית), את Tailscale מותקן על המחשב ועל הטלפון, ואת אפשרות תעודות ה-HTTPS מופעלת בקונסולת הניהול. החיסרון: בטלפון צריך שה-VPN של Tailscale יהיה מחובר. **(לא נבדק כאן)**

```powershell
tailscale serve --bg 8787
tailscale serve status
```

הכתובת שתקבל נראית כמו `https://<שם-המחשב>.<שם-הרשת>.ts.net`. לכיבוי:

```powershell
tailscale serve reset
```

אם צריך גישה בלי Tailscale בטלפון, יש את Tailscale Funnel (`tailscale funnel --bg 8787`). הוא חושף את הכתובת לכל האינטרנט, אז עדיף להימנע ממנו.

**אפשרות ב (הכי מהירה, בלי חשבון): Cloudflare Quick Tunnel.** **(לא נבדק כאן)**

```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

בפלט תופיע כתובת כמו `https://<מילים-אקראיות>.trycloudflare.com`. שני חסרונות:
1. הכתובת משתנה בכל הרצה, ואחרי כל שינוי צריך לחבר את הטלפון מחדש (קוד חדש, סעיף 4).
2. Cloudflare מפענחת את ה-HTTPS אצלה ורואה את התעבורה, כולל טקסט ההודעות שנשלח לטיוטה. עם Tailscale, לפי התיעוד שלהם, ההצפנה מסתיימת אצלך במחשב.

אחרי שהמנהרה עולה, בודקים מהטלפון או מהמחשב:

```powershell
curl.exe https://<הכתובת-שלך>/health
```

---

## 4. חיבור הטלפון לשרת (Pairing)

1. בחלון PowerShell **נוסף**, ו**באותה תיקייה** (`bridge-service`), יוצרים קוד:

```powershell
.\.venv\Scripts\python.exe -m bridge_service.admin create-pairing-code
```

   הפלט הוא קוד בן 8 תווים, ואחריו שורה כמו `valid until 2026-11-15 20:53:16 (10 min), single use`. אם מופיעה גם השורה `note: BRIDGE_ENABLED is false`, זה רק כי המשתנה לא הוגדר **בחלון הזה**. מה שקובע הוא החלון שבו השרת רץ.
   - הקוד תקף 10 דקות ולשימוש אחד. אפשר לבקש תוקף ארוך יותר, עד 60 דקות: `create-pairing-code --ttl-minutes 30`.
   - חשוב להריץ מאותה תיקייה, כי הנתיב למסד הנתונים (`data\bridge.sqlite3`) יחסי לתיקייה הנוכחית. אם הגדרת `BRIDGE_DB_PATH`, צריך להגדיר אותו גם בחלון הזה.
2. באפליקציה: **בית** ‏› **חיבור לשרת** (או **הגדרות** ‏› **חיבור** ‏› **חיבור לשרת**).
3. **כתובת השרת**: כתובת ה-HTTPS של המנהרה, בלי `/health` בסוף.
4. **קוד חיבור**: 8 התווים. אותיות קטנות, רווחים ומקפים מתוקנים לבד.
5. **התחברות**. אם הכול תקין: "החיבור הצליח. המכשיר מחובר לשרת." ובכרטיס השרת: "מחובר והשרת זמין."

בדיקה בצד השרת (לא מציגה טוקנים):

```powershell
.\.venv\Scripts\python.exe -m bridge_service.admin list-devices
```

ביטול מכשיר מהשרת:

```powershell
.\.venv\Scripts\python.exe -m bridge_service.admin revoke-device dev_XXXXXXXXXXXXXXXX
```

---

## 5. מדריך חיבור לנועה

עד עכשיו הטיוטות הגיעו מהמנוע `stub`: תשובות קבועות ופשוטות, בלי רשת ובלי עלות. כדי לקבל טיוטות אמיתיות מחליפים את `BRIDGE_ENGINE` לאחד משני המנועים בענן.

| מנוע | מה הוא עושה | מה צריך |
|---|---|---|
| `stub` (ברירת מחדל) | תשובות דטרמיניסטיות, בלי רשת | כלום. חינם |
| `anthropic` | קריאה אחת ל-Claude, **בלי כלים** (tools) | מפתח Anthropic |
| `noa_persona` | מושך את הפרסונה של נועה מ-`POST /agents/{id}/prompt`, נקודת קצה לקריאה בלבד, ואז מבצע את אותה קריאה ל-Claude בלי כלים | מפתח Anthropic, וגם כתובת המנוע של נועה, מפתח המנוע ומזהה הסוכן |

### 5.1 עלויות: החלטה שלך

- ברירת המחדל (`stub`) לא עולה כלום.
- `anthropic` ו-`noa_persona` משתמשים במפתח Anthropic **שלך**, והחיוב הוא לפי טוקנים, מהחשבון שלך. כל טיוטה היא קריאה אחת למודל. כדאי להגדיר מגבלת הוצאה בחשבון, ולהשתמש במפתח נפרד לגשר כדי לעקוב אחרי העלות ולבטל אותו בלי להשפיע על שום דבר אחר.
- פתיחת חשבון API ותשלום כפופים לתנאים של Anthropic. אם מישהו אחר משלם, ההחלטה צריכה להיות משותפת.
- השרת מגביל כל מכשיר ל-30 טיוטות בדקה ול-300 ביום (`BRIDGE_RATE_LIMIT_PER_MINUTE`, `BRIDGE_RATE_LIMIT_PER_DAY`). אפשר להוריד את המספרים.

### 5.2 משתני הסביבה (השמות המדויקים מתוך `config.py`)

| משתנה | חובה ל- | סוד? | ברירת מחדל / הערה |
|---|---|---|---|
| `BRIDGE_ENGINE` | תמיד | לא | `stub`. אפשרויות: `stub`, `anthropic`, `noa_persona` |
| `BRIDGE_ANTHROPIC_API_KEY` | `anthropic`, `noa_persona` | **כן** | בלי מפתח, כל טיוטה נכשלת (502). המנוע לא משתמש במשתנה `ANTHROPIC_API_KEY` הכללי |
| `BRIDGE_ANTHROPIC_MODEL` | — | לא | `claude-haiku-5-5` |
| `BRIDGE_OWNER_DISPLAY_NAME` | — | לא | השם שלך, כפי שהמודל ישתמש בו בטיוטה |
| `BRIDGE_NOA_ENGINE_URL` | `noa_persona` | לא | כתובת הבסיס של המנוע של נועה. חייבת להיות `https` (או `http` רק ל-localhost), בלי שם משתמש, בלי `?` ובלי `#` |
| `BRIDGE_NOA_ENGINE_API_KEY` | `noa_persona` | **כן, רגיש במיוחד** | המפתח הקיים של המנוע (`ENGINE_API_KEY`). ראו 5.3 |
| `BRIDGE_NOA_AGENT_ID` | `noa_persona` | לא | מזהה הסוכן. אותיות קטנות באנגלית, ספרות, `-` ו-`_` |
| `BRIDGE_ENGINE_TIMEOUT_SECONDS` | — | לא | `25` |

דוגמה עם `anthropic`. את המפתח מכניסים רק בחלון של השרת, לא בקובץ שנמצא בתוך הריפו, ולא בצ'אט או בצילום מסך:

```powershell
$env:BRIDGE_ENABLED = "true"
$env:BRIDGE_ENGINE = "anthropic"
$env:BRIDGE_ANTHROPIC_API_KEY = Read-Host "Anthropic API key"
$env:BRIDGE_OWNER_DISPLAY_NAME = "אורי"
.\.venv\Scripts\python.exe -m bridge_service.main
```

דוגמה עם `noa_persona`:

```powershell
$env:BRIDGE_ENABLED = "true"
$env:BRIDGE_ENGINE = "noa_persona"
$env:BRIDGE_ANTHROPIC_API_KEY = Read-Host "Anthropic API key"
$env:BRIDGE_NOA_ENGINE_URL = "https://<כתובת-המנוע-של-נועה>"
$env:BRIDGE_NOA_ENGINE_API_KEY = Read-Host "NOA engine key"
$env:BRIDGE_NOA_AGENT_ID = "<מזהה-הסוכן>"
.\.venv\Scripts\python.exe -m bridge_service.main
```

הפקודה `Read-Host` מבקשת את הערך בזמן ההרצה, כך שהוא לא נשמר בהיסטוריית הפקודות של PowerShell. אחרי ההפעלה, `/health` צריך להחזיר `"engine":"anthropic"` או `"engine":"noa_persona"`.

### 5.3 בצד של נועה לא משנים כלום

- **לא נוגעים** בקוד, בהגדרות, בסוכנים או בפריסה של נועה. הגשר צריך רק שלושה ערכים שכבר קיימים: כתובת המנוע, המפתח הקיים שלו ומזהה הסוכן.
- **המפתח של נועה הוא מפתח כללי, בלי הגבלת הרשאות.** אותו מפתח מאשר גם `POST /agents/{id}/chat`, שמריץ כלים אמיתיים (שליחת WhatsApp, הפקת מסמכים, העברת שיחות), וגם `POST /calls`, שמחייג שיחות טלפון אמיתיות. הגשר נועל בקוד ובבדיקות את השימוש ל-`POST .../agents/{id}/prompt` בלבד, בלי הפניות (redirects). אבל מי שישיג את המפתח מהשרת יקבל את כל ההרשאות. לכן:
  - שומרים אותו **רק** במשתני הסביבה של השרת. לא באפליקציה, לא בריפו, לא בצ'אט ולא בצילומי מסך.
  - אם המנוע של נועה תומך במפתח ייעודי לקריאה בלבד, עדיף להשתמש בו. בעותק של נועה שנבדק יש רק מפתח אחד כללי.
  - אם יש חשד שהמפתח דלף: עוברים מיד ל-`BRIDGE_ENGINE=stub`, ומחליפים (rotate) את המפתח בצד של נועה. שים לב שהחלפה כזו תשבור כל דבר אחר שמשתמש באותו מפתח.
- **לא אומת מול נועה החיה:** נקודת הקצה `/prompt` נבדקה רק מול עותק ישן של הקוד של נועה. אם היא לא עונה, הגשר ממשיך לנסח טיוטות **בלי** הפרסונה, ובלוג השרת תופיע אזהרה:

```text
{"level": "WARNING", "logger": "bridge_service.ai.noa_persona_engine", "msg": "NOA persona fetch failed: ConnectError"}
```

- **התאמה:** בעותק שנבדק, "נועה" היא נציגת מכירות טלפונית של כרם טויס. ייתכן שהטון שלה לא מתאים ל-WhatsApp אישי. אם כן, אפשר להישאר עם `anthropic`.
- **חזרה אחורה:** `BRIDGE_ENGINE=stub` והפעלה מחדש של השרת. נועה לא מושפעת בשום צורה.

---

## 6. הגדרות Samsung

בלי ההגדרות האלה, One UI עלול "להרדים" את האפליקציה, והטיוטות יפסיקו להגיע אחרי כמה ימים. הרשימה המלאה נמצאת ב-[ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md), סעיף 6.

- [ ] **Never sleeping apps:** ‏Settings ‏› Battery ‏› Background usage limits ‏› Never sleeping apps (בחלק מהגרסאות Never auto sleeping apps) ‏› להוסיף את NOA Personal Bridge.
- [ ] לוודא שהאפליקציה **לא** מופיעה ב-Sleeping apps וב-Deep sleeping apps.
- [ ] **Put unused apps to sleep:** באותו מסך, לכבות.
- [ ] **סוללה ללא הגבלה:** ‏Settings ‏› Apps ‏› NOA Personal Bridge ‏› Battery ‏› **Unrestricted**.
- [ ] **לא להסיר הרשאות:** ‏Settings ‏› Apps ‏› NOA Personal Bridge ‏› לכבות Remove permissions if app is unused / Pause app activity if unused.
- [ ] **WhatsApp:** ההתראות על הודעות פעילות. התצוגה המקדימה של ההודעות פעילה. App lock / Fingerprint lock כבוי. צ'אטים שרוצים לקבל עליהם טיוטות לא נעולים ב-Chat lock ולא מושתקים.
- [ ] **Auto Blocker** הודלק בחזרה אחרי ההתקנה.
- [ ] **אחרי כל עדכון של One UI:** לבדוק שוב את כל הסעיפים, כי עדכונים עלולים להחזיר הגבלות.

---

## 7. בדיקה שהכול עובד, כשהשליחה כבויה

**לפני הכול:** ב**הגדרות**, תחת **פרטיות**, לוודא ש-**שליחה ניסיונית** כבויה ("כבוי. אפשר לאשר טיוטה ולהעתיק את הנוסח, אבל האפליקציה לא שולחת דבר."). בכל הבדיקות כאן שום הודעה לא נשלחת מהאפליקציה.

1. **שרת:** `curl.exe https://<הכתובת-שלך>/health` מחזיר `"ok":true,"enabled":true`.
2. **מסך בית:**
   - **נועה / שרת הגשר**: "מחובר והשרת זמין."
   - **גשר WhatsApp**: "מאזין להתראות של שיחות פרטיות בלבד."
   - **הרשאות**: שתיהן "ניתנה".
   - אין כרטיס "נועה לא מנסחת טיוטות כרגע". אם הוא מופיע, צריך לתת הסכמה ב**הגדרות** ‏› **פרטיות** ‏› **עיבוד בענן**.
3. **הודעה פרטית:** מהטלפון השני (שמור באנשי הקשר) שולחים "היי, מתי נפגשים מחר?". אחרי כ-15 שניות של שקט צריכה להופיע התראה, ובלשונית **טיוטות** צריכה להופיע טיוטה במצב **ממתין לאישורך**. עם `stub` הנוסח יהיה פשוט ("שאלה טובה, אבדוק ואחזור אליך בהקדם"). זה תקין.
4. **burst:** שולחים 3 הודעות קצרות ברצף. צריכה להיווצר טיוטה **אחת**, כ-15 שניות אחרי האחרונה.
5. **העתקה במקום שליחה:** פותחים את הטיוטה, לוחצים **אשר והעתק**. בחלון **השליחה כבויה** לוחצים **העתק טקסט**, ומדביקים ושולחים בעצמך ב-WhatsApp.
6. **קבוצה:** הודעה בקבוצה משותפת עם הטלפון השני. **לא** אמורה להיווצר טיוטה. אם נוצרה טיוטה מקבוצה, זה באג חוסם: לוחצים **עצירת חירום** ומדווחים.
7. **הודעה עם ספרות:** "הקוד שלך הוא 482913". ב-Android 15 ומעלה סביר שלא תיווצר טיוטה, כי ההתראה מוסתרת. זו התוצאה הצפויה.
8. **בצד השרת:** `list-devices` מראה את המכשיר כ-`active`, עם זמן "last seen" עדכני. בלוג של השרת מופיעות רק שורות עם `method`, `path` ו-`status`, בלי תוכן.
9. **עצירת חירום:** לוחצים **עצירת חירום** ‏› **כן, לעצור הכול**. שולחים הודעה, ולא אמורה להיווצר טיוטה. אחר כך **חידוש פעולה** ‏› **כן, לחדש**.

אחרי זה ממשיכים לפרוטוקול המלא R0–R16 ב-[ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md), סעיף 5, ומתעדים את התוצאות.

**שליחה אמיתית (S1–S3):** רק אחרי שכל הבדיקות עברו, רק בהחלטה מפורשת שלך, ורק מול הטלפון השני שלך או מול אדם שהסכים מראש. הודעה אחת בכל בדיקה. איך מפעילים את השליחה מוסבר ב-[USER_GUIDE_HE.md](USER_GUIDE_HE.md).
