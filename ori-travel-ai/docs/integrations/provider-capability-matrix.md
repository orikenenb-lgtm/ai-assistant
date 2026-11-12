# מטריצת יכולות ספקים (V6 - אימות חוזר)

תאריך בדיקה אחרון: **2026-11-12 (UTC)**. מחקר בלבד: ללא הרשמות, מפתחות, קריאות בתשלום או יצירת קשר.

> **מגבלת אימות חשובה:** בסשן הזה כל קריאות `WebFetch` לדומיינים הרשמיים נכשלו (`getaddrinfo ENOTFOUND` - הדומיין אינו ברשימת הרשת המותרת של הסשן). רק `WebSearch` עבד, והוא מחזיר תקצירים ולא את דפי התיעוד עצמם. לכן **אף עובדה כאן אינה "VERIFIED against official page"**. המונחים בשימוש:
> - `SEARCH-SNIPPET` - התקציר מאשר, והכתובת הרשמית הופיעה בתוצאות החיפוש (עדיין לא נקראה ישירות).
> - `THIRD-PARTY` - מקור צד שלישי/עיתונות בלבד.
> - `UNVERIFIED` - לא נמצא אישור.

## 1. יומן ניסיונות פתיחה (2026-11-12)

| כתובת | תוצאה |
|---|---|
| `https://duffel.com/docs/api/offer-requests` | נכשל: `getaddrinfo ENOTFOUND duffel.com` |
| `https://duffel.com/docs/api/overview/rate-limits` | נכשל: `getaddrinfo ENOTFOUND duffel.com` |
| `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | נכשל: `getaddrinfo ENOTFOUND www.ecb.europa.eu` |
| `https://docs.viator.com/partner-api/technical/` | נכשל: `getaddrinfo ENOTFOUND docs.viator.com` |
| `https://operations.osmfoundation.org/policies/tiles/` | נכשל: `getaddrinfo ENOTFOUND operations.osmfoundation.org` |
| `https://developers.booking.com/demand/docs/getting-started/prerequisites` | נכשל: `getaddrinfo ENOTFOUND developers.booking.com` |
| `https://developers.expediagroup.com/rapid/lodging/getting-started` | נכשל: `getaddrinfo ENOTFOUND developers.expediagroup.com` |
| `https://developers.amadeus.com/self-service` | נכשל: `getaddrinfo ENOTFOUND developers.amadeus.com` |
| `https://www.boi.org.il/en/economic-roles/financial-markets/exchange-rates/` | נכשל: `getaddrinfo ENOTFOUND www.boi.org.il` |
| `https://www.tiqets.com/en/distributor-api/` | נכשל: `getaddrinfo ENOTFOUND www.tiqets.com` |

הערת תיקון לבעלים: כדי לאפשר אימות אמיתי יש להוסיף להגדרות הרשת של הסשן את הדומיינים `duffel.com`, `docs.viator.com`, `partnerresources.viator.com`, `developers.booking.com`, `developers.expediagroup.com`, `developers.amadeus.com`, `www.ecb.europa.eu`, `www.boi.org.il`, `operations.osmfoundation.org`, `www.tiqets.com`.

חיפושי `WebSearch` שבוצעו (תקצירים בלבד): Duffel test mode / offer requests / pricing, Viator affiliate basic access ו-`/products/search`, Amadeus decommission, Booking Demand prerequisites, Expedia Rapid signature, חלופות (Tiqets/Klook/GetYourGuide/Discover Cars).

## 2. מטריצת ספקים

### 2.1 טיסות ופעילויות (ספקים מיושמים)

