# NOA Personal Bridge — תיעוד

## בקצרה

NOA Personal Bridge הוא גשר אישי בין WhatsApp שבטלפון שלך לבין נועה. אפליקציית Android (קובץ APK שמתקינים ידנית על ה-Galaxy S25 Ultra) קוראת, באישור שלך, את ההתראות של WhatsApp משיחות פרטיות בלבד. היא מחכה 15 שניות של שקט מהשולח, ושולחת את ההודעות החדשות לשרת גשר קטן שרץ אצלך (FastAPI, ב-Python). השרת מחזיר טיוטת תשובה בעברית, והטיוטה מוצגת לך באפליקציה. אפשר לערוך אותה, להעתיק אותה, לבטל אותה, או (רק אם הפעלת במפורש את השליחה הניסיונית) לאשר ולשלוח. השרת לא שולח הודעות, לא שומר תוכן הודעות ולא כותב אותו ללוגים. ברירת המחדל לא עולה כסף: השרת כבוי, והמנוע הוא `stub`, מנוע מקומי שלא פונה לשום שירות ענן. חיבור לנועה האמיתית או למודל של Anthropic הוא החלטה שלך, והשימוש בו משולם מהחשבון שלך.

> **חשוב לדעת מראש:** האפליקציה עוד לא נבדקה על מכשיר אמיתי. השליחה מתוך האפליקציה ניסיונית ו**לא אומתה**, ואין אישור מסירה. ב-Android 15 ומעלה המערכת מסתירה התראות שהיא מסווגת כ"רגישות" (למשל ממספרים שלא שמורים אצלך, או הודעות עם רצפי ספרות), ולכן חלק מהשיחות לא יקבלו טיוטה.

## מצב נוכחי

| רכיב | מצב | הערות |
|---|---|---|
| שרת הגשר (`bridge-service`) | ✅ מוכן | 348 בדיקות עוברות (`pytest`, הורץ ב-2026-11-15). `health`, צימוד, טיוטות, ביטול מכשיר ו-Kill Switch נבדקו ידנית מול שרת מקומי |
| אפליקציית Android: לוגיקה (`core`), פלטפורמה, ממשק בעברית | ✅ קוד ובדיקות יחידה | לפי `TASK_BOARD.md`: ‏115 בדיקות `core`, ‏73 בדיקות פלטפורמה, ‏41 בדיקות UI |
| APK לדיבוג | ✅ נבנה | ב-CI זה ה-artifact בשם `noa-personal-bridge-debug-apk`, או בבנייה מקומית |
| בדיקה על Galaxy S25 Ultra (קריאה בלבד) | ⏸️ ממתין למכשיר | פרוטוקול R0–R16 ב-[ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md) |
| שליחה דרך כפתור התשובה של WhatsApp | ⏸️ ניסיוני, לא אומת | כבוי כברירת מחדל. ניסוי השליחה הראשון (S1) דורש אישור מפורש שלך ואיש קשר שהסכים מראש |
| חיבור לנועה החיה (`noa_persona`) | ⏸️ ממתין לאימות | נקודת הקצה `/prompt` של נועה לא נבדקה מול השרת החי |
| מנוע בענן (`anthropic` / `noa_persona`) | כבוי | דורש מפתח API שלך, והשימוש עולה כסף. ההחלטה שלך |
| ביקורת קוד, אבטחה, פרטיות, QA, UX | 🔄 בעבודה | ראו את המסמכים בטבלה למטה |

## התחלה מהירה

1. מורידים את ה-APK מ-GitHub Actions (workflow בשם "NOA Personal Bridge") או בונים אותו מקומית. ראו [INSTALLATION_HE.md](INSTALLATION_HE.md), סעיף 1.
2. מתקינים על הטלפון, נותנים גישה להתראות, ואם צריך מאשרים "Allow restricted settings". סעיף 2.
3. מריצים את השרת על המחשב עם המנוע `stub`:

```powershell
cd noa-personal-bridge\bridge-service
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:BRIDGE_ENABLED = "true"
$env:BRIDGE_ENGINE = "stub"
.\.venv\Scripts\python.exe -m bridge_service.main
```

