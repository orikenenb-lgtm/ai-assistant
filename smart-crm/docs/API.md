# SMART CRM AI — REST API v1

> **בעברית בקצרה:** ה-API הציבורי מאפשר למערכות חיצוניות (אתר, חנות, Zapier, מערכת הנהלת חשבונות) לקרוא ולכתוב אנשי קשר וחברות, ולקבל אירועים בזמן אמת דרך Webhooks חתומים. מפתחות API נוצרים ע"י בעל/ת הארגון בלבד ב־**הגדרות ← מפתחות API**, מוצגים פעם אחת בלבד, ונשמרים במערכת רק כ־hash. כל קריאה מוגבלת להרשאות (scopes) של המפתח, לארגון של המפתח ול־600 בקשות לדקה.

The machine-readable contract is [`openapi.json`](./openapi.json) (OpenAPI 3.1).

- Base URL: `https://<your-app-host>/api/v1`
- Format: JSON (UTF-8). Timestamps are ISO-8601 UTC strings.
- The API is English-only (error messages are not localized).
- Plan requirement: the `api` feature (Pro and above). Webhooks require the `webhooks` feature.

## Authentication

Create a key in **Settings → API keys** (owners only). The full key is shown **once**:

```
sck_ab12cd34_kQ3v...   (prefix "sck_<8 chars>" + secret)
```

Only a SHA-256 hash is stored; the prefix is shown in the UI so you can tell keys apart. Send it as a Bearer token:

```bash
curl https://crm.example.com/api/v1/me \
  -H "Authorization: Bearer $SMARTCRM_API_KEY"
```

Keys can have an expiry date and can be revoked at any time; a revoked or expired key gets `401` immediately. Every key belongs to exactly one organization — it can never read or write another organization's data.

### Scopes

| Scope | Allows |
|---|---|
| `contacts:read` | `GET /contacts`, `GET /contacts/{id}` |
| `contacts:write` | `POST /contacts`, `PATCH /contacts/{id}`, `DELETE /contacts/{id}` |
| `companies:read` | `GET /companies`, `GET /companies/{id}` |
| `deals:read`, `deals:write`, `tasks:read`, `tasks:write`, `webhooks:manage` | Reserved for upcoming endpoints (can already be granted) |

A request without the needed scope gets `403 FORBIDDEN`.

## Rate limits

600 requests per minute per key (fixed one-minute windows). Every authenticated response carries:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Requests allowed per window |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Unix time (seconds) when the current window ends |
| `Retry-After` | (429 only) seconds to wait |

API calls are also counted in the organization's monthly usage (`api_calls`).

## Errors

All errors share one shape:

```json
{ "error": { "code": "VALIDATION", "message": "Request validation failed", "details": [{ "path": "phone", "message": "Invalid phone number (e.g. +1 555 123 4567)" }] } }
```

| HTTP | `code` | When |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Missing, malformed, revoked or expired key |
| 403 | `FORBIDDEN` | Missing scope, or organization suspended |
| 403 | `PLAN_REQUIRED` / `QUOTA_EXCEEDED` / `READ_ONLY` | Plan or subscription state blocks the call |
| 404 | `NOT_FOUND` | Unknown id, or a record of another organization |
| 409 | `CONFLICT` | The record changed or conflicts with existing data |
| 412 | `PRECONDITION` | The operation isn't allowed in the record's current state |
| 422 | `VALIDATION` | Body or query failed validation (`details` lists fields) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL` | Unexpected error (logged with a request id) |

## Pagination

List endpoints accept `page` (1-based) and `pageSize` (1–100, default 25) and return:

```json
{ "data": [ ... ], "pagination": { "page": 1, "pageSize": 25, "total": 132, "hasMore": true } }
```

## Endpoints

### `GET /me`
Info about the calling key: `{ "data": { "keyId", "name", "prefix", "scopes", "organizationId" } }`.

### Contacts

```bash
# List (filters: q, stage, tag, company, owner, consent, sort)
curl "https://crm.example.com/api/v1/contacts?q=cohen&stage=customer&page=1&pageSize=50" \
  -H "Authorization: Bearer $SMARTCRM_API_KEY"

