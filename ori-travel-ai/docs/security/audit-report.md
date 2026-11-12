# דוח ביקורת בלתי-תלויה — Ori Travel AI

> מבקר: AUD (תפקיד 20). תאריך: 12.11.2026.
> המבקר לא כתב שום קוד בפרויקט ולא שינה שום קובץ מלבד הדוח הזה.
> כל ממצא מסומן **CONFIRMED** (שוחזר בפועל) או **PLAUSIBLE** (קריאת קוד בלבד).

## 1. שורה תחתונה

ליבת המערכת בנויה טוב, ורוב הטענות המרכזיות בתיעוד נכונות:

* לא נמצאה דרך להגיע ל-CONFIRMED בלי אישור אנושי, בלי סיסמה ובלי אסמכתה.
* לא נמצא IDOR בנתונים הפרטיים (מועדפים, התראות, היסטוריית חיפוש, הודעות).
* צופה לא מצליח לבצע שום פעולת שינוי. CSRF, ‏Origin ו-Content-Type נאכפים.
* ביצוע הזמנה אמיתית באמת כבוי, וספקים חיים באמת לא פעילים בלי opt-in ומפתחות.
* אין סודות ב-repo. שדות הדרכון, השם המשפטי ותאריך הלידה מוצפנים בקובץ ה-DB.

לא נמצאו ממצאים ברמת Critical או High. נמצאו **8 ממצאים בינוניים**, **9 נמוכים** ו-**6 הערות**.
שלושה מהבינוניים סותרים טענה מפורשת בתיעוד ולכן כדאי לתקן אותם לפני שמסמנים DONE:

1. ה-`terms_hash` לא מכסה חלק מהשורות שהמשתמש קורא לפני האישור (AUD-01).
2. אסימון ההזמנה למשפחה נכתב ללוג כטקסט גלוי (AUD-02).
3. מסלול "מעבר לאתר הספק" לא ניתן להשלמה עם אף ספק שקיים בקוד (AUD-05).

## 2. מתודולוגיה — מה הורץ בפועל

סביבת הבדיקה: מסד SQLite נפרד ב-`/tmp/claude-0/aud/aud.db`, שרת מקומי על פורט 8051,
שלושה משתמשים (owner, adult, viewer) שנוצרו דרך ה-CLI ודרך הזמנות. לא בוצעה שום פנייה לרשת חיצונית.

| בדיקה | תוצאה |
|---|---|
| `pytest tests -p no:warnings -o addopts="" -q` | **552 passed** (116 שניות) |
| `pytest tests/test_booking.py` | **69 passed** — תואם לטענה בתיעוד |
| `bandit -r app -ll -q` | **0 ממצאים** (יש `nosec B314` אחד על פענוח ה-XML של ה-ECB, מוצדק) |
| `pip-audit -r requirements.txt` | **No known vulnerabilities found** |
| `alembic check` | **No new upgrade operations detected** — המודלים תואמים למיגרציה |
| `npx vitest run` (frontend, בזמן שהתיקיות עדיין בעבודה) | 25 קבצים, **142 passed** |
| חיפוש סודות בקבצים שב-git (486 קבצים) | רק ערכי דמה בתוך בדיקות |
| בדיקות ידניות מול השרת | סקריפטים `p1.py`–`p8.py` ב-`/tmp/claude-0/aud/` |

הבדיקות הידניות כיסו: התחברות ונעילה, סשנים, הזמנות למשפחה, כל ה-routers מול שלושת התפקידים,
CSRF ו-Origin, מחזור הזמנה מלא כולל מרוצים (6 שליחות במקביל, 8 שליחות עם אותו מפתח), UNKNOWN,
שינוי מחיר, פקיעת אישור, הצפנה בקובץ ה-DB, לוגים, ו-grounding של ה-AI.

## 3. ממצאים

### 3.1 טבלה מסכמת

