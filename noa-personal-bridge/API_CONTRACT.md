# NOA Personal Bridge — API Contract (v1)

Owner: Agent 04 (Chief Architect). Shared by the Android team (client) and the Backend/AI teams (server).
Changing it requires a DECISION_LOG.md entry.

Transport: HTTPS only (the Android client refuses `http://` except `10.0.2.2`/`localhost` in debug builds).
All bodies are UTF-8 JSON. Field names are `snake_case`.

## Authentication

1. The operator creates a one-time pairing code on the server:
   `python -m bridge_service.admin create-pairing-code` → prints an 8-char code, valid 10 minutes, single use.
2. The app calls `POST /v1/pair` with the code and receives a `device_token` (32 random bytes, base64url).
   The server stores only `sha256(device_token)`.
3. Every other call sends:
   - `Authorization: Bearer <device_token>`
   - `X-Bridge-Timestamp: <unix epoch millis>` — must be within ±5 minutes of server time.
   - `X-Bridge-Nonce: <uuid v4>` — each nonce is accepted once per device within the window (replay protection).

## Endpoints

### `GET /health`
No auth. Never contains message content or counts per conversation.
```json
{"ok": true, "enabled": false, "engine": "stub", "version": "0.1.0"}
```

### `POST /v1/pair`
Request: `{"pairing_code": "ABCD2345", "device_name": "Galaxy S25 Ultra"}` (`device_name` ≤ 60 chars)
Response 200: `{"device_id": "dev_…", "device_token": "…"}`
Errors: 400 invalid/expired/used code (same message for all three), 429 too many attempts.

### `POST /v1/drafts`
Auth required. Request:
```json
{
  "request_id": "uuid-v4",
  "conversation_ref": "64-hex sha256 (opaque, derived on device)",
  "sender_display_name": "דנה",
  "messages": [{"text": "היי, מתי נפגשים?", "sent_at": 1763236800000}],
  "locale": "he"
}
```
Limits: `messages` 1..20, each `text` 1..2000 chars, total ≤ 8000 chars, `sender_display_name` ≤ 80 chars,
`conversation_ref` must match `^[0-9a-f]{64}$`.

Response 200:
```json
{
  "request_id": "same uuid",
  "draft_text": "נשמע מעולה, אני מאשר ב־20:00 😊",
  "safety": {"injection_suspected": false, "sensitive_request": false, "notes": []},
  "engine": "stub"
}
```
`notes` are short Hebrew strings meant for the user (e.g. "ההודעה מבקשת קוד אימות — לא לשלוח").

Idempotency: the same `request_id` from the same device within 10 minutes returns the cached response
(kept in memory only) and does not call the AI again.

Errors (body always `{"error": "<code>", "message": "<hebrew text>"}`):
| status | error | meaning |
|---|---|---|
| 401 | `unauthorized` | missing/invalid/revoked token |
| 409 | `replay` | nonce reused or timestamp out of window |
| 413 | `too_large` | over limits |
| 422 | `invalid_request` | schema validation failed |
| 429 | `rate_limited` | > 30 drafts/min or > 300/day per device |
| 503 | `disabled` | `BRIDGE_ENABLED` is false or kill switch on |
| 502 | `engine_error` | AI engine failed/timed out (retryable) |

### `POST /v1/devices/revoke`
Auth required. Revokes the calling device's token (used by "ניתוק מלא" in the app). Response 204.

## Invariants
- The server never stores message text, sender names or drafts on disk, and never logs them.
- The server holds no per-conversation memory: each request carries only that conversation's burst.
- The AI layer is tool-free: no endpoint can trigger sending, calls, documents or any side effect.
- The server cannot send WhatsApp messages. Sending happens only on the phone, after in-app approval.
