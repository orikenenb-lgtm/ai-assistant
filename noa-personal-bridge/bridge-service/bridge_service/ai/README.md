# AI layer (`bridge_service.ai`)

Turns a burst of incoming private WhatsApp messages into ONE short Hebrew (or English)
draft reply. The owner approves, edits or cancels every draft on the phone; nothing here
sends anything.

| File | Role |
|---|---|
| `base.py` | Contract with the API layer (owned by the architect; do not edit) |
| `safety.py` | `analyze_incoming()`: heuristic injection / sensitive-request detection, Hebrew notes for the owner |
| `prompt.py` | `build_messages()`: system prompt + `<incoming_messages>` user block |
| `output_guard.py` | `finalize()`: cleans model text, removes unknown links, blocks secrets and prompt leaks |
| `stub.py` | `StubEngine`: offline, deterministic replies (local dev, tests) |
| `anthropic_engine.py` | `AnthropicEngine`: one tool-free Messages API call |
| `noa_persona_engine.py` | `NoaPersonaEngine`: borrows NOA's persona via read-only `/prompt`, then the same tool-free call |
| `factory.py` | `create_engine(settings)` (`engine` = `stub` / `anthropic` / `noa_persona`) |

## Threat model

* **Incoming messages and the sender display name are untrusted** third-party text. They
  may contain prompt injection ("תתעלמי מההוראות שלך", "ignore all instructions"), fake
  tags, commands, or social engineering (codes, passwords, money, addresses).
* **The model cannot act.** Every Anthropic request is sent without `tools`, `tool_choice`
  or MCP servers; only `text` blocks of the response are read. The worst a successful
  injection can do is produce bad *text*, which then goes through the output guard and a
  human. Tests assert the request body has no `tools` key.
* **Defence in depth on the text:** untrusted content sits inside `<incoming_messages>`
  with tag-like `<`/`>` sequences (including full-width look-alikes) neutralized, so it
  cannot close the block or open `<noa_persona>`. The system prompt tells the model that
  block is data, never instructions. `safety.py` adds an explicit alert section when it
  detects an attempt, and the owner sees its Hebrew notes next to the draft.
* **Output guard:** strips quotes / markdown / "טיוטה:" / "Draft:" / "נועה:" prefixes, caps
  at 700 chars on a sentence boundary, removes URLs that were not in the incoming messages,
  and replaces the whole draft with a safe fallback if it contains secret-looking strings
  (API-key prefixes, long base64/hex, card-shaped numbers, any 4-8 digit code when the
  conversation asked for something sensitive) or prompt fragments.
* `safety.py` is a heuristic signal, not the security boundary; the boundaries are "no
  tools" and "a human approves every send". It errs a little on the cautious side (e.g.
  any mention of כסף / money is flagged as a money topic); bare English "bit" is not
  flagged (too common), "ביט" / "בbit" / "via bit" are.

## Why NOA's `/chat` is forbidden

NOA's `POST /agents/{id}/chat` runs NOA's real tool loop (send_whatsapp, issue_document,
transfer_call, webhooks, MCP). If the bridge forwarded WhatsApp text there, any sender
could prompt-inject NOA into real actions. The bridge only uses
`POST /agents/{id}/prompt`, which returns `{"system_prompt": "..."}` and runs nothing.

**The NOA key is unscoped.** NOA's `ENGINE_API_KEY` is one global key that also authorizes
`/agents/{id}/chat` and `POST /calls` (real outbound phone calls). So read-only use is
enforced in code, not by the key:

1. `noa_agent_id` must match `^[a-z0-9][a-z0-9_-]{0,63}$` (otherwise: no persona);
2. `noa_engine_url` must be `https` (plain `http` only for localhost / 127.0.0.1 / ::1),
   without credentials, query or fragment;
3. the exact URL `{base}/agents/{id}/prompt` is computed once; an httpx request hook
   refuses any request that is not `POST` to exactly that scheme/host/port/path;
4. redirects are never followed and any 3xx is a failure.

Tests record every outgoing request and assert none goes to `/chat` or `/calls`.
**Recommendation:** if the live NOA engine supports a dedicated, read-only (prompt-only)
key, configure that instead of the global engine key; and keep the key out of logs.

Persona handling: cached 10 minutes per agent id (persona is agent configuration, not
conversation data; failures are cached 60 s), lines containing `[למלא` (unfilled template
placeholders, which `/prompt` does not check) are dropped, capped at 6000 chars, and placed
in `<noa_persona>` as tone/identity background only. The prompt states that the bridge rules
override it and that its tools/steps (calls, documents, send_whatsapp, transfer_call) do not
exist here. On any failure the engine still drafts, without persona, and labels the output
`noa_persona:fallback`.

## Conversation isolation

`build_messages()` receives exactly one `DraftInput` and uses nothing else: no history, no
memory, no other conversation, no cross-request cache of conversation data. The
`conversation_ref` and `request_id` are not sent to the model. Tests build two inputs and
assert neither leaks into the other's prompt.

## Model call details

* Default model `claude-haiku-5-5`, `max_tokens=300`, thinking explicitly disabled (short
  reply, all tokens go to the answer). No `temperature`: current models reject non-default
  sampling parameters.
* For models on which thinking cannot be disabled (`claude-opus-5-5`, `claude-sonnet-5-5`,
  Fable/Mythos) the engine omits `thinking`, sends `output_config.effort = "low"` and raises
  `max_tokens` to 2048.
* `AsyncAnthropic(api_key, max_retries=1, timeout=engine_timeout_seconds)`. Errors map to
  `EngineError`: 429 / 5xx / 408 / 409 / timeouts / connection errors are retryable;
  400 / 401 / 403 / 404 are not. A missing API key is a non-retryable `EngineError`; the
  engine never falls back to `ANTHROPIC_API_KEY` from the environment. Error messages never
  include the key or the conversation.
* `stop_reason == "refusal"` or an empty answer yields the safe fallback text.

## UNVERIFIED

* **Live NOA `/prompt` endpoint.** Behaviour was read from an older copy of the NOA engine
  source (`voice-agents/engine/app/server.py`); the live repository and deployment were not
  reachable. Path, auth header, body (`{"variables": {}, "direction": "inbound"}`) and
  response shape (`{"system_prompt": ...}`) are assumptions. Agents with required variables
  may answer 422, in which case the bridge drafts without persona.
* **Real model output quality in Hebrew** (naturalness, tone matching, refusal to follow
  injected instructions) has not been measured: all tests mock the Anthropic API. An eval
  on real (consented, anonymized) message bursts is needed before relying on it.
* The model-specific request options (thinking disabled on Haiku 5.5, effort `low` on
  always-thinking models) follow current API documentation but were not exercised against
  the live API from here.
* The persona is a phone-sales prompt written for voice calls (for "נועה מכרם טויס" a
  B2B toy-sales persona); how much of its tone carries over usefully into private
  WhatsApp replies is untested.