| ID | חומרה | כותרת | סטטוס |
|---|---|---|---|
| AUD-01 | Medium | `terms_hash` לא מכסה שורות שמוצגות למאשר | CONFIRMED |
| AUD-02 | Medium | אסימון הזמנה למשפחה נכתב ללוג | CONFIRMED |
| AUD-03 | Medium | עקיפת allowlist של deep link עם backslash | CONFIRMED |
| AUD-04 | Medium | אין אימות של הרכב הנוסעים מול ההצעה | CONFIRMED |
| AUD-05 | Medium | מסלול HOSTED_CHECKOUT לא ניתן להשלמה עם הספקים הקיימים | CONFIRMED |
| AUD-06 | Medium | עקיפות של בדיקת ה-grounding ב-AI | CONFIRMED |
| AUD-07 | Medium | מידע בריאותי של נוסעים בטקסט גלוי, וחלקו חשוף לצופים | CONFIRMED |
| AUD-08 | Medium | פערים במחיקת מידע ובמדיניות השמירה | PLAUSIBLE |
| AUD-09 | Low | `GET checkout-link` משנה מצב בלי CSRF | CONFIRMED |
| AUD-10 | Low | `X-Forwarded-For` מזויף מתקבל; חסימת התחברות לכולם | CONFIRMED |
| AUD-11 | Low | הזמנת תפקיד "מבוגר" מקושרת לבן משפחה קטין | CONFIRMED |
| AUD-12 | Low | כל מבוגר עורך כל בן משפחה ומוחק כל פרופיל נוסע | CONFIRMED |
| AUD-13 | Low | עקיפת מגבלת גודל הבקשה ב-chunked | CONFIRMED |
| AUD-14 | Low | בדיקת Origin סומכת על כותרת Host | CONFIRMED |
| AUD-15 | Low | ה-CSP חוסם את אריחי המפה | PLAUSIBLE |
| AUD-16 | Low | מדיניות סיסמאות חלשה | CONFIRMED |
| AUD-17 | Low | אין בלם להפעלה לא מאובטחת ב-production | PLAUSIBLE |
| AUD-18 | Info | צופה יכול לצרוך מכסות ספקים ו-AI בתשלום | CONFIRMED |
| AUD-19 | Info | בעל החשבון רואה חיפושים של אחרים; הצעה נגישה לפי מזהה | CONFIRMED |
| AUD-20 | Info | נתוני DEMO עם שמות אמיתיים; dedupe מתעלם ממצב הנתונים | CONFIRMED |
| AUD-21 | Info | נעילה מוחזקת בזמן פנייה לרשת ב-FX | PLAUSIBLE |
| AUD-22 | Info | חשיפת דרכון בלי סיסמה ב-10 הדקות שאחרי התחברות | CONFIRMED |
| AUD-23 | Info | רישום אסמכתה ידני אחרי פקיעת האישור | PLAUSIBLE |

### 3.2 פירוט — Medium

#### AUD-01 — `terms_hash` לא מכסה שורות שמוצגות למאשר (CONFIRMED)

קבצים:

`apps/api/app/modules/booking/terms.py:36-86`

`apps/api/app/modules/booking/service.py:359-386`

**מה קורה.** ה-hash כולל רק חלק מהשדות. הוא לא כולל את כותרת ההצעה, את `price.excluded_notes`
(עלויות שלא כלולות במחיר), את `price.total_status`, את מספר העצירות, את שם הספק ושדות נוספים.
כל אלה מופיעים בסיכום שהמשתמש קורא לפני האישור. ב-`_apply_check`, כשהספק מחזיר הצעה מעודכנת
וה-hash זהה, ה-snapshot **מוחלף** והתוצאה נחשבת "ללא שינוי". האישור הקודם נשאר תקף.

**השפעה.** אדם אישר טקסט אחד, וההזמנה ממשיכה עם טקסט אחר. זה סותר את סעיף 4.2(4)
ב-`booking-safety.md` ("תשובת ספק שמחזירה תנאים שונים נחשבת שינוי"). ההשפעה מוגבלת היום כי אין
ביצוע אמיתי, אבל זה בדיוק המנגנון שאמור להגן כשיהיה.

**שחזור.** קראתי ל-`_apply_check` עם `RevalidationResult(status="unchanged", refreshed_offer=...)`
שבו שיניתי כותרת, `excluded_notes`, מספר עצירות ושם ספק:

```
outcome: unchanged   hash same: True
BEFORE: מה מזמינים: תל אביב – אתונה
AFTER:  מה מזמינים: טיסה אחרת לגמרי — מוצר שונה
BEFORE: ... (ישירה; D2192)
AFTER:  ... (2 עצירות; D2192)
AFTER:  לא כלול במחיר: דמי טיפול 400 ₪ ייגבו בשדה התעופה
```

**תיקון מוצע.** לחשב את ה-hash גם על שורות הסיכום עצמן (`build_terms_summary`), או להוסיף ל-`canonical_terms`
את `title`, ‏`excluded_notes`, ‏`total_status`, רכיבי המחיר, `stops` ו-`provider_name`. בנוסף, לא להחליף
snapshot של הזמנה מאושרת בלי להשוות את הסיכום הישן לחדש.

#### AUD-02 — אסימון הזמנה למשפחה נכתב ללוג (CONFIRMED)

קבצים:

`apps/api/app/core/middleware.py:59`

`apps/api/app/modules/auth/router.py:75-80`

`apps/api/app/core/redaction.py:83-88`

**מה קורה.** תצוגה מקדימה של הזמנה היא `GET /api/auth/invitations/{token}`. הנתיב המלא נרשם פעמיים:
בלוג `ori.http` ובלוג הגישה של uvicorn. מסנן הצנזור מותקן רק על ה-handlers של ה-root logger,
ואין לו תבנית לאסימונים כאלה. גם נתיב ה-SPA ‏`/invite/<token>` נרשם בלוג הגישה.

**השפעה.** האסימון נרשם **לפני** שההזמנה מומשה. מי שקורא את הלוג בתוך 72 שעות יכול לפתוח חשבון
בתפקיד שהוזמן, כולל owner.

**שחזור.**

```
INFO ori.http: GET /api/auth/invitations/3zT6dMwIEyff09EuGPbIVhmsNjciGCM9 -> 404 (1ms)
INFO: 127.0.0.1:56972 - "GET /api/auth/invitations/3zT6dMwIEyff09EuGPbIVhmsNjciGCM9 HTTP/1.1" 404
```