4. חושפים את השרת לטלפון רק דרך HTTPS (מנהרה כמו Tailscale או Cloudflare). סעיף 3.4.
5. בחלון PowerShell נוסף, באותה תיקייה, יוצרים קוד חיבור:

```powershell
.\.venv\Scripts\python.exe -m bridge_service.admin create-pairing-code
```

   ובאפליקציה לוחצים על **חיבור לשרת**.
6. בודקים שהכול עובד כשהשליחה כבויה. סעיף 7.

השימוש היומיומי מוסבר ב-[USER_GUIDE_HE.md](USER_GUIDE_HE.md), ופתרון תקלות ב-[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## כל המסמכים

| מסמך | על מה |
|---|---|
| [README.md](README.md) | הדף הזה: סקירה, מצב, התחלה מהירה |
| [ARCHITECTURE.md](ARCHITECTURE.md) | שלושת הרכיבים, זרימת ההודעה, מכונת המצבים וגבולות האמון |
| [EXISTING_SYSTEM_AUDIT.md](EXISTING_SYSTEM_AUDIT.md) | סקירת המערכת הקיימת (נועה, Kerem Orders, ‏smart-crm) לפני העבודה |
| [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) | איך הגשר מתחבר לנועה בלי לשנות אותה, משתני סביבה ו-CI |
| [ANDROID_FEASIBILITY.md](ANDROID_FEASIBILITY.md) | מחקר היתכנות: מה Android ו-WhatsApp מאפשרים, הגדרות Samsung ופרוטוקול בדיקה במכשיר |
| [AGENT_ROSTER.md](AGENT_ROSTER.md) | רשימת הסוכנים והתפקידים בפרויקט |
| [TASK_BOARD.md](TASK_BOARD.md) | לוח משימות וסטטוס |
| [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) | תלויות בין המשימות |
| [DECISION_LOG.md](DECISION_LOG.md) | יומן החלטות (D-001 ואילך) |
| [RISK_REGISTER.md](RISK_REGISTER.md) | מרשם סיכונים |
| [SECURITY.md](SECURITY.md) | מודל איומים ואבטחה |
| [PRIVACY.md](PRIVACY.md) | מה נאסף, לאן הוא נשלח ומה נשמר |
| [TEST_PLAN.md](TEST_PLAN.md) | תוכנית בדיקות |
| [TEST_RESULTS.md](TEST_RESULTS.md) | תוצאות בדיקות |
| [CODE_REVIEW.md](CODE_REVIEW.md) | ביקורת קוד עצמאית |
| [UX_PERFORMANCE_REVIEW.md](UX_PERFORMANCE_REVIEW.md) | ביקורת חוויית משתמש, נגישות וביצועים |
| [INSTALLATION_HE.md](INSTALLATION_HE.md) | מדריך התקנה: APK, טלפון, שרת, מנהרת HTTPS, חיבור לנועה והגדרות Samsung |
| [USER_GUIDE_HE.md](USER_GUIDE_HE.md) | מדריך שימוש יומיומי |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | תקלות נפוצות ופתרונות |
| [ROLLBACK.md](ROLLBACK.md) | איך מכבים ומבטלים הכול, שכבה אחרי שכבה |
| [FINAL_REPORT.md](FINAL_REPORT.md) | דוח מסכם |
| [BASELINE_REGRESSION.md](BASELINE_REGRESSION.md) | בדיקות הבסיס של המערכת הקיימת, לפני השינוי ואחריו |

מסמכים טכניים נוספים, ליד הקוד:
- `noa-personal-bridge/API_CONTRACT.md`: חוזה ה-API בין האפליקציה לשרת.
- `noa-personal-bridge/bridge-service/README.md`: השרת, האבטחה ומה נשמר.
- `noa-personal-bridge/bridge-service/bridge_service/ai/README.md`: שכבת ה-AI, מודל האיומים ולמה אסור להשתמש ב-`/chat` של נועה.
