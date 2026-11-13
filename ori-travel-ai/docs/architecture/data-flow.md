# זרימות נתונים

## 1. חיפוש ידני (למשל טיסות)

```
דפדפן ── POST /api/search/flight {origin, destination, dates, pax...}
  │        (עוגיית סשן + X-CSRF-Token)
  ▼
current_user  →  אימות Pydantic (תאריכים, גילאים, תינוק לכל מבוגר)  →  rate limit
  ▼
search.service.run_search
  ├─ params_hash → בדיקת מטמון (TTL)  ──► פגיעה: מחזיר הצעות שמורות (CACHED)
  ├─ registry: מתאמים פעילים לקטגוריה (DEMO תמיד; LIVE רק עם מפתח + opt-in)
  ├─ ThreadPoolExecutor(max=4): adapter.search() עם timeout לכל ספק
  │     ├─ OK        → adapter.normalize() → CanonicalOffer
  │     ├─ TIMEOUT   → ProviderSearch.status=TIMEOUT
  │     └─ FAILED    → הודעה בעברית, בלי payload גולמי
  ├─ סינון לפי פרמטרים → dedupe (dedupe_key בלי מחיר וספק) → scoring (40/25/20/15)
  ├─ שמירה: search_requests, provider_searches, offers (minor units + JSON מלא)
  ▼
SearchResponse {providers[], offers[], coverage_note, has_demo_results...}
```

## 2. צ'אט AI

```
POST /api/ai/chat {message, history}
  ▼
ai.service  ──► (אין מודל) פענוח חוקים עברית/אנגלית → פרמטרים → run_search → כרטיסים + תבנית
           └──► (יש מודל) system prompt + כלים קריאה-בלבד:
                  search_flights/hotels/cars/activities, get_trip, save_offer
                  ← תוצאות כלים עטופות כ"נתונים לא אמינים" (הגנה מ-injection)
                  → טקסט המודל עובר בדיקת grounding (מחירים מול תוצאות כלים)
  ▼
{reply.text, reply.cards (מהשרת, לא מהמודל), tool_calls, grounding}
```
לכלי ההזמנה **אין** חשיפה למודל.

## 3. הכנת הזמנה (סימולציה או מעבר לאתר הספק)

```
QUOTE_SELECTED ─revalidate→ REVALIDATING ─(ללא שינוי)→ READY_FOR_APPROVAL
      ▲                         │(מחיר השתנה) → QUOTE_SELECTED עם מחיר חדש
      │                         │(פג תוקף)    → EXPIRED
      └─ שינוי נוסעים או הצעה (מבטל אישור)
READY_FOR_APPROVAL ─approve (סיסמה + terms_hash זהה)→ APPROVED
APPROVED ─submit(idempotency_key) → revalidate מיידי → SUBMITTING → ספק מדומה
      ├─ CONFIRMED (רק עם supplier_reference)
      ├─ FAILED
      └─ UNKNOWN → reconcile (שאילתה לפי idempotency key) → CONFIRMED / FAILED
מסלול LIVE: חסום בקוד. מסלול ספק אמיתי: קישור מאושר (allowlist) לאתר הספק → רישום אסמכתה ידני.
```

## 4. התראות מחיר

```
Alert (פרמטרי חיפוש + יעד מחיר) ── בדיקה ידנית (cooldown) או מתזמן (opt-in כפול)
  → run_search(origin="alert") → PriceSnapshot → אם המחיר מתחת ליעד: Notification בתוך האפליקציה
```

## 5. נתונים רגישים

```
PUT /api/travelers/{id} {passport_number...}
  → encrypt_str (Fernet, ORI_DATA_KEY) → traveler_profiles.*_enc = "v1:..."
GET → מוחזר ממוסך (••••123). חשיפה מלאה רק עם reauth ב-10 הדקות האחרונות, ונרשמת ביומן ביקורת
```