**תיקון מוצע.** להעביר את האסימון בגוף של POST (או ב-fragment של ה-URL בצד הלקוח), למסך בלוג כל
מקטע נתיב אחרי `/invitations/` ו-`/invite/`, ולהחיל את המסנן גם על `uvicorn.access` או לכבות אותו.

#### AUD-03 — עקיפת allowlist של deep link עם backslash (CONFIRMED)

קובץ:

`apps/api/app/modules/providers/base.py:155-167`

**מה קורה.** `urlsplit` של Python רואה ב-`https://evil.com\.viator.com/x` שם מארח אחד שמסתיים
ב-`.viator.com`, ולכן הקישור מאושר. דפדפנים מפרשים backslash כמפריד נתיב ומנווטים ל-`evil.com`.
גם הלקוח לא עוצר את זה: `safeHref` ו-`safeCheckoutUrl` בודקים רק את הפרוטוקול.

**השפעה.** הפניה פתוחה דרך כפתור "מעבר לאתר הספק" ודרך הקישור בפרטי ההצעה. הניצול דורש תשובה
זדונית או פגומה מספק, אבל זו בדיוק הבקרה שמוצהרת ב-T8 ("תוכן ספקים לא אמין").

**שחזור.**

```
is_allowed_deep_link('https://evil.com\\.viator.com/x')  ->  True
node: new URL('https://evil.com\\.viator.com/x').hostname  ->  'evil.com'
```

**תיקון מוצע.** לדחות כל URL שמכיל backslash, רווחים או תווי בקרה, לדרוש ששם המארח יתאים
ל-`^[a-z0-9.-]+$`, ולדחות פורט שאינו 443. רצוי להוסיף בדיקת allowlist גם בלקוח.

#### AUD-04 — אין אימות של הרכב הנוסעים מול ההצעה (CONFIRMED)

קובץ:

`apps/api/app/modules/booking/service.py:234-270, 821-851`

**מה קורה.** `create_intent` ו-`update_travelers` בודקים רק שהנוסעים קיימים. אי-התאמה במספר הנוסעים
מפיקה אזהרה בלבד, ואי-התאמה בסוג הנוסעים לא מפיקה כלום. אין דרישה למבוגר מלווה.

**שחזור.** הצעת טיסה שתומחרה ל-2 מבוגרים. החלפתי את הנוסעים לילדה ותינוק בלבד, בדקתי מחיר,
אישרתי ושלחתי:

```
approve minors-only: 200 APPROVED  (ללא שום אזהרה על הרכב הנוסעים)
submit: 200 CONFIRMED, SIM-C9DB1B
```

**תיקון מוצע.** לחסום (409) כשמספר הנוסעים או חלוקת הגילים לא תואמים ל-`details.passengers` /
`adults` / `children`, ולדרוש לפחות מבוגר אחד כשיש קטינים.

#### AUD-05 — מסלול HOSTED_CHECKOUT לא ניתן להשלמה עם הספקים הקיימים (CONFIRMED)

קבצים:

`apps/api/app/modules/providers/live/viator.py:125-128`

`apps/api/app/modules/providers/live/duffel.py:669-680`

`apps/api/app/modules/providers/service.py:300-312`

**מה קורה.** כדי להגיע ל-APPROVED חייבת להצליח בדיקת מחיר. Viator הוא המתאם היחיד עם hosted
checkout, אבל הוא לא תומך ב-revalidate, ולכן כל בדיקה מחזירה `error` וההזמנה נתקעת ב-QUOTE_SELECTED.
Duffel תומך ב-revalidate אבל לא מחזיר קישור, ולכן יצירת הזמנה נדחית ב-`BOOKING_UNAVAILABLE`.

**השפעה.** אפשרות (ב) ב-`booking-safety.md` — מעבר לאתר הספק ורישום אסמכתה — לא ניתנת לביצוע עם אף
ספק אמיתי. הבדיקות עוברות כי הן משתמשות במתאם מזויף שתומך בשניהם.

**שחזור.**

```
viator  revalidate: False | hosted: True
duffel  revalidate: True  | hosted: False
ViatorAdapter().revalidate(...) -> ProviderUnsupportedError
```

**תיקון מוצע.** להחליט במפורש: או לממש ב-Viator בדיקת מחיר (שליפה חוזרת של המוצר), או לאפשר לספק
בלי revalidate מסלול אישור שמסומן בבירור "מחיר לא אומת". עד אז לתקן את התיעוד.

#### AUD-06 — עקיפות של בדיקת ה-grounding ב-AI (CONFIRMED)

קובץ:

`apps/api/app/modules/ai/grounding.py:42-50, 150-172, 180-183`

**מה קורה.** הבדיקה מבוססת ביטויים רגולריים, ויש פורמטים שהיא מפספסת.

**שחזור.** `ground_text` עם סכום מותר יחיד של 3,100.45 ₪. כל השורות האלה עברו **בלי שינוי**:

```
המחיר הוא 1.200 ₪ בלבד.          (מפריד אלפים אירופי)
המחיר ₪1.200 לאדם.
המחיר 1200.555 ₪
המחיר 12 אלף ₪.
המחיר אלפיים שקלים.               (מספר במילים)
עולה 99 בלבד.                     (מספר דו-ספרתי בלי מטבע)
ההזמנה שלך אושרה.                 (התבנית מכירה רק "שלכם")
הטיסה הוזמנה בהצלחה!
Your flight is booked.
```

