# ספקי נתונים ל-Ori Travel AI: מחקר היתכנות

## מטרה ושיטה

**תאריך המחקר:** 2026-11-12.

המטרה: לבדוק אילו ספקי טיסות, מלונות, רכבים, אטרקציות, שערי מטבע ומפות אפשר באמת להשתמש בהם באפליקציה משפחתית פרטית, לא מסחרית, שנבנית על ידי מפתח יחיד בישראל, בלי חברה רשומה.

**מדיניות מקורות:**

- המחקר בוצע בחיפוש רשת בלבד. כלי ה-fetch הישיר נחסם לדומיינים הרשמיים (`duffel.com`, `amadeus.com`, `developers.booking.com` וכו' לא נפתרו מהסביבה), ולכן **לא נקראו דפי התיעוד המלאים**. הנתונים מבוססים על תקצירי תוצאות חיפוש של דפים רשמיים, ועל מקורות צד שלישי כשצוין.
- כל פריט מסומן: **[רשמי]** (תקציר חיפוש של דף רשמי), **[צד ג']** (בלוג, אגרגטור, ספק מתחרה, ולכן עלול להיות מוטה או מיושן), או **[ידע קודם]** (ידע כללי של הכותב, לא אומת בסשן הזה).
- "לא אומת" פירושו שלא נמצא מקור אמין. אין להשתמש בפריטים כאלה בלי בדיקה ידנית.
- לא נרשמנו לשום שירות, לא נעשה שימוש בהרשאות, ולא נוצר קשר עם אף גורם.

## טבלת סיכום

| ספק | קטגוריה | גישה | Sandbox | יכולת הזמנה | פסק דין |
|---|---|---|---|---|---|
| Duffel | טיסות | חשבון self-serve ל-test; Live דורש הפעלה + פרטי עסק | כן (test token, Duffel Airways) | חיפוש, מחיר, הזמנה | צהוב (הכי ריאלי לטיסות; Live לא ודאי ליחיד) |
| Amadeus Self-Service | טיסות/מלונות | **נסגר 2026-07-17** | לא זמין | לא רלוונטי | אדום (לא להשתמש) |
| Booking.com Demand API | מלונות, רכבים | רק Managed Affiliate Partner + חוזה | יש sandbox (לרכבים: אין) | חיפוש, זמינות, הזמנה | אדום (לא נגיש בלי חוזה) |
| Expedia Rapid | מלונות (רכבים בטא) | שותפות עסקית + הסכם מסחרי | host בדיקות `test.ean.com` | חיפוש, מחיר, הזמנה | אדום |
| Viator Partner API | פעילויות | Basic affiliate: self-serve; Full/Booking: אישור | sandbox קיים | Basic: חיפוש + קישור affiliate | ירוק-צהוב (Basic affiliate מתאים) |
| רכבים (כללי) | רכבים | דרך Booking/Expedia בלבד (שניהם חסומים) | חלקי | תלוי | אדום; פתרון: deep link בלבד |
| GetYourGuide | אטרקציות | סף תנועה 100K ביקורים/חודש | לא אומת | - | אדום |
| Tiqets | אטרקציות | Distributor: ללא מינימום מוצהר + סקירה | לא אומת | כן | צהוב |
| Klook | אטרקציות | affiliate דרך רשתות; API לא ברור | לא אומת | - | צהוב-אדום (affiliate links בלבד) |
| ECB | שערים | ציבורי | - | - | ירוק |
| Bank of Israel | שערים | ציבורי | - | - | ירוק-צהוב (endpoint לא יציב/לא אומת) |
| OpenStreetMap tiles | מפות | ציבורי, עם מדיניות שימוש | - | - | ירוק לשימוש קל |

## Duffel (טיסות)

**קישורים רשמיים:**

- תיעוד: [offer requests](https://duffel.com/docs/api/v2/offer-requests), [offers](https://duffel.com/docs/api/v2/offers), [orders](https://duffel.com/docs/api/orders), [test mode](https://duffel.com/docs/api/overview/test-mode), [errors](https://duffel.com/docs/api/overview/errors)
- [Pricing](https://duffel.com/pricing), [Services agreement](https://duffel.com/services-agreement), [Getting started](https://duffel.com/guides/getting-started)
- Help: [איך עוברים ל-live](https://help.duffel.com/hc/en-gb/articles/360019685579-How-do-I-go-live-once-I-ve-built-my-integration), [למה נדרש מידע עסקי](https://help.duffel.com/hc/en-gb/articles/360019685959-Why-do-I-have-to-provide-business-information-when-activating-my-account)

**גישה:**

- Base URL `https://api.duffel.com`, כותרות `Authorization: Bearer <token>` ו-`Duffel-Version: v2` [רשמי, לפי תוצאות חיפוש].
- Test mode: טוקנים עם קידומת `duffel_test_`, נוצרים בדשבורד במצב "Developer test mode". טוקן test ניגש רק למשאבי test [רשמי].
- Live: נדרשת הפעלת חשבון (Activation). Duffel אוספת מידע על האדם ועל העסק כדי לעמוד בדרישות רגולטורים ושותפים פיננסיים [רשמי]. **לא אומת** האם אדם פרטי בלי חברה רשומה מקבל Live. דרוש בירור מול Duffel.
- ייתכן שהמוצר Payment Intents לא פתוח ללקוחות חדשים [רשמי, לפי תוצאות חיפוש]. תשלום באמצעות Duffel balance (העברה בנקאית) הוא החלופה.

**Sandbox:** כן. חברת התעופה הבדיקתית "Duffel Airways" מופיעה בתוצאות test, בלי לוחות זמנים או מחירים ריאליים. כרטיסי בדיקה מסופקים [רשמי].

**מודל מסחרי** (לא אומת מול דף התמחור עצמו, הסכומים מאגרגטורים כמו [fitgap](https://us.fitgap.com/products/010868/duffel) ו-[apis.io](https://apis.io/plans/duffel/duffel-plans-pricing/)):

- דמי הזמנה מאושרת: כ-3 דולר להזמנה (חיוב חודשי). דף התמחור הרשמי מאשר את קיום העמלה אך הסכום לא נראה בתקציר.
- אביזרים בתשלום: כ-2 דולר; Managed content: כ-1% משווי ההזמנה.
- חיפושים חופשיים עד יחס 1500:1 חיפוש להזמנה; מעבר לכך "Excess search" (כ-0.005 דולר לחיפוש [צד ג']) [רשמי לגבי היחס, [Help](https://help.duffel.com/hc/en-gb/articles/4412912264466-What-is-Excess-Search)].
- **סיכון עלות:** אפליקציה משפחתית עם חיפושים רבים ואפס הזמנות תחצה את יחס 1500:1. יש להגביל חיפושים (cache קצר, debounce).

**תהליך:** `POST /air/offer_requests` ואז offers, ואז `POST /air/orders`. לפני תשלום יש לרענן עם "Get a single offer"; הרשימה לא מחזירה מידע מלא ועדכני [רשמי](https://help.duffel.com/hc/en-gb/articles/360021052540-Why-should-I-refresh-offers-during-the-search-and-book-flow). לכל offer יש `expires_at`; משך התוקף המדויק לא אומת (מקור צד ג' אומר 15 עד 30 דקות). offer שפג דורש חיפוש חדש [רשמי](https://help.duffel.com/hc/en-gb/articles/360021052820-What-happens-when-an-offer-expires). שגיאת `price_changed` מחייבת שליפה מחדש.

**Rate limits:** שגיאה `rate_limit_exceeded` עם כותרת `ratelimit-reset` [רשמי](https://duffel.com/docs/api/overview/errors). מספר הבקשות המותר: **לא אומת**.

**Duffel Links / checkout מתארח:** לא נמצא מידע. **לא אומת**.

**משתנה סביבה:** `ORI_DUFFEL_ACCESS_TOKEN`.

**פסק דין: צהוב.** לחיפוש ולמחירי test הכי נגיש בשוק. לשימוש אמיתי (הזמנה) נדרשת הפעלת Live שדורשת פרטי עסק ופיננסים. מומלץ: להתחיל ב-test, ולברר מול Duffel אם אדם פרטי יכול להפעיל. אם לא: מציגים תוצאות ומפנים להזמנה אצל חברת התעופה (ללא הזמנה מתוך האפליקציה).

## Amadeus Self-Service (טיסות ומלונות)

**סטטוס: נסגר. אל להשתמש.**

- Amadeus הודיעה בפברואר 2026 על סגירת החלק Self-Service של Amadeus for Developers, השהיית הרשמות חדשות, ו**ביטול מפתחות והשבתת הפורטל ב-17 ביולי 2026** ([PhocusWire](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers), [מסמך הצהרה של Amadeus](https://amadeus.com/en/industry-messaging/statement-regarding-amadeus-for-developers-portal)).
- דובר Amadeus: "We are decommissioning only the self-service section"; פורטל Enterprise ממשיך ודורש חוזה מכירות [צד ג', ציטוט דרך חיפוש].
- ארגון ה-GitHub `amadeus4dev` סומן כארכיון ב-17.7.2026 [צד ג'](https://github.com/amadeus4dev); פוסט של 1.11.2026 מדווח שהמארח הישן של ה-test ללא DNS [צד ג', [Medium](https://medium.com/@apihiver/amadeus-closed-its-free-api-portal-here-is-what-you-can-actually-use-instead-cda56b4396c5)].
- **לא אומת מדף רשמי** (העמוד הרשמי לא נקרא ישירות): התאריך 17.7 נשען על מכתב פברואר המצוטט בתקשורת ועל מקורות משניים שמאשרים שהסגירה בוצעה. [Skift, ספטמבר 2026](https://skift.com/2026/09/03/amadeus-brings-travel-tech-into-claude/) מציין שתנאי Enterprise ותמחורו לא הובהרו.
- מדריכי ההגירה של [AirLabs](https://airlabs.co/amadeus-self-service-api-shutdown) ו-[Ignav](https://ignav.com/docs/amadeus-self-service-shutdown) הם של ספקים מתחרים (אינטרס מסחרי).

משתני `ORI_AMADEUS_CLIENT_ID` / `ORI_AMADEUS_CLIENT_SECRET` שהוגדרו מראש **אינם רלוונטיים ואין ליישם adapter**. מומלץ להסיר אותם מהתכנון.

**פסק דין: אדום.**

## Booking.com Demand API (מלונות, רכבים, אטרקציות)

**קישורים:** [Prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites), [Try the API](https://developers.booking.com/demand/docs/getting-started/try-out-the-api), [Authentication](https://developers.booking.com/demand/docs/development-guide/authentication), [Reference 3.1](https://developers.booking.com/demand/docs/open-api/3.1/demand-api).

- **גישה:** נדרשת הרשמה כ-**Managed Affiliate Partner**, גישה ל-Partner Centre שניתנת על ידי Account Manager **לאחר חתימה על חוזה**, ויצירת API key ו-`X-Affiliate-Id` [רשמי]. אין הרשמה עצמית [צד ג', [Vorp Labs](https://vorplabs.com/agent-tools/booking-demand-api)]. אחד המקורות מזכיר דרישת אישור בכתב לשימוש ב-AI (צד ג', לא אומת).
- **Auth:** `Authorization: Bearer <token>` ו-`X-Affiliate-Id: <id>` [רשמי].
- **Sandbox:** `https://demandapi-sandbox.booking.com/3.1`. לרכבים אין sandbox ייעודי [רשמי, [cars migration](https://developers.booking.com/demand/docs/cars/cars-migration-guide)].
- **Endpoints:** `POST /accommodations/search`, bulk availability, `POST /cars/search`, `/cars/depots`; ב-3.2 נוסף `POST /attractions/search` (חלק מ-3.2-Beta רק לשותפי פיילוט) [רשמי].
- **כיסוי רכבים:** לא כל הרכבים באתר זמינים דרך ה-API [רשמי].
- **תנאי caching/הצגה:** **לא אומת.** חייבים לקרוא את הסכם השותפות.
- **משתנים:** `ORI_BOOKING_DEMAND_API_KEY`, `ORI_BOOKING_DEMAND_AFFILIATE_ID`.

**פסק דין: אדום.** דורש חוזה עם Booking.com; מפתח פרטי ללא עסק לא צפוי להתקבל. חלופה: קישור חיפוש רגיל לאתר (deep link) ללא API, ללא נתוני מחיר.

## Expedia Group Rapid API (מלונות; רכבים בטא)

**קישורים:** [Get started](https://developers.expediagroup.com/docs/products/rapid/setup/getting-started), [Signature authentication](https://developers.expediagroup.com/rapid/lodging/reference/signature-authentication), [Rapid Car API beta](https://developers.expediagroup.com/rapid/cars).

- **גישה:** מפתח API ניתן רק לאחר שהופכים לשותפים ומאושרים ל-Rapid; נדרש הסכם מסחרי ודרך Expedia Partner Solutions. מפתחות נשארים במצב פיתוח מוגבל עד סקירת האתר לפני production [רשמי + צד ג'].
- **Auth:** חתימה = SHA-512 של `apiKey + sharedSecret + unixTimestamp(sec)`; כותרת Authorization (הפורמט המדויק `EAN APIKey=...,Signature=...,timestamp=...` הוא [ידע קודם]). חלון זמן של כ-5 דקות [צד ג'].
- **סביבות:** `https://test.ean.com` לבדיקות, `https://api.ean.com` ל-production; מפתח פיתוח לא יאושר ב-production [רשמי].
- **Endpoints:** property availability (shopping), price check, booking. שמות הנתיבים המדויקים לא אומתו.
- **תנאי תוכן ו-caching:** לא אומת.
- **משתנים:** `ORI_EXPEDIA_RAPID_API_KEY`, `ORI_EXPEDIA_RAPID_SHARED_SECRET`.

**פסק דין: אדום.** חוזה עסקי נדרש.

## Viator Partner API (פעילויות)

**קישורים:** [Partner API docs](https://docs.viator.com/partner-api/), [Technical](https://docs.viator.com/partner-api/technical/), [Affiliate](https://partnerresources.viator.com/travel-commerce/affiliate/), [Basic access golden path](https://partnerresources.viator.com/travel-commerce/affiliate/basic-access/golden-path/).

- **רמות גישה** [רשמי]: Basic access, Full access, Full + Booking, Merchant. Basic לא כולל `/availability/check` בזמן אמת. Booking ותשלום דורשים Full + Booking או Merchant.
- **עלות:** "no costs to sign up and no costs to get additional API access" [רשמי]. עמלה על הזמנות בתוך 30 יום מהקליק. אחוז העמלה **לא אומת**.
- **Basic self-serve:** מקור צד ג' טוען ש-Basic ניתן מיד; מקור רשמי אחד אומר שמפתחות מונפקים דרך מנהל חשבון. **סתירה, לא אומת.**
- **Auth:** כותרת `exp-api-key` [רשמי]. Sandbox: `https://api.sandbox.viator.com/partner`; Production `https://api.viator.com/partner`.
- **חיפוש:** `POST /products/search` [רשמי]. גרסת v2 היא העיקרית (header `Accept: application/json;version=2.0`, [ידע קודם]).
- **קישורי affiliate:** ה-API מחזיר `productUrl` עם פרמטרי מעקב [ידע קודם]; פורמט `pid`/`mcid` לא אומת.
- **משתנה:** `ORI_VIATOR_API_KEY`.

**פסק דין: צהוב-ירוק.** אם Basic affiliate ניתן לאדם פרטי, זה המסלול הריאלי היחיד לפעילויות עם נתונים אמיתיים.

## רכבים

- **Booking.com Demand API** (cars search/depots/details) ו-**Expedia Rapid Car API** (בטא) קיימים אך שניהם דורשים חוזה שותפות. ראו לעיל.
- **CarTrawler, Discover Cars, Rentalcars:** לא נמצא מידע רשמי על גישת API למפתח קטן. Rentalcars הוחלף ב-Booking.com ואישורי ה-XML הישנים לא תקפים ב-Demand API [רשמי]. **לא אומת** עבור CarTrawler ו-Discover Cars.
- סקרייפינג: אסור (ראו אזהרות).

**פסק דין: אדום ל-API.** בשלב הראשון: קישורי חיפוש חיצוניים (deep link לאתרי השוואה) ללא מחירים באפליקציה, או הזנה ידנית של הצעות מחיר על ידי המשפחה.

## אטרקציות: חלופות

- **GetYourGuide:** Basic דורש כ-100,000 ביקורים חודשיים באתר או 50,000 הורדות, וצוות טכני [רשמי, [תמיכה](https://partner.getyourguide.support/hc/en-us/articles/13981133907613-API-integration-and-requirements)]. מגבלת 130 קריאות לדקה; אסור scrape/cache [רשמי]. **אדום.**
- **Tiqets:** תוכנית Distributor/affiliate בלי מינימום מוצהר של תנועה [רשמי, [partner program](https://www.tiqets.com/en/partner-program/)]; ה-API חינמי, אך סקירה לפני השקה (שבועיים עד כמה חודשים) ותנאים שמגבילים שימוש ללקוחות קצה [צד ג'/רשמי חלקי]. **צהוב.**
- **Klook:** affiliate דרך רשתות (Travelpayouts, Involve Asia וכו'); API למפתח קטן לא אומת. **צהוב-אדום.**

## FX: שערי מטבע

**ECB:**

- [עמוד שערי הייחוס](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html): כ-30 מטבעות, מתעדכן סביב 16:00 CET בימי עבודה (למעט TARGET), "for information purposes only", שימוש לעסקאות לא מומלץ. ILS כלול ([עמוד ILS](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-ils.en.html)). [מסגרת השערים](https://www.ecb.europa.eu/stats/pdf/exchange/Frameworkfortheeuroforeignexchangereferencerates.en.pdf).
- קובץ XML יומי: `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, ו-SDMX: `https://data-api.ecb.europa.eu/service/data/EXR/D.ILS.EUR.SP00.A?format=jsondata` [ידע קודם, **לא אומת** בסשן].
- תנאי שימוש/רישוי: **לא אומת**; לשמור ייחוס "Source: ECB" ולבדוק את הודעת ה-copyright.
- השער הוא EUR/ILS בלבד; המרה בין מטבעות אחרים ל-ILS דורשת חישוב צולב ולא מדויק לעסקאות.

**בנק ישראל:**

- [שערי חליפין](https://boi.org.il/en/economic-roles/statistics/foreign-exchange-market/exchange-rates/), [הערות הסבר](https://boi.org.il/en/economic-roles/financial-markets/explanatory-notes-to-the-representative-exchange-rates/): השער היציג הוא אינדיקטור ללא מעמד מחייב בחוק [רשמי]; מתפרסם בימי עסקים.
- נקודות קצה: `https://boi.org.il/PublicApi/GetExchangeRates` (JSON) [צד ג'], ו-SDMX תחת `edge.boi.org.il/FusionEdgeServer/sdmx/v2/...` ([PDF רשמי](https://www.boi.org.il/media/upqgqpuv/extracting-representative-exchange-rates-from-the-new-series-database.pdf)); קיימת בלבול בין `edge.boi.gov.il` ל-`edge.boi.org.il` [צד ג']. **יש לבדוק ידנית לפני יישום, ויש לצפות לשינויים.**
- תנאי שימוש: **לא אומת**.
- המלצה: ECB כמקור ראשי עם חותמת זמן ו-fallback לבנק ישראל. להציג תמיד "שער אינפורמטיבי, תאריך X".

## מפות

- [מדיניות אריחי OSM](https://operations.osmfoundation.org/policies/tiles/) (תקציר חיפוש בלבד, הטקסט המלא לא נקרא): חלה על `tile.openstreetmap.org`; שימוש כבד אסור וחסימה אפשרית; Referer נדרש [צד ג'/רשמי חלקי]; caching דרך proxy מוגבל. דרישות ייחוס מדויקות וכותרת User-Agent: **לא אומתו**, אך הנוהג הידוע הוא ייחוס "© OpenStreetMap contributors" [ידע קודם].
- שימוש אישי קל של משפחה בדרך כלל מתיישב עם המדיניות, אך אין התחייבות לזמינות. כדאי לתכנן חלופה (ספק אריחים אחר) אם יגדל השימוש.

## מה צריך מבעל החשבון (Checklist)

| ספק | מה נדרש | עלות אפשרית |
|---|---|---|
| Duffel | חשבון; test token (חינם). ל-Live: הפעלת חשבון + פרטי אדם/עסק; מימון יתרה | דמי הזמנה (כ-3$), עמלת Excess search, הפקדת יתרה לכרטיסים אמיתיים |
| Amadeus | אין מה לעשות | לא רלוונטי; Enterprise דורש חוזה (עלות לא ידועה) |
| Booking.com | בקשה לשותפות Managed Affiliate + חוזה + Account Manager | לא אומת |
| Expedia Rapid | הסכם מסחרי עם EPS, סקירת אתר | לא אומת |
| Viator | הרשמה כ-affiliate; בקשת Basic API key | חינם להרשמה [רשמי]; אין עלות |
| Tiqets | הרשמה כ-distributor; סקירה | API חינמי [צד ג'] |
| ECB / BOI / OSM | כלום | אין |

לכל המפתחות: לשמור ב-`.env` מקומי בלבד, לא ב-git, ולא בקוד לקוח. ביום ההרשמה יש לוודא מה מותר לשימוש לא מסחרי ולאדם מתחת לגיל 18 (חלק מהחוזים דורשים בגיר או ישות משפטית; **לא אומת**, ויש לבדוק).

## אזהרות ומגבלות

- אין כיסוי אוניברסלי: אף ספק לא מכסה את כל חברות התעופה, המלונות או הרכבים. תוצאות חלקיות חייבות להיות מסומנות כך בממשק.
- Duffel בפרט לא מכסה את כל החברות (למשל לא ידוע לגבי low-cost; **לא אומת**).
- לעולם לא לעשות scraping, ולא לעקוף captcha או תנאי שימוש. זה כולל שירותי scraping מסחריים לאתרי Google/Booking.
- לא לשמור במטמון מחירי ספק מעבר למותר בתנאי הספק (GetYourGuide אוסר cache). מחירים הם אינדיקטיביים עד price re-check.
- לא להציג מחיר ישן כסופי. offers פגים.
- כל מקור צד ג' במסמך הזה עלול להיות מיושן; לאמת מול התיעוד הרשמי לפני יישום.

## מצב מימוש (B6)

תאריך: 2026-11-12. כל ההתנהגות מול HTTP נבדקה **רק מול תשובות מדומות** (`httpx.MockTransport` עם קובצי דוגמה תחת `apps/api/tests/fixtures/live/`). לא בוצעה אף קריאה אמיתית לאף ספק (אין מפתחות, והסביבה חסומה). צורות הבקשה/התשובה מבוססות על `provider-api-notes.md` ועל ידע קודם, ולכן **חובה** לבצע בדיקת עשן אחת מול חשבון בדיקה אמיתי לפני הסתמכות.

### כללים משותפים לכל מתאם חי

- כבוי כברירת מחדל: פעיל רק כש-`ORI_LIVE_PROVIDERS_ENABLED=true` **וגם** קיימים פרטי הגישה. אחרת: "לא מחובר", ואפס בקשות רשת (נבדק).
- כתובות בסיס קבועות בקוד ב-`https://` בלבד (אין כתובת שנשלטת על ידי משתמש, אין מעקב אחרי redirect), מזהי הצעה מאומתים לפני שהם נכנסים לנתיב.
- גודל תשובה מוגבל ל-8MB; JSON שגוי/חריג נכשל בהודעה בעברית; טקסט ספק עובר ניקוי (תגיות HTML, תווי בקרה); קישורים נבדקים מול רשימת הדומיינים המאושרת.
- מפתחות לא נכתבים ללוג או להודעות שגיאה (נבדק עם `caplog`).
- 401 מוצג כ"לא מחובר", 429 כ"הספק הגביל זמנית" (כולל זמן ההמתנה מכותרת `ratelimit-reset` / `Retry-After`), 5xx ו-timeout כשגיאה זמנית שנוסה שוב פעם אחת על ידי מנגנון החיפוש.
- קבצים: `apps/api/app/modules/providers/live/` (`httpclient.py` משותף, `duffel.py`, `viator.py`, `amadeus.py`, `booking_demand.py`, `expedia_rapid.py`) ו-`apps/api/app/modules/comparison/fx.py`.

### Duffel (טיסות) - מתאם מלא (ללא הזמנה)

- **הפעלה:** `ORI_LIVE_PROVIDERS_ENABLED=true` + `ORI_DUFFEL_ACCESS_TOKEN=duffel_test_...` (טוקן בדיקה בלבד מומלץ).
- **מה נעשה:** `POST /air/offer_requests?return_offers=false` (קטעי טיסה, נוסעים לפי גיל, מחלקה, `max_connections` כש-`max_stops` ≤ 2) ואז `GET /air/offers?offer_request_id=...&sort=total_amount&limit=50`. נרמול מלא: קטעים, שעות מקומיות (מתווסף אזור הזמן של שדה התעופה, כי Duffel מחזירה שעה מקומית בלי היסט), משכי ISO-8601, עצירות וזמני המתנה, מחלקה ומותג תעריף, מטען של הבוגר, תנאי ביטול/שינוי וקנס, `expires_at`. המחיר הכולל הוא של הספק; פירוט לא עקבי מסומן `estimated` ואזהרה.
- **בדיקה חוזרת:** `GET /air/offers/{id}`: 404 או `expires_at` שעבר = `expired`; הבדל בסכום/מטבע = `price_changed`; אחרת `unchanged`.
- **הזמנה:** לא קיימת. אין קישור הזמנה (`deep_link=None`), `live_api_booking=False`, והוראה בעברית שהזמנה דרך Duffel מצריכה אינטגרציה נפרדת ומאושרת.
- **בדיקת תקינות:** `GET /air/airlines?limit=1` (רק כשמוגדר).
- **טוקן בדיקה:** ההצעות מסומנות "מצב בדיקה של Duffel — חברת תעופה בדיונית" + אזהרה בכל הצעה.
- **טוקן חי (`duffel_live_...`) חסום כברירת מחדל**; להפעלה צריך גם להגדיר בהגדרות הספק `allow_live_mode=true` (החלטה מכוונת מעבר לדרישה, בגלל סיכון חיוב).
- **הגנת עלות (חשוב):** לפי הערכות צד ג' Duffel עשויה לחייב על חיפושים מעל יחס חיפוש:הזמנה של כ-1500:1 (כ-0.005$ לחיפוש; **לא אומת**), ובלי הזמנות כל חיפוש הוא "עודף". לכן יש מונה חיפושים יומי **בזיכרון התהליך** (`daily_search_cap`, ברירת מחדל 50, מתאפס בחצות UTC ובהפעלה מחדש; ריבוי workers מכפיל את התקרה). חיפוש כושל נספר. `flex_days` מתעלמים ממנו (חיפוש אחד בלבד) כדי לא להכפיל חיפושים. בנוסף נשארת מטמון תוצאות רגיל של מנגנון החיפוש. אין polling אוטומטי.
- **הגדרות ספק (ללא סודות):** `max_results` (1-50), `daily_search_cap` (1-500), `allow_live_mode`.
- **לא אומת מול ה-API האמיתי:** צורת גוף הבקשה (`age` לילדים), שמות שדות התשובה (`slices[].segments[].passengers[].baggages`, `conditions.*`, `payment_requirements`), פורמט `ratelimit-reset` (נתמכים גם שניות וגם HTTP-date), וכותרת `Duffel-Version: v2`.

### Viator (פעילויות) - חיפוש affiliate בסיסי

- **הפעלה:** `ORI_LIVE_PROVIDERS_ENABLED=true` + `ORI_VIATOR_API_KEY=<מפתח Basic>`. הגדרות ספק: `environment` (`production`/`sandbox`; מפתח sandbox שונה), `language` (`he`/`en`, ברירת מחדל `en-US`), `max_results`.
- **מה נעשה:** `POST /products/search` עם `exp-api-key`, `Accept: application/json;version=2.0`, `Accept-Language`; סינון לפי יעד ותאריכים. המחיר הוא "החל מ" × מספר המשתתפים, תמיד `total_status="estimated"` עם אזהרה מפורשת שאין זמינות בזמן אמת בגישת Basic. `productUrl` נשמר רק אם הוא https בדומיין `viator.com`; אחרת נמחק עם אזהרה. אין הזמנה: `booking_options` מחזיר רק את קישור השותפים. אין revalidate.
- **טבלת יעדים סטטית (לא אומתה!):** רק 15 ערים (רומא, פריז, לונדון, ברצלונה, אתונה, פראג, אמסטרדם, וינה, בודפשט, איסטנבול, ניו יורק, מדריד, ליסבון, ברלין, דובאי) שמזהי Viator שלהן נלקחו מידע קודם ולא מ-`GET /destinations` הרשמי. מזהה שגוי יחזיר פעילויות של עיר אחרת, ולכן כל הצעה נושאת אזהרה. יעד שאינו בטבלה = "לא נתמך". **משימה לבעלים:** לאמת את המזהים מול תיעוד/`/destinations` לפני שימוש.
- מטבעות: נשלח המטבע המבוקש רק אם הוא ברשימה (USD, EUR, GBP, AUD, CAD, CHF, JPY, SEK, NOK, DKK; **רשימה לא מאומתת**), אחרת USD (ILS לא ברשימה).
- **לא אומת:** צורת הבקשה והתשובה, מגבלות קצב של Basic, האם Basic מתקבל מיידית, ומה מותר לשמור במטמון.
- עלות: אין (לפי המחקר ההרשמה וה-API חינמיים).

### Amadeus Self-Service - הופסק

`is_configured()` תמיד False, גם אם מוגדרים `ORI_AMADEUS_CLIENT_ID/SECRET`. אין קריאות רשת. הסטטוס "לא מחובר" והסבר בעברית: לפי דיווחים (מקורות צד שלישי בלבד, ראו `provider-api-notes.md` §2) הפורטל נסגר ב-17.7.2026. נשאר ברשימה רק כדי להסביר.

### Booking.com Demand ו-Expedia Rapid - לא פעילים (דרוש אישור שותף)

- שניהם דורשים חוזה שותפות (Booking: Managed Affiliate Partner; Expedia: הסכם מסחרי וסקירת אתר) ואין הרשמה עצמית.
- משתני סביבה עתידיים: `ORI_BOOKING_DEMAND_API_KEY` + `ORI_BOOKING_DEMAND_AFFILIATE_ID`; `ORI_EXPEDIA_RAPID_API_KEY` + `ORI_EXPEDIA_RAPID_SHARED_SECRET`.
- גם עם מפתחות והפעלה מפורשת, `search()` נכשל ב"נדרש אישור שותף — המתאם יושלם לאחר קבלת גישה" ללא שום קריאת רשת: **לא הומצא פורמט בקשה** שלא ניתן לאמת.
- ב-Expedia מומשה ונבדקה רק פונקציית החתימה המתועדת (`expedia_signature`: SHA-512 של `apiKey+secret+timestamp`), בלי חיבור לבקשות.

### שערי מטבע ECB (תצוגה בלבד)

- **הפעלה:** `ORI_FX_LIVE_ENABLED=true` (timeout: `ORI_FX_TIMEOUT_SECONDS`, ברירת מחדל 8). ברירת המחדל נשארת טבלת DEMO.
- מושך את `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (**כתובת מידע קודם, לא אומתה**), מגבלת 64KB, דוחה DOCTYPE/ENTITY, מטמון 6 שעות (כישלון נשמר 5 דקות כדי לא להיתקע על timeout בכל בקשה). שערי חצייה דרך EUR, מסומן `LIVE`, מקור "European Central Bank reference rates", `as_of` = תאריך ה-XML. בכל כשל או במטבע שה-ECB אינו מפרסם (AED, GEL): חוזרים לטבלת DEMO עם תווית ואזהרה בעברית. **לא משמש לדירוג.**
- `GET /api/fx/rates` מחזיר כעת גם שדה `warning` (ריק בדרך כלל).
- תנאי הרישיון/שימוש של ה-ECB: לא אומתו.

### סיכוני עלות ותנאים לבעלים

1. **Duffel:** חיפושים בלי הזמנות עלולים להיות מחויבים; השאירו את `daily_search_cap` נמוך, אל תפעילו מעקב מחירים אוטומטי על Duffel, ואל תעברו לטוקן חי בלי בדיקת מחירון ותנאי שירות (וזכאות של יחיד להפעלת חשבון חי: לא אומתה).
2. **Viator:** אין עלות לפי המחקר, אך יש לבדוק בתנאי השותפות מגבלות על שמירת מחירים/תוכן ועל הצגת מחיר "החל מ".
3. כל הפורמטים והמזהים המסומנים "לא אומת" דורשים בדיקת עשן ידנית מול חשבון בדיקה לפני שימוש.
