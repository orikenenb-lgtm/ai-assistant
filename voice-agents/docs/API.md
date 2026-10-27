# Engine API contract

The engine (`engine/`) exposes this HTTP API. The dashboard (`dashboard/`), the platform MCP
server and any customer integration use only this API. Changes here must be made in the
engine, the dashboard and this file together.

All endpoints except `/health` and the Twilio webhooks require
`Authorization: Bearer <api key>`. Errors are JSON `{"detail": ...}` with a proper status code.

## Agents

An agent is the JSON document defined by `engine/app/agents/schema.py` (`AgentConfig`).
See `engine/agents/*.json` for complete examples.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/agents` | | `[{id, name, business_name, tools: [type], unfilled: [str]}]` |
| GET | `/agents/{id}` | | full `AgentConfig` |
| POST | `/agents` | `AgentConfig` | 201 + saved agent; 409 if the id exists; 422 on validation errors |
| PUT | `/agents/{id}` | `AgentConfig` (id must equal path) | saved agent |
| DELETE | `/agents/{id}` | | 204 |
| POST | `/agents/{id}/prompt` | `{variables, direction}` | `{system_prompt}` |
| POST | `/agents/{id}/chat` | `{messages: [{role, content}], variables, direction}` | `{reply, tools: [{name, arguments, ok, result}], ended}` |

`unfilled` lists `[למלא: ...]` placeholders. An agent with placeholders cannot take or make
calls or be tested (422).

## Calls

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/calls` | `{agent_id, to, variables, idempotency_key?}` | call record (outbound call placed) |
| GET | `/calls?limit=50&agent_id=` | | `[call summary]` newest first: `{id, agent_id, direction, remote_number, status, started_at, ended_at, end_reason}` |
| GET | `/calls/{id}` | | full call record incl. `transcript` and `tool_calls` |

Call `status`: `created | ringing | in_progress | ended | no_answer | failed`.

## Meta

| Method | Path | Returns |
|---|---|---|
| GET | `/meta` | `{tool_types: [...], document_types: [...], default_model, voices_hint}` for building the agent editor |

## Twilio (signed by Twilio, no API key)

- `POST /twilio/voice?agent=<id>` — inbound call webhook → TwiML that streams audio to us
- `POST /twilio/status` — outbound call status callback
- `WS /twilio/stream` — the call audio (Twilio Media Streams)