**השפעה.** מודל יכול להציג מחיר שלא אומת או לטעון שבוצעה הזמנה, בניגוד ל-T6. הכרטיסים עצמם תמיד
מגיעים מנתוני השרת, ולכן הנזק מוגבל לטקסט החופשי.

**תיקון מוצע.** להפוך את הכיוון: להסיר כל מספר שסמוך למילת מחיר או לסימן מטבע אלא אם הוא תואם
לסכום מותר, להוסיף תמיכה במפריד אלפים עם נקודה, ב"אלף"/"K" ובמספרים במילים, ולהרחיב את תבניות
טענות ההזמנה ("שלך", "הוזמנה", "is booked").

#### AUD-07 — מידע בריאותי של נוסעים בטקסט גלוי, וחלקו חשוף לצופים (CONFIRMED)

קבצים:

`apps/api/app/models/family.py:63-69`

`apps/api/app/modules/travelers/service.py:86-98`

**מה קורה.** `notes` ו-`accessibility_needs` נשמרים בלי הצפנה, כמו גם מגדר ולאום. אלה שדות שבפועל
מכילים מידע רפואי. בנוסף, `accessibility_needs`, שלוש הספרות האחרונות של הדרכון וחודש התפוגה
מוחזרים גם לצופה.

**שחזור.** שמרתי פרופיל עם `notes="diabetic insulin"` ו-`accessibility_needs=["wheelchair"]`:

```
select notes, accessibility_needs from traveler_profiles
-> ('diabetic insulin', '["wheelchair"]')
GET /api/travelers (viewer) -> "passport_masked":"••••••567", "accessibility_needs":["wheelchair"]
```

השדות המוצפנים (שם, תאריך לידה, דרכון, נוסע מתמיד) אכן לא מופיעים בקובץ.

**תיקון מוצע.** להצפין את `notes` ואת `accessibility_needs`, ולהחזיר לצופה רק דגל בוליאני. לשקול
להסתיר מצופים גם את סיומת הדרכון.

#### AUD-08 — פערים במחיקת מידע ובמדיניות השמירה (PLAUSIBLE)

קבצים:

`apps/api/app/modules/settings/service.py:71-103`

`apps/api/app/modules/family/service.py:109-126`

**מה קורה.**

* אין endpoint למחיקת משתמש, רק השבתה. האימייל, השם, ה-hash של הסיסמה, החיפושים וההתראות נשארים.
* מחיקת בן משפחה מוחקת את פרופיל הנוסע, אבל השם שלו נשאר ב-`booking_intents.travelers`,
  ב-`reservations.details` וב-`approvals.summary`.
* הרצת ה-retention מוחקת רק חיפושים, הצעות לא מקושרות ואירועי ביקורת. היא לא נוגעת בסשנים שפגו
  (כולל IP ו-User-Agent), בהזמנות למשפחה ישנות (אימיילים), בהודעות ובתמונות מצב של מחירים.

**השפעה.** הטענה ב-T12 ("מחיקת נתונים לפי בקשה ותמיכה ב-retention") נכונה רק חלקית.

**תיקון מוצע.** להוסיף מחיקת משתמש לבעל החשבון, לנקות או להפוך לאנונימיים שמות נוסעים בהזמנות
סופיות, ולהרחיב את ה-retention לסשנים, להזמנות למשפחה, להודעות ולתמונות מצב.

### 3.3 פירוט — Low

#### AUD-09 — `GET checkout-link` משנה מצב בלי CSRF (CONFIRMED, עם הסתייגות)

קבצים:

`apps/api/app/modules/booking/router.py:136-140`

`apps/api/app/modules/booking/service.py:734-770`

בקשת GET לא עוברת בדיקת CSRF או Origin, והעוגייה היא `SameSite=Lax`. ה-endpoint מריץ
`_recheck_before_handoff`, שיכול להעביר את ההזמנה ל-EXPIRED או ל-QUOTE_SELECTED, לבטל אישור ולפנות לספק.

שחזור: מכיוון ש-AUD-05 חוסם את המסלול, יצרתי הזמנה מאושרת ושיניתי ישירות ב-DB את
`execution_mode` ל-`HOSTED_CHECKOUT` ואת תוקף ההצעה לעבר. אחר כך שלחתי GET עם עוגיית הסשן בלבד
ועם `Origin: https://evil.example`:

```
GET /api/bookings/<id>/checkout-link -> 409 OFFER_EXPIRED
state after GET: EXPIRED
audit: booking.expire, booking.approval_invalidated
```

תיקון מוצע: להפוך ל-POST.

#### AUD-10 — `X-Forwarded-For` מזויף מתקבל; חסימת התחברות לכולם (CONFIRMED)

קבצים:

`apps/api/app/core/audit.py:17-20`

`apps/api/app/modules/auth/service.py:52-66`

`scripts/start.sh:42`

uvicorn סומך כברירת מחדל על כותרות proxy שמגיעות מ-127.0.0.1. שלחתי התחברות עם
`X-Forwarded-For: 10.0.0.5`, ויומן הביקורת רשם `ip='10.0.0.5'`. כך אפשר לעקוף את ההגבלה לפי IP ולזייף
את ה-IP ביומן.