# Create
curl -X POST https://crm.example.com/api/v1/contacts \
  -H "Authorization: Bearer $SMARTCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{"firstName":"Dana","lastName":"Cohen","phone":"+972501234567","email":"dana@example.com","lifecycleStage":"lead"}'

# Read one
curl https://crm.example.com/api/v1/contacts/<id> -H "Authorization: Bearer $SMARTCRM_API_KEY"

# Partial update — omitted fields keep their value; customFields are merged
curl -X PATCH https://crm.example.com/api/v1/contacts/<id> \
  -H "Authorization: Bearer $SMARTCRM_API_KEY" -H "Content-Type: application/json" \
  -d '{"lifecycleStage":"customer","customFields":{"vip":true}}'

# Delete (soft delete; 204 No Content)
curl -X DELETE https://crm.example.com/api/v1/contacts/<id> -H "Authorization: Bearer $SMARTCRM_API_KEY"
```

Contact fields: `firstName`, `lastName`, `email`, `phone` (normalized to E.164), `title`, `source`, `lifecycleStage` (`subscriber|lead|opportunity|customer|churned|other`), `companyId`, `ownerId` (must be a member of the organization), `customFields` (validated against the organization's custom field definitions), `tagIds`. At least one of first name, last name, email or phone is required. Unknown fields in `PATCH` are rejected with `422`.

### Companies

```bash
curl "https://crm.example.com/api/v1/companies?q=acme" -H "Authorization: Bearer $SMARTCRM_API_KEY"
curl https://crm.example.com/api/v1/companies/<id> -H "Authorization: Bearer $SMARTCRM_API_KEY"
```

## Auditing

Writes through the API are recorded in the organization's audit log with actor type `api_key` and the key id. Reads are logged in structured server logs and counted in usage metering.

---

# Outbound webhooks

Configure in **Settings → Webhooks** (owners/managers with the `webhooks` plan feature). Each webhook has an HTTPS URL, a set of event types and a signing secret (`whsec_…`, shown once; can be rotated).

### Delivery

- `POST` with `Content-Type: application/json` and `User-Agent: SmartCRM-Webhooks/1.0`.
- Respond with any `2xx` within **10 seconds**. Redirects are not followed.
- Non-2xx, timeouts and network errors are retried with exponential backoff (≈30s, 1m, 2m, 4m… with jitter; up to 6 attempts). Each delivery is visible in the delivery history and can be redelivered manually.
- After **20 consecutive failed deliveries** the webhook is disabled automatically and the organization's owners/managers are notified. Re-enabling resets the counter.
- Delivery is at-least-once: use the event `id` (also in `X-SmartCRM-Event-Id`) to de-duplicate.
- For security (SSRF protection), only `https://` URLs without embedded credentials are accepted. Private/loopback/link-local IP literals and internal hostnames (`localhost`, `*.local`, `*.internal`) are rejected when saved; at delivery time the hostname is resolved and **every** address must be public, and the connection is pinned to the validated IP (no DNS-rebinding window).

### Payload

```json
{
  "id": "6f1c0e0a-…",
  "type": "contact.created",
  "occurredAt": "2026-10-19T08:15:00.000Z",
  "data": { "entityType": "contact", "entityId": "1b4d…", "...": "event-specific fields" }
}
```

Headers: `X-SmartCRM-Event`, `X-SmartCRM-Event-Id`, `X-SmartCRM-Delivery`, `X-SmartCRM-Signature`.

Event types: `contact.created`, `contact.updated`, `contact.tag_added`, `company.created`, `lead.created`, `lead.status_changed`, `lead.converted`, `deal.created`, `deal.updated`, `deal.stage_changed`, `deal.won`, `deal.lost`, `message.received`, `message.sent`, `message.failed`, `conversation.assigned`, `conversation.closed`, `task.created`, `task.completed`, `quote.sent`, `quote.accepted`, `quote.rejected`.

### Verifying the signature

```
X-SmartCRM-Signature: t=1760861700,v1=5f0c…(hex)
v1 = HEX( HMAC_SHA256( secret, "<t>.<raw request body>" ) )
```

Reject requests whose `t` is more than 5 minutes from your clock (replay protection), and compare in constant time. Use the **raw** body bytes, before JSON parsing.

```js
// Node.js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

```python
# Python
import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, header: str, tolerance: int = 300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", "0"))
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```