| שדה | Duffel (טיסות) | Viator (פעילויות) | Amadeus Self-Service |
|---|---|---|---|
| משתני סביבה | `ORI_DUFFEL_ACCESS_TOKEN` (+ `ORI_LIVE_PROVIDERS_ENABLED`) | `ORI_VIATOR_API_KEY` (+ `ORI_LIVE_PROVIDERS_ENABLED`) | `ORI_AMADEUS_CLIENT_ID`, `ORI_AMADEUS_CLIENT_SECRET` (לא בשימוש) |
| Sandbox | כן: טוקן `duffel_test_...`; הצעות מחברת פיקטיבית "Duffel Airways", מחירים ולוחות זמנים לא ריאליסטיים (`SEARCH-SNIPPET`, `duffel.com/docs/api/overview/test-mode`) | לא ידוע. הקוד מניח `api.sandbox.viator.com` עם מפתח נפרד: `UNVERIFIED` | לא רלוונטי |
| גישת production וזכאות | חילופי טוקן לאחר "go-live checklist"; האם יחיד ללא חברה מתקבל: `UNVERIFIED` (לא נמצא אישור או שלילה) | גישת Basic affiliate מיידית עם יצירת חשבון שותף ואימות אימייל (`SEARCH-SNIPPET`, `partnerresources.viator.com`); דורש חשבון Viator Partner, ייתכן בדיקת אתר/ערוץ: `UNVERIFIED` | נסגר. לפי עיתונות (PhocusWire, פברואר 2026) הפורטל מפורק; נשאר רק Enterprise בחוזה מכירות (`THIRD-PARTY`) |
| חיפוש | `POST /air/offer_requests` ואז `GET /air/offers?offer_request_id=` (`SEARCH-SNIPPET`) | `POST /products/search` עם `filtering.destination` (`SEARCH-SNIPPET`); שאר השדות `UNVERIFIED` | - |
| הצעת מחיר/reprice | `GET /air/offers/{id}` (קיים במימוש; `UNVERIFIED` מול תיעוד) | אין (Basic ללא זמינות בזמן אמת) | - |
| הזמנה | API קיים (orders) אך **לא מומש בכוונה** | לא ב-Basic; רק redirect | - |
| ביטול | קיים ב-API של Duffel; לא מומש | באתר Viator | - |
| Redirect / deep link | אין | `productUrl` עם פרמטרי שותף (`pid`, `mcid`, `medium`), נשמר רק ב-`viator.com` | - |
| מגבלות קצב | קיימת שגיאה `rate_limit_exceeded` וכותרת `ratelimit-reset` (`SEARCH-SNIPPET`, `duffel.com/docs/api/overview/errors`); המספר עצמו `UNVERIFIED` | לפי רמת שותף; Basic ללא `/modified-since` (`SEARCH-SNIPPET`); מספרים `UNVERIFIED` | - |
| עלויות (כל עלות אפשרית) | **כן, סיכון:** עמלת הזמנה ~3$, עמלת שירות נלווה ~2$, Managed Content ~1% (`THIRD-PARTY`, ויש לאמת ב-`duffel.com/pricing`); עמלת חיפוש עודף מעל יחס 1500:1 (~0.005$ לחיפוש) (דף המחירים של Duffel מזכיר את היחס ב-`SEARCH-SNIPPET`; הסכום `THIRD-PARTY`); מקורות לא רשמיים מזכירים גם 99$ לחודש (Duffel Links) - לא אומת. תשלום לספק תעופה עצמו בהזמנה אמיתית | ללא עלות ידועה ל-Basic; עמלה מגיעה אליכם (קומיסיון) | ללא |
| חסמים | טיסות אמיתיות מחייבות הזמנה+תשלום (כרטיס, KYC, אולי ישות עסקית); חיפוש בלי הזמנות מצטבר ל"עודף" | ללא חיפוש זמינות/מחיר ריאלי; צורת API לא אומתה; מזהי יעד לא אומתו | הפורטל נסגר |
| סטטוס מימוש | **MOCK ONLY** (fixtures; אף קריאה אמיתית) | **MOCK ONLY** | **DISCONNECTED** |
| מקורות | `duffel.com/docs/api/overview/test-mode`, `.../offer-requests`, `.../overview/errors`, `duffel.com/pricing` | `partnerresources.viator.com/travel-commerce/affiliate/basic-access/golden-path/`, `docs.viator.com/partner-api/technical` | `phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers`, `skift.com/2026/09/03/amadeus-brings-travel-tech-into-claude/` |
| נבדק לאחרונה | 2026-11-12 (חיפוש בלבד) | 2026-11-12 (חיפוש בלבד) | 2026-11-12 (חיפוש בלבד) |

### 2.2 מלונות (ספקים חסומי שותפות)