הצד השני של אותה בעיה: בהרצה מקומית או מאחורי proxy מקומי כל המשתמשים חולקים IP אחד.
20 ניסיונות כושלים ב-5 דקות חוסמים את ההתחברות **לכל המשפחה**. בנוסף, 5 ניסיונות כושלים נועלים
חשבון ל-15 דקות, ואפשר לחזור על זה בלי סוף מול האימייל של בעל החשבון.

תיקון מוצע: להריץ עם `--no-proxy-headers` כברירת מחדל ולהגדיר `--forwarded-allow-ips` במפורש רק
כשיש proxy. לשקול השהיה הדרגתית במקום נעילה מלאה.

#### AUD-11 — הזמנת תפקיד "מבוגר" מקושרת לבן משפחה קטין (CONFIRMED)

קובץ:

`apps/api/app/modules/family/service.py:232-246`

`create_invitation` לא בודק את `is_minor` של בן המשפחה המקושר.

```
POST /api/family/invitations {role:"adult", legal_adult_attested:true,
                              family_member_id:<נועה, child, is_minor=true>} -> 201
```

התוצאה היא חשבון שמורשה להזמין ומקושר לרשומה של קטין. תיקון מוצע: לדחות תפקיד adult או owner
כשבן המשפחה המקושר מסומן קטין.

#### AUD-12 — כל מבוגר עורך כל בן משפחה ומוחק כל פרופיל נוסע (CONFIRMED)

קבצים:

`apps/api/app/modules/family/router.py:38-42`

`apps/api/app/modules/family/service.py:84-106`

`apps/api/app/modules/travelers/router.py:36-39`

משתמש בתפקיד adult שינה את הרשומה של בעל החשבון:

```
PATCH /api/family/members/<owner member> {display_name:"HACKED", is_minor:true, age_group:"infant"} -> 200
DELETE /api/travelers/<member> -> 200   (מחיקת דרכון בלי אימות סיסמה)
```

עוד שתי נקודות באותו אזור: `is_minor` ו-`age_group` יכולים לסתור זה את זה, ושינוי שם או קבוצת גיל
אחרי אישור הזמנה לא מבטל את האישור (ה-hash כולל רק מזהים). תיקון מוצע: להגביל עריכת רשומה שמקושרת
למשתמש אחר לבעל החשבון, לדרוש reauth למחיקת פרופיל, ולגזור את `is_minor` מ-`age_group`.

#### AUD-13 — עקיפת מגבלת גודל הבקשה ב-chunked (CONFIRMED)

קובץ:

`apps/api/app/core/middleware.py:41-44`

המגבלה של 1MB נבדקת רק מול `Content-Length`. גוף של 3MB ב-`Transfer-Encoding: chunked` לנתיב
ההתחברות הגיע עד שלב האימות (422) ולא נדחה ב-413. תיקון מוצע: לספור בייטים בזמן הקריאה.

#### AUD-14 — בדיקת Origin סומכת על כותרת Host (CONFIRMED)

קובץ:

`apps/api/app/core/middleware.py:66-74`

בקשה עם `Origin: http://evil.example` ו-`Host: evil.example` עברה (200). אין אימות של שמות מארח
מותרים. דפדפן לא מאפשר לזייף Host, ולכן הניצול המעשי הוא DNS rebinding, שמגיע רק ל-endpoints
שלא דורשים סשן (התחברות, מימוש הזמנה). תיקון מוצע: `TrustedHostMiddleware` עם רשימה מפורשת.

#### AUD-15 — ה-CSP חוסם את אריחי המפה (PLAUSIBLE)

קבצים:

`apps/api/app/core/middleware.py:86`

`apps/web/src/features/trips/components/TripMap.tsx:34`

ה-CSP מתיר `https://*.tile.openstreetmap.org`, והלקוח טוען מ-`https://tile.openstreetmap.org`.
לפי מפרט CSP, כוכבית מתאימה לתת-דומיינים בלבד ולא לדומיין עצמו, כך שהאריחים ייחסמו כשהאפליקציה
מוגשת מ-FastAPI. לא נבדק בדפדפן. תיקון מוצע: להוסיף את הדומיין המדויק ל-`img-src`.

#### AUD-16 — מדיניות סיסמאות חלשה (CONFIRMED)

קובץ:

`apps/api/app/core/security.py:45-60`

הסיסמה `aaaaaaaaa1` התקבלה בשינוי סיסמה (200). אין בדיקה מול רשימת סיסמאות נפוצות ואין MFA
(האחרון מתועד כמגבלה). תיקון מוצע: רשימת חסימה קצרה ואיסור על רצף של תו חוזר.

#### AUD-17 — אין בלם להפעלה לא מאובטחת ב-production (PLAUSIBLE)

קבצים:

`apps/api/app/core/config.py:44`

`scripts/start.sh:28-30`

`ORI_ENV=production` עם `ORI_COOKIE_SECURE=false` מתקבל בלי שגיאה, אין כותרת HSTS, ו-`start.sh` במצב
רשת מאזין על `0.0.0.0` ב-HTTP רגיל עם אזהרה בלבד. בסביבת פיתוח `/api/docs`, ‏`/api/openapi.json`
ו-`/api/ready` (שמחזיר את שם הסביבה) פתוחים בלי התחברות. תיקון מוצע: לסרב לעלות ב-production בלי
עוגיות Secure.

### 3.4 הערות — Info

* **AUD-18.** צופה יכול להריץ חיפושים ולהשתמש בעוזר ה-AI. כשספקים חיים או AI בתשלום מופעלים, זה
  צורך מכסה: עד 20 הודעות ב-10 דקות למשתמש, וכל הודעה יכולה לגרור עד 6 קריאות למודל.
  קובץ: `apps/api/app/modules/ai/service.py:63-66`.
* **AUD-19.** בעל החשבון יכול לקרוא חיפוש של כל חבר משפחה לפי מזהה, ואת כל ההתראות. `GET /api/offers/{id}`
  מחזיר הצעה לכל משתמש מחובר בלי בדיקת בעלות (המזהים אקראיים). כדאי לתעד את זה כהחלטה.
  קובץ: `apps/api/app/modules/search/service.py:644-649, 711-713`.
* **AUD-20.** כל הצעות ה-DEMO מסומנות נכון (ראו טבלת הטענות). עם זאת, ספקי הפעילויות והרכב משתמשים
  בשמות אמיתיים ("מוזיאון הלובר", "Fiat 500") עם מחירים מומצאים. בנוסף, `dedupe_offers` מקבץ לפי
  מפתח ומטבע בלי להתחשב ב-`source.mode`, כך שתיאורטית הצעת DEMO זולה יכולה להסתיר הצעה חיה זהה.
  קובץ: `apps/api/app/modules/search/service.py:333-345`.
* **AUD-21.** `_live_rates` מחזיק נעילה גלובלית בזמן הפנייה ל-ECB (עד 8 שניות), וכל בקשה אחרת
  שצריכה שער ממתינה. קובץ: `apps/api/app/modules/comparison/fx.py:197-212`.
* **AUD-22.** `reauth_at` מקבל ערך כבר בהתחברות, ולכן חשיפת דרכון אפשרית בלי הזנת סיסמה נוספת
  ב-10 הדקות הראשונות של הסשן. אחרי זה הדרישה נאכפת (נבדק: 403 ואז 200 אחרי reauth).
  קובץ: `apps/api/app/modules/auth/service.py:108`.
* **AUD-23.** `record_confirmation` מקבל כל אסמכתה שהמשתמש מקליד, גם אחרי שתוקף האישור פג. זה
  מתועד כהחלטה, אבל כדאי לסמן ב-UI בבירור שזו אסמכתה שהוזנה ידנית ולא אומתה.
  קובץ: `apps/api/app/modules/booking/service.py:773-800`.

## 4. טענות שנבדקו