| שדה | Booking.com Demand API | Expedia Rapid |
|---|---|---|
| משתני סביבה | `ORI_BOOKING_DEMAND_API_KEY`, `ORI_BOOKING_DEMAND_AFFILIATE_ID` | `ORI_EXPEDIA_RAPID_API_KEY`, `ORI_EXPEDIA_RAPID_SHARED_SECRET` |
| Sandbox | קיים try-out console / סביבת test דרך Partner Centre (`SEARCH-SNIPPET`); פרטים `UNVERIFIED` | host בדיקה ("test host") קיים (`SEARCH-SNIPPET`); כתובת `UNVERIFIED` |
| גישת production וזכאות | חייב להיות Managed Affiliate Partner; Partner Centre מופעל דרך Account Manager לאחר חתימת חוזה (`SEARCH-SNIPPET`, `.../getting-started/prerequisites`). אין הרשמה עצמית ליחיד. סף תנועה/נפח: `UNVERIFIED` | הסכם מסחרי (Rapid, לשעבר EAN) ובדיקת launch requirements (`SEARCH-SNIPPET`/`THIRD-PARTY`); יחיד כנראה לא זכאי: `UNVERIFIED` |
| אימות | `Authorization: Bearer <token>` + כותרת `X-Affiliate-Id` בכל בקשה (`SEARCH-SNIPPET`) | Lodging: `Authorization: EAN APIKey=..,Signature=..,timestamp=..` כש-Signature = SHA-512 של `key+secret+timestamp` (`SEARCH-SNIPPET`). שאר מוצרי Rapid (Car, Flight, Activities, Typeahead) משתמשים ב-OAuth 2.0 |
| חיפוש / quote / הזמנה / ביטול | ב-API: accommodations, orders (modify, cancel), וגם cars (3.1/3.2) (`SEARCH-SNIPPET`); לא מומש | ב-API קיים; לא מומש; ללא דף תשלום מתארח |
| Redirect | affiliate links דרך תוכנית השותפים | אין |
| מגבלות קצב | לפי הסכם: `UNVERIFIED` | לפי הסכם: `UNVERIFIED` |
| עלויות | ללא עלות API ידועה; הכנסה בקומיסיון; הסכם חוזי | כנ"ל; ייתכנו דרישות תפעול/ציות |
| חסמים | חוזה + אישור; 3.2-Beta רק לשותפי פיילוט | הסכם מסחרי, כנראה ישות עסקית |
| סטטוס מימוש | **BLOCKED** (placeholder; `search()` נכשל ב-`PARTNER_APPROVAL_REQUIRED`) | **BLOCKED** (נמצאת רק פונקציית חתימה; לא מחוברת) |
| מקורות | `developers.booking.com/demand/docs/getting-started/prerequisites`, `.../development-guide/authentication` | `developers.expediagroup.com/rapid/lodging/reference/signature-authentication`, `.../rapid/resources/oauth2-authentication` |
| נבדק לאחרונה | 2026-11-12 (חיפוש בלבד) | 2026-11-12 (חיפוש בלבד) |

### 2.3 שערי מטבע ומפות

| רכיב | מה ידוע | סטטוס |
|---|---|---|
| ECB `eurofxref-daily.xml` | הכתובת במימוש (`comparison/fx.py:87`) לא נפתחה; מידע קודם. ללא מפתח; ללא עלות. תנאי שימוש: `UNVERIFIED` | **MOCK ONLY** (fixture `ecb_daily.xml`; ברירת מחדל DEMO) |
| בנק ישראל | לא נפתח. לא מומש. אפשר להשתמש בשער יציג ל-ILS כאימות צולב | לא מומש |
| OSM tiles | מדיניות `operations.osmfoundation.org/policies/tiles/` לא נפתחה. ידוע מניסיון קודם: חובה attribution, User-Agent/Referer מזוהה, אסור שימוש כבד ו-prefetch: `UNVERIFIED` ולבדוק לפני שימוש בייצור | לא נבדק |

### 2.4 חלופות לפעילויות ורכב (מחקר בלבד)