| טענה | אומת? | ראיה |
|---|---|---|
| כל הבדיקות עוברות | כן | 552 passed; ‏69 ב-`test_booking.py` |
| אין הרשמה ציבורית | כן | אין endpoint כזה; משתמש נוצר רק ב-CLI או בהזמנה של owner |
| הזמנה למשפחה חד-פעמית, עם תוקף, נשמר רק hash | כן | שימוש חוזר מחזיר 404; ב-DB רק `token_hash` |
| ...אבל האסימון לא דולף | **לא** | AUD-02 |
| אי אפשר להעלות תפקיד דרך הזמנה | כן | יצירת הזמנה ושינוי תפקיד רק ל-owner; adult קיבל 403 |
| הגנה על owner אחרון ועל שינוי תפקיד עצמי | כן | `CANNOT_CHANGE_OWN_ROLE`, ‏`CANNOT_DEACTIVATE_SELF`, ‏`LAST_OWNER` |
| מבוגר בלי הצהרת בגירות לא יכול להזמין | כן | `ATTESTATION_REQUIRED` בהזמנה ובעדכון |
| נעילה אחרי 5 כישלונות | כן | סיסמה נכונה נדחתה בזמן נעילה |
| סשן: hash בלבד, httpOnly, ‏SameSite, תפוגה ו-idle | כן | עוגיות נבדקו; 49 שעות idle ותפוגה מוחלטת מחזירות 401 |
| ביטול סשנים בשינוי סיסמה, בהשבתה וב-logout | כן | סשן אחר קיבל 401 בכל אחד מהמקרים |
| CSRF, ‏Origin, ‏JSON בלבד | כן | בלי אסימון: 403; אסימון של משתמש אחר: 403; Origin זר: 403; `text/plain`: ‏415 |
| CORS בלי wildcard | כן | preflight ממקור זר נדחה; validator חוסם `*` |
| צופה לקריאה בלבד | כן | 403 בכל פעולת שינוי שנבדקה |
| נתונים פרטיים לפי משתמש | כן | מועדפים, התראות וחיפוש של אחר מחזירים 404 |
| ביצוע הזמנה אמיתית כבוי | כן | `submit` מסרב לכל מה שאינו סימולציה; הדגל לא נקרא בקוד |
| מצב משתנה רק דרך מכונת המצבים | כן | שדה `state` בגוף הבקשה: 422; דילוג על שלבים: 409 |
| האישור קשור לתנאים | **חלקית** | hash שגוי או ישן נדחה; אבל ראו AUD-01 |
| שינוי מחיר אחרי אישור חוסם שליחה | כן | 409 `PRICE_CHANGED`, האישור בוטל |
| Idempotency ומניעת כפילות | כן | 6 שליחות במקביל: הזמנה אחת; אותו מפתח 8 פעמים: אסמכתה אחת; מפתח בהזמנה אחרת: 409 |
| UNKNOWN חוסם עד reconcile | כן | כל פעולה אחרת: 409 `RECONCILE_REQUIRED` |
| תוקף אישור ורעננות בדיקת מחיר | כן | `APPROVAL_EXPIRED`, ‏`REVALIDATION_REQUIRED` |
| מעבר לאתר הספק זמין | **לא** | AUD-05 |
| ספקים חיים לא מחוברים כברירת מחדל | כן | כולם `NOT_CONFIGURED`; ‏Amadeus תמיד כבוי |
| כל הצעת DEMO מסומנת, מותגים בדויים | כן | ארבע הקטגוריות: `mode=DEMO`, הערה ו"(דמו)" בכל הצעה |
| ה-API לא מחזיר ערכי סודות | כן | רק שמות משתני סביבה |
| אין סודות ב-repo; ‏`.env.example` בלי ערכים | כן | רק ערכי דמה בבדיקות; `.env` ו-`data/` ב-gitignore |
| הצפנת דרכון, שם ותאריך לידה | כן | לא נמצאו ב-`strings` על קובץ ה-DB |
| כל המידע הרגיש מוצפן | **לא** | AUD-07 |
| חשיפת דרכון עם reauth ורישום ביומן | כן | ראו גם AUD-22 |
| צנזור בלוגים | **חלקית** | סיסמאות ודרכונים לא הופיעו; אסימון הזמנה כן (AUD-02) |
| ל-AI אין כלי הזמנה או תשלום | כן | `ALLOWED_TOOLS` כולל רק חיפוש, טיולים ו-`save_offer` |
| `save_offer` רק להצעה מהתור הנוכחי | כן | נבדק מול `state.shown` |
| מחירים בטקסט ה-AI מאומתים | **חלקית** | AUD-06 |
| AI בתשלום דורש `ORI_AI_ALLOW_PAID` | כן | `AnthropicClient.authorized`; ‏fallback בצד השרת בדגל נפרד |
| SSRF: אין URL מהמשתמש | כן | כתובות בסיס קבועות ב-https, בלי redirects |
| XXE בפענוח ECB | כן | DOCTYPE ו-ENTITY נדחים, גודל מוגבל |
| deep links רק לדומיינים מאושרים | **חלקית** | AUD-03 |
| כסף בלי float | כן | Decimal ויחידות קטנות לאורך כל הקוד |
| תקציב לא מערבב מטבעות | כן | `MIXED_CURRENCIES` בלי המרה שקטה |
| מיגרציות תואמות למודלים | כן | `alembic check` נקי |
| CSP לא שובר את האפליקציה | **חלקית** | אין סקריפט inline ב-`dist/index.html`; אבל ראו AUD-15 |
| אין `dangerouslySetInnerHTML`; קישורים חיצוניים עם `noopener` | כן | grep על `apps/web/src` |
| אין הפניה פתוחה אחרי התחברות | כן | `safeRedirect` מקבל רק נתיבים פנימיים |
| מחיקת נתונים ו-retention | **חלקית** | AUD-08 |

## 5. סיכונים שנשארים גם אחרי תיקון

* **מפתח ההצפנה על אותו דיסק.** מתועד. מגן מפני דליפת קובץ ה-DB בלבד.
* **Rate limiting בזיכרון.** מתאפס בכל הפעלה מחדש ולא עובד בריבוי תהליכים. מתועד.
* **אין MFA.** מתועד.
* **בדיקת grounding מבוססת ביטויים רגולריים.** גם אחרי תיקון AUD-06 היא לא תהיה הרמטית. ההגנה
  האמיתית היא שהכרטיסים והמחירים המחייבים מגיעים מהשרת.
* **אמון בתוך המשפחה.** כל מבוגר מורשה יכול לשנות, לאשר ולשלוח הזמנה שמישהו אחר יצר. זו החלטת
  תכנון סבירה, אבל כדאי שתהיה כתובה.
* **יומן הביקורת ניתן למחיקה** על ידי בעל החשבון דרך ה-retention (מינימום 30 יום).

## 6. מה לא הצלחתי לאמת

* **מתאמים חיים מול ספק אמיתי** (Duffel, ‏Viator, ‏ECB). לא בוצעו קריאות לרשת. נבדקו רק הקוד והבדיקות
  עם transport מדומה.
* **מצב מודל של ה-AI** (Ollama או Anthropic). נבדק רק מצב ה-fallback מקצה לקצה; ה-grounding נבדק
  ברמת הפונקציה.
* **PostgreSQL.** כל ההרצות היו על SQLite.
* **סקריפטי PowerShell ו-Windows.** לא הורצו.
* **התנהגות בדפדפן אמיתי:** CSP בפועל, המפה (AUD-15) ו-Playwright.
* **תיקיות ה-frontend שעדיין בעבודה** (`trips`, ‏`saved`, ‏`alerts`, ‏`family`, ‏`settings`, ‏`assistant`,
  ‏`bookings`). נסקרו בקריאה חלקית בלבד, ותוצאת vitest נכונה לרגע ההרצה.