| ספק | מה נמצא | זכאות ליחיד | סטטוס |
|---|---|---|---|
| Tiqets (Distributor API) | API חינם, ללא מינימום ביקורים/הזמנות (`THIRD-PARTY`/דפי Tiqets בתקציר); דורש חתימה על Agreement ו-Terms of Service; קיימים גם affiliate links ללא אינטגרציה | `UNVERIFIED` - חוזה נדרש | לא מומש |
| Klook | רמות: Affiliate (widgets/deep links) ו-Partner API (פלטפורמות מבוססות) (`THIRD-PARTY`) | אפיליאייט אולי; API לא | לא מומש |
| GetYourGuide | Partner API עם access token וקישורי partner ID; אחוז עמלה סותר במקורות (8-10%) | `UNVERIFIED` | לא מומש |
| Discover Cars / Rentalcars | לא נמצאו תוצאות בחיפוש; לא ידוע אם יש API | `UNVERIFIED` | לא נבדק |
| Booking.com Demand - Cars | קיים ב-API (`/cars/...`) אך תחת אותו חוזה Managed Affiliate | חסום כמו מלונות | לא מומש |
| Expedia Rapid Car/Activities | OAuth 2.0 תחת Rapid | חסום כמו מלונות | לא מומש |

## 3. פער מימוש מול תיעוד (סיכום; פירוט ב-`providers.md`, סעיף "אימות חוזר V6")

| # | קובץ:שורה | מימוש | מה נמצא | סטטוס |
|---|---|---|---|---|
| 1 | `viator.py:73-89` | מזהי יעד קבועים (למשל `ROM`=`511`) | לא ניתן לאימות; מקורות מזכירים רשימת יעדים מנקודת קצה taxonomy (`/destinations` או `/taxonomy/destinations` - סתירה בין מקורות) | UNVERIFIED |
| 2 | `viator.py:204-213` | גוף: `filtering{destination,startDate,endDate}`, `sorting{sort:"DEFAULT"}`, `pagination{start,count}`, `currency` | רק `filtering.destination` ומפתחות מיון `ITINERARY_DURATION`/`NEW_ON_VIATOR` הופיעו בתקצירים | UNVERIFIED (חלקי SEARCH-SNIPPET) |
| 3 | `viator.py:92` | רשימת מטבעות מנוחשת, ILS נשלח כ-USD | לא נמצאה רשימה רשמית | UNVERIFIED |
| 4 | `viator.py:61-64` | host sandbox | לא אושר | UNVERIFIED |
| 5 | `viator.py:150-155` | כותרות `exp-api-key`, `Accept: application/json;version=2.0` | מאושר בתקציר golden-path | SEARCH-SNIPPET |
| 6 | `viator.py:153` | `Accept-Language: he` | תמיכה בעברית לא אומתה | UNVERIFIED |
| 7 | `duffel.py:79,259` | `Duffel-Version: v2` | מאושר בתקציר (v2 ברירת מחדל) | SEARCH-SNIPPET |
| 8 | `duffel.py:336` | `return_offers=false` כפרמטר query | מופיע רק בתיעוד ספריית Ruby של צד שלישי | UNVERIFIED |
| 9 | `duffel.py:305` | נוסעים ילדים: `{"age": n}` | לא אומת | UNVERIFIED |
| 10 | `httpclient.py:69-71` | קריאת `ratelimit-reset` | כותרת מופיעה בתקציר שגיאות Duffel | SEARCH-SNIPPET |
| 11 | `duffel_error_422.json` | `code: validation_required` על "departure_date must be in the future" | הקוד נראה לא מתאים (ייתכן `validation_invalid`); fixture שלנו, לא מתעוד | UNVERIFIED (חשד) |
| 12 | `expedia_rapid.py:125-134` | SHA-512 של `key+secret+ts` | מאושר בתקציר | SEARCH-SNIPPET |
| 13 | `expedia_rapid.py:142` | `official_docs_url=.../docs/products/rapid` | כתובות שנמצאו: `.../rapid/setup`, `.../docs/products/rapid/setup/getting-started` | לבדוק |
| 14 | `booking_demand.py` | placeholder | תואם: Bearer + `X-Affiliate-Id` (SEARCH-SNIPPET); הערה: ה-API כולל גם cars | SEARCH-SNIPPET |
| 15 | `amadeus.py:19` | נסגר 17.7.2026 | מאושר ע"י עיתונות (PhocusWire, Skift); התאריך המדויק מצד שלישי; Enterprise נשאר | THIRD-PARTY |
| 16 | `fx.py:87` | כתובת ECB | לא נפתחה | UNVERIFIED |