* **מסלול HOSTED_CHECKOUT מקצה לקצה.** בגלל AUD-05 הוא נבדק רק עם שינוי ישיר ב-DB של סביבת הבדיקה.

---

## נספח: סטטוס תיקונים אחרי הביקורת (נכתב ע״י המנהל, לא ע״י המבקר)

> המבקר לא בדק מחדש את התיקונים. הסטטוס כאן מבוסס על בדיקות רגרסיה שנוספו לכל תיקון,
> ועל ריצה מלאה של 672 בדיקות API ב-SQLite וב-PostgreSQL 16.

| ID | חומרה | סטטוס | מה נעשה | איפה נבדק |
|---|---|---|---|---|
| AUD-01 | בינונית | ✅ תוקן | `terms_hash` קושר את כל שורות `terms_summary`, הכותרת, שם הספק, `total_status` ו-`excluded_notes` (TERMS_VERSION 2) | `tests/test_booking.py` |
| AUD-02 | בינונית | ✅ תוקן | preview ב-POST עם הטוקן בגוף הבקשה, קישור `/invite#token`, צנזור נתיבים בלוגים כולל uvicorn | `tests/test_security_hardening.py`, `tests/test_auth.py` |
| AUD-03 | בינונית | ✅ תוקן | ה-allowlist דוחה backslash, רווחים, תווי בקרה, userinfo, פורט ו-IP. גם בצד הלקוח (`lib/safeUrl.ts`) | `test_security_hardening.py`, `safeUrl.test.ts` |
| AUD-04 | בינונית | ✅ תוקן | הרכב הנוסעים חייב להתאים להצעה (`TRAVELER_MISMATCH`) | `test_booking.py` |
| AUD-05 | בינונית | ✅ תוקן ותועד | hosted checkout נדחה כשאין אפשרות לבדוק מחיר מחדש. התיעוד עודכן | `test_booking.py` |
| AUD-06 | בינונית | ✅ תוקן | grounding: פורמטים אירופיים, מכפילים, מספרים במילים, טענות הזמנה בעברית ובאנגלית | `test_ai_grounding.py` (216 בדיקות AI) |
| AUD-07 | בינונית | ✅ תוקן | הצפנה של notes, accessibility, gender ו-nationality. צופים מקבלים מידע מצומצם | `test_travelers.py` |
| AUD-08 | בינונית | ✅ תוקן | מחיקת משתמש, מחיקת שם בן משפחה מהזמנות, retention לסשנים, הזמנות, התראות ו-snapshots | `test_family.py`, `test_settings.py` |
| AUD-09 | נמוכה | ✅ תוקן | checkout-link הפך ל-POST | `test_booking.py` |
| AUD-10 | נמוכה | ✅ תוקן חלקית | `--no-proxy-headers` בכל סקריפט ובשרת ה-CI. נעילת חשבון אחרי 5 כישלונות נשארת (סיכון DoS משפחתי מתועד) | סקריפטים |
| AUD-11 | נמוכה | ✅ תוקן | `MINOR_CANNOT_BE_ADULT` | `test_family.py` |
| AUD-12 | נמוכה | ✅ תוקן | עריכת בן משפחה עם חשבון מותרת רק לו או לבעלים. מחיקת פרופיל דורשת reauth. נאכפת עקביות בין age_group ל-is_minor | `test_family.py`, `test_travelers.py` |
| AUD-13 | נמוכה | ✅ תוקן | מגבלת גוף הבקשה נאכפת על הבייטים בפועל (ASGI) | `test_security_hardening.py` |
| AUD-14 | נמוכה | ✅ תוקן | TrustedHostMiddleware (`ORI_ALLOWED_HOSTS`) | `test_security_hardening.py` |
| AUD-15 | נמוכה | ✅ תוקן | ה-CSP כולל `tile.openstreetmap.org` | קוד |
| AUD-16 | נמוכה | ✅ תוקן | מדיניות סיסמה: 3 סוגי תווים או משפט סיסמה של 16+, בלי חזרתיות ובלי סיסמאות נפוצות. מסונכרן עם הלקוח | `test_security_hardening.py` |
| AUD-17 | נמוכה | ✅ תוקן | סירוב לעלות ב-production עם הגדרות לא בטוחות. HSTS כש-`cookie_secure` | `test_security_hardening.py` |
| AUD-18 | מידע | התקבל | צופים יכולים לחפש ולהשתמש ב-AI. יש rate limit, וספקים חיים כבויים כברירת מחדל | — |
| AUD-19 | מידע | התקבל | הבעלים רואה חיפושים של אחרים. זה תפקיד ניהולי | — |
| AUD-20 | מידע | ✅ תוקן חלקית | DEMO לא מתמזג עם הצעה אמיתית ב-dedupe | `test_security_hardening.py` |
| AUD-21 | מידע | התקבל | נעילת FX מוגבלת ל-8 שניות, והמסלול כבוי כברירת מחדל | — |
| AUD-22 | מידע | ✅ תוקן | התחברות כבר לא נחשבת אימות חוזר | `test_auth.py`, `test_travelers.py` |
| AUD-23 | מידע | התקבל | רישום אסמכתה ידני הוא החלטה מתועדת | — |