## 4. פעולות לבעלים (owner actions)

| פעולה | עלות אפשרית | הערה |
|---|---|---|
| לאפשר דומיינים רשמיים בהגדרות הרשת של הסשן ולהריץ אימות חוזר | ללא | פותח את חסם האימות |
| לפתוח חשבון Duffel (sandbox) ולייצר `duffel_test_...` | ללא (test mode) | לא להעביר לטוקן חי |
| לפני טוקן חי: לקרוא `duffel.com/pricing` ותנאי go-live ולוודא זכאות ליחיד | עמלות הזמנה/שירות/חיפוש עודף; כרטיס/KYC | אל תפעילו בלי החלטה מפורשת |
| ליצור חשבון Viator Partner (affiliate) ולייצר מפתח Basic | ללא (לפי מקורות) | לוודא שתנאי השותפות מתירים שימוש פרטי-משפחתי ושמירת מחירים במטמון |
| לאמת מזהי יעד ב-Viator מול נקודת ה-destinations הרשמית | ללא | חובה לפני הצגת תוצאות |
| לבדוק מדיניות OSM tiles ו-attribution | ללא (אולי שרת אריחים בתשלום אם נפח גבוה) | |
| לפנות ל-Tiqets/Klook/GetYourGuide רק אם יש בעיית זכאות | ללא עלות ידועה | לא בוצעה פנייה |
| Booking/Expedia: לא לפעול כל עוד אין ישות/אתר שמצדיקים חוזה שותפות | חוזה, ציות | נשאר BLOCKED |

## 5. חלופות אם שימוש משפחתי פרטי פוסל גישת שותפים

עבודה בכפוף לתנאי הספקים, ללא עקיפה:

1. **קישורי יציאה (outbound links)** לחיפוש באתרי הספקים (Booking, Expedia, Skyscanner, Google Flights, Viator) ללא API. אין לגרד תוצאות.
2. **הזנה ידנית (manual entry)** של הצעות, מחירים ותאריכים שהמשפחה מצאה, עם שדה מקור וזמן.
3. **Duffel test mode** לפיתוח ולבדיקת זרימה בלבד (נתונים פיקטיביים).
4. **ייבוא קבצים** (אישורי הזמנה במייל/PDF) להצגה במסלול.
5. **קישורי affiliate פשוטים** (ללא API) רק אם תנאי הספק מתירים ללא ישות עסקית.


## עדכון 2026-11-12: Duffel ‏— SANDBOX VERIFIED

* **חיבור אמיתי לסביבת הבדיקה של Duffel.** הטוקן נשמר כסוד רשת בסביבת הענן: ה-proxy מזריק אותו, הוא לא נמצא בקוד או בלוגים, ולא נחשף לסוכן.
* **בדיקות שבוצעו:**
  * בדיקת אימות: `GET /air/airlines` החזיר 200.
  * חיפוש אחד מורשה TLV→ATH: `POST /air/offer_requests` החזיר 201, ו-`GET /air/offers` החזיר 200.
  * חיפוש אימות שני, אחרי השינויים בקוד, החזיר את אותן תוצאות.
* **מקור התוצאות נבדק:** מזהי הצעות `off_…`, חברות התעופה הן נתוני בדיקה (Duffel Airways ועוד), המטבע USD, ובכל ההצעות `live_mode=false`. הערך נקרא ישירות מ-Duffel בבקשת GET נפרדת.
* **מצב נתונים חדש, `SANDBOX`:**
  * הצעה מסומנת `SANDBOX` לפי שדה `live_mode` שבהצעה עצמה, ולא לפי קידומת הטוקן. הקידומת משמשת רק כגיבוי כשהשדה חסר.
  * בממשק מוצג תג "בדיקה (Sandbox)".
  * הצעות SANDBOX לא נספרות כתוצאות חיות, לא מתמזגות עם הצעות אמיתיות או DEMO, מדורגות אחרי כל השאר, ולא ניתנות להזמנה (שגיאה 409 עם `SANDBOX_OFFER`, ובממשק אין כפתור הזמנה).
* **מה עוד לא אומת:** מצב חי (`duffel_live_`). הוא נשאר חסום עד `allow_live_mode=true` מפורש.
