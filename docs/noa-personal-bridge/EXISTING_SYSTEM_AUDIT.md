# NOA Personal Bridge — סקר המערכת הקיימת (Existing System Audit)

**צוות:** Integration & Regression (Agent 21 Integration Engineer, Agent 29 Regression Testing Engineer; בפיקוח Agent 05 Quality Director ו-Agent 30 DevOps)
**תאריך:** 2026-11-15
**שיטה:** כל טענה כאן נבדקה מול קוד/קונפיג בפועל (קריאה בלבד). לא שונה אף קובץ קיים. ציטוט נתיבים יחסית לשורש הריפו `ai-assistant`, אלא אם צוין ענף אחר.

**מצב הריפו בזמן הסקר**

| פריט | ערך |
|---|---|
| ענף עבודה | `claude/serene-planck-84hxxm` |
| `HEAD` (בסוף הסקר) | `3eebc89669e5a2ec2c9169340df5b4b456d35cba` ("NOA Personal Bridge: מסמכי ניהול, CI נפרד ותלויות"), מעל `ea9b559` ("...שלד פרויקט וחוזים (Phase 0-1)") |
| `main` / `origin/main` | `c4ce0d7a78c25982f69099d75093d60efa46fbff` (Merge PR #10) |
| `git diff --name-status main HEAD -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge'` | `A .github/workflows/noa-personal-bridge.yml` — **קובץ חדש אחד בלבד**, בלי `M` ובלי `D` על אף קובץ קיים |
| `git diff --stat main -- .github/workflows/ci.yml .github/workflows/smart-crm.yml` | ריק (ה-workflows הקיימים לא שונו) |
| `git status --porcelain` מחוץ לתיקיות הגשר | ריק |

> הערה: ההנחה בבריף ש-`HEAD` זהה ל-`c4ce0d7` אינה מדויקת. במהלך הסקר `HEAD` התקדם משני commits של צוותים אחרים (`ea9b559`, ואז `3eebc89`, שהוסיף את קובץ ה-workflow). שניהם מוסיפים קבצים חדשים בלבד ואינם משנים קבצים קיימים.

---

## 1. מבנה הפרויקט

ב-`main` (ובענף הנוכחי) יש מונו-ריפו עם ארבעה רכיבים עצמאיים:

| תיקייה | מה זה | טכנולוגיה |
|---|---|---|
| `backend/` | API של "Kerem Orders" — ניהול הזמנות לסיטונאות צעצועים, מחובר ל-Rivhit | FastAPI, Python 3.11, Supabase |
| `frontend/` | ממשק Kerem Orders (חנות, הזמנות, אדמין, שכבות CRM וקטלוג) | React 19 + Vite 8 + Tailwind 4 + TypeScript 6 |
| `smart-crm/` | "SMART CRM AI" — CRM רב-דיירים נפרד עם Inbox של WhatsApp Cloud API | Next.js 16.4.2, Drizzle, Postgres, Vitest, Playwright |
| `supabase/` | migrations + בדיקות RLS של Kerem Orders | SQL (PostgreSQL 16) |
| `docs/` | `architecture.md`, `deployment.md`, `security.md`, `GO_LIVE.md` | — |
| `.github/workflows/` | `ci.yml` (Kerem Orders), `smart-crm.yml`, ו-(חדש) `noa-personal-bridge.yml` | GitHub Actions |
| `.claude/agents/README.md` | תיאור תת-הסוכנים | — |
| `noa-personal-bridge/` | **חדש** — הפרויקט הנוכחי (נכתב כרגע ע"י סוכנים אחרים; לא נסקר כאן) | — |

**איפה נמצאת NOA (נועה)?** לא ב-`main`.
- ב-`main` המילה מופיעה רק כנתוני דמו/בדיקה: `smart-crm/scripts/seed.ts`, `smart-crm/tests/e2e/{auth-onboarding.spec.ts,helpers.ts,inbox.spec.ts}`, `smart-crm/tests/integration/rls-isolation.test.ts`.
- סוכן NOA האמיתי מופיע במנוע **voice-agents** בענף `origin/ccr-a60c5c0c-bohsof` (commit `fff8544`, 2026-10-27, "voice-agents: מנוע סוכני קול בעברית (Twilio + ElevenLabs + Claude) עם כלים"), בקובץ `voice-agents/engine/agents/kerem-toys-orders.json`: `"name": "נועה מכרם טויס"`.
- הופעה משנית: בענף `origin/ccr-973a7c93-hbmsf0` יש אתר שיווקי `voice-site/` ("SMART Voice") שבו `brand.agentName: "נועה"` (`voice-site/src/config/site.ts`) — פרסונת דמו לאתר, לא המנוע.
- סריקת כל 22 הענפים המרוחקים (`git branch -r` + `git grep`) לא מצאה מקום נוסף שבו NOA ממומשת. ענפים אחרים מכילים פרויקטים לא קשורים (`jarvis-desktop/`, `ori-travel-ai/`, `discipline-os-ultra/`, `eduvolt-smart-panel/`, `garage-website/`, `nail-studio/`, `remix-studio/` ועוד); ההתאמות ל-"נועה" שם הן מילים כמו "הפחתת תנועה" או נתוני seed.
- הריפו `orikenenb-lgtm/voice-agents` (כנראה הגרסה החיה) **לא נגיש מהסשן הזה** — לא נבדק.

## 2. שירותי בקנד

### 2.1 Kerem Orders (`backend/`)
- נקודת כניסה: `backend/app/main.py` (`FastAPI(title="Kerem Orders API")`), עם `CORSMiddleware`, `slowapi` להגבלת קצב, ו-lifespan שמפעיל את `sync_loop()` רק כש-`SYNC_ENABLED`.
- routers: `auth`, `admin`, `admin_quotes`, `admin_sync`, `products`, `orders`; ובנוסף `crm` ו-`catalog` שנטענים לפי דגלים (`enable_crm`, `enable_catalog`).
  - **ממצא:** ב-`backend/app/config.py` ההערות אומרות "כבוי כברירת מחדל", אבל בפועל `enable_crm: bool = True` ו-`enable_catalog: bool = True`. כלומר שני ה-routers דלוקים כברירת מחדל. אין לזה השפעה על הגשר, אבל זה פער בין התיעוד לקוד.
- services: `rivhit_service.py` (הלקוח היחיד ל-Rivhit), `sync_service.py`, `orders_service.py`, `quote_service.py`, `admin_service.py`, `auth_service.py`, `supabase_client.py`, `notification_service.py`.
- מפסק בטיחות: `rivhit_write_enabled: bool = False` — כתיבה ל-Rivhit חסומה כברירת מחדל.
- `catalog/rivhit_readonly.py` — קטלוג Rivhit לקריאה בלבד; ב-`config.py` יש ברירת מחדל של טוקן הדמו הציבורי של Rivhit (לפי ההערה בקוד הוא לא סוד; הערך לא מועתק לכאן).
- הגשת SPA: אם קיימת `backend/static/` (נבנית ב-Dockerfile), FastAPI מגיש את הפרונט מאותו דומיין.

### 2.2 SMART CRM (`smart-crm/`) — צד שרת
- Next.js App Router עם Server Actions ו-Route Handlers ב-`smart-crm/src/app/api/**`.
- מודולים ב-`smart-crm/src/modules/`: `account, admin, ai, analytics, api, audit, auth, automation, billing, calendar, crm, documents, inbox, notifications, org, privacy, sales, search, settings, tasks, webhooks, whatsapp`.
- תשתית שרת ב-`smart-crm/src/server/`: `env.ts` (אימות zod), `db/` (Drizzle), `auth/`, `jobs/`, `crypto.ts`, `rbac/`, `storage/`, `email/`, `rate-limit.ts`.
- שכבת AI: `smart-crm/src/modules/ai/provider.ts` — OpenAI (`openai` SDK) או `MockAiProvider`, לפי `AI_PROVIDER`.

### 2.3 מנוע voice-agents (ענף `origin/ccr-a60c5c0c-bohsof`, `voice-agents/engine/`)
- FastAPI (`app/server.py`, `create_app`), מורץ ע"י `python -m app.main` על פורט `PORT` (ברירת מחדל 8080).
- תלויות (`engine/pyproject.toml`): `pipecat-ai[anthropic,elevenlabs,silero,websocket]==1.14.0`, `anthropic==1.17.0`, `fastapi==0.162.0`, `mcp==2.3.0` ועוד. Python ‎>=3.12.
- פירוט ב-סעיף 4.

## 3. שירותי פרונטאנד

- **`frontend/`** (Kerem Orders): `src/App.tsx`, עמודים ב-`src/pages/` (Login/Signup/Reset, Catalog, MyOrders, OrderDetail, Admin*), שכבת CRM ב-`src/crm/` ושכבת קטלוג ב-`src/catalog/` — מופעלות בבנייה ע"י `VITE_ENABLE_CRM` / `VITE_ENABLE_CATALOG` (ה-`backend/Dockerfile` מגדיר את שניהם ל-`1`). כל הגישה לנתונים דרך הבקנד (`src/lib/api.ts`, axios); משתנה הסביבה היחיד: `VITE_API_URL`.
- **`smart-crm/`**: UI של Next.js (React 19.3, radix-ui, recharts, next-intl, עברית/RTL), כולל רכיבי Inbox של WhatsApp ב-`src/modules/whatsapp/components/`.
- **voice-agents**: `docs/API.md` מזכיר `dashboard/`, אבל **אין תיקיית dashboard בעותק שבענף** — כנראה קיימת רק בריפו החי.

## 4. מנוע ה-AI (מנוע הקול של NOA)

כל הנתיבים בסעיף הזה יחסיים ל-`voice-agents/engine/` בענף `origin/ccr-a60c5c0c-bohsof`.

### 4.1 מודל
- `app/config.py`: `anthropic_model: str = "claude-haiku-5-5"` (משתנה סביבה `ANTHROPIC_MODEL`). לכל סוכן אפשר לדרוס דרך `AgentConfig.llm_model`.
- בשיחת טלפון: `app/pipeline.py` משתמש ב-`AnthropicLLMService` של pipecat, יחד עם `ElevenLabsRealtimeSTTService` ו-`ElevenLabsTTSService`.
- בצ'אט טקסט: `app/text_chat.py` → `client.messages.create(model=..., max_tokens=600, system=..., tools=..., messages=...)` עם `AsyncAnthropic`.

### 4.2 בניית הפרומפט
- `app/agents/prompt.py`:
  - `call_values()` מוודא שכל המשתנים החובה (`variables[].required`) קיימים (אחרת `MissingVariables` → HTTP 422), ומוסיף `caller_number`, `call_direction`, `called_at` (שעון ישראל).
  - `build_system_prompt()` מרכיב: `context` → `# המטרה` → `# איך מדברים בטלפון` (כללי דיבור קולי: "כל מה שאת כותבת מוקרא בקול", בלי רשימות/אימוג'י/קישורים) → `# מהלך השיחה` (steps) → `# מה שאת יודעת` (knowledge) → `# כללים` (קבועים + `rules` של הסוכן) → `# כלים` → `# פרטי השיחה`.
- הגדרת סוכן = קובץ JSON שנטען ע"י `app/agents/store.py` (`FileAgentStore`, תיקייה `AGENTS_DIR`, ברירת מחדל `agents`), ומאומת ב-`app/agents/schema.py` (`AgentConfig`, `id` בתבנית `^[a-z0-9][a-z0-9-]{1,47}$`).
- סוכנים בעותק:
  - `agents/kerem-toys-orders.json` — **"נועה מכרם טויס"**: נציגה דיגיטלית של כרם טויס ללקוחות עסקיים (הזמנות סחורה). כלים: `end_call`, `morning_document` (רק `price_quote`, עד 20,000 ₪), `send_whatsapp` (`only_to_caller: true`), `transfer_call`. **מכיל עדיין שדות `[למלא: ...]`** (מספר WhatsApp, נייד בעל העסק, ידע) — ולכן `unfilled_placeholders()` לא ריק.
  - `agents/personal-assistant.json` — "העוזרת האישית" (מתקשרת בשם `{{on_behalf_of}}`); כלי יחיד `end_call`; משתנים חובה `on_behalf_of`, `task_topic`, `task_goal`.
- **ממצא חשוב לגשר:** הפרסונה "נועה" שקיימת בקוד היא *נציגת מכירות עסקית של כרם טויס עם פרומפט שמותאם לדיבור טלפוני* — לא עוזרת אישית לוואטסאפ פרטי. אם הגשר ישתמש בפרומפט הזה כמו שהוא, הוא יקבל הוראות כמו "לסגור הזמנה" ו"להפיק הצעת מחיר". צריך שכבת עטיפה בצד הגשר (ראו INTEGRATION_PLAN), ובחירה מפורשת של המשתמש איזה `agent_id` הוא "NOA" שלו.

### 4.3 כלים — הסיכון ב-`POST /agents/{id}/chat`
- `app/tools/toolbox.py` (`Toolbox.create`) בונה את הכלים מתוך `agent.tools`: `EndCall`, `SendSms`, `SendWhatsapp`, `TransferCall` (`app/tools/builtin/telephony.py`), `Webhook` (`webhook.py`), `MorningDocument` (`morning.py`, `issue_document`), ו-`McpServer` (`mcp.py`, מתחבר לשרת MCP חיצוני ומוסיף את הכלים שלו).
- `app/text_chat.py` (`chat_turn`) מריץ לולאה של עד `MAX_TOOL_ROUNDS = 6` סבבים: כל `tool_use` שהמודל מחזיר **מבוצע בפועל** דרך `toolbox.execute(...)`. ה-docstring של הקובץ אומר במפורש: "Tools really run, so point side-effect tools (SMS, documents) at sandboxes when testing."
- `POST /agents/{agent_id}/chat` (`app/server.py`) יוצר `ToolContext(..., twilio=None, test_mode=True)`. מה זה אומר בפועל **בעותק שבענף**:

| כלי | מה קורה ב-`/chat` | מקור |
|---|---|---|
| `send_whatsapp`, `send_sms`, `transfer_call` | `_require_twilio` זורק `ToolError("שירות הטלפוניה לא מוגדר")` כי `twilio=None` — ההודעה לא נשלחת, אבל המודל מנסה, ו"כישלון" מוחזר לו | `telephony.py` |
| `issue_document` (Morning) | אם `MORNING_SANDBOX=true` — **קריאה אמיתית ל-API של Morning sandbox** ויצירת מסמך שם. אם `false` — מחזיר תוצאה מדומה (`"status": "simulated"`) | `morning.py`, שורה `if ctx.test_mode and not ctx.settings.morning_sandbox` |
| כלי `webhook` | **POST/GET אמיתי** ל-endpoint של העסק; רק מעביר `"test": true` ב-meta, והאחריות להתעלם על צד השרת המקבל | `webhook.py` |
| כלי `mcp_server` | **התחברות והרצה אמיתית** של כלי MCP; אין בדיקה של `test_mode` | `mcp.py`, `toolbox.py` |
| `end_call` | משנה רק את הרשומה בזיכרון | `telephony.py` |

  בנוסף, כל קריאה ל-`/chat` עולה כסף ב-Anthropic, ו-`/chat` מחזיר 422 לסוכן שיש בו `[למלא: ...]` (`require_finished`) — כלומר על `kerem-toys-orders` בעותק הזה `/chat` בכלל לא יעבוד.
  **מסקנה:** `/chat` הוא endpoint שמפעיל כלים. גם אם בעותק הזה חלק מהכלים נכשלים בגלל `twilio=None`, זו התנהגות שתלויה בפרטי מימוש, ויכולה להשתנות בגרסה החיה (שכבר שונה מהעותק — ראו סעיף 13). **הגשר לא יקרא ל-`/chat` לעולם.**
- `POST /agents/{agent_id}/prompt` (`preview_prompt` ב-`app/server.py`) — **קריאה בלבד**, לפי הקוד: טוען את קובץ הסוכן, קורא ל-`call_values` ול-`build_system_prompt`, ומחזיר `{"system_prompt": ...}`. אין קריאה ל-Anthropic, אין Toolbox, אין `CallRecord`, אין כתיבה לדיסק, ואין `require_finished` (כלומר עובד גם על סוכן עם `[למלא: ...]`). מכוסה ע"י `tests/test_server.py::test_prompt_preview`.
- `POST /calls` — **מחייג שיחת טלפון אמיתית** דרך Twilio. מוגן באותו מפתח.

### 4.4 הרשאה במנוע
- `require_api_key` ב-`app/server.py`: `Authorization: Bearer <ENGINE_API_KEY>`, השוואה עם `hmac.compare_digest`. אם `ENGINE_API_KEY` ריק — כל ה-API סגור (401; `test_api_closed_when_no_key_configured`).
- **יש מפתח אחד גלובלי בלבד** — אין מפתח מוגבל לקריאה בלבד. מי שמחזיק אותו יכול גם לחייג (`POST /calls`), להפעיל כלים (`/chat`), ולפי `docs/API.md` גם ליצור, לעדכן ולמחוק סוכנים (בגרסה החיה). לכן ה"קריאה בלבד" של הגשר נשענת על משמעת בקוד הגשר, לא על אכיפה של NOA.

## 5. מערכת זיכרון

- **ל-NOA אין זיכרון שיחה מתמשך** (לא בין שיחות ולא בין לקוחות):
  - `app/calls.py` (`CallRegistry`): שיחות חיות נשמרות בזיכרון; שיחה שהסתיימה נכתבת כ-JSON ל-`CALLS_DIR` (ברירת מחדל `data/calls/`), עם transcript ולוג כלים. זה לוג בלבד — **לא נטען בחזרה לפרומפט** של שיחה הבאה.
  - `/chat` חסר מצב: הלקוח שולח את כל ההיסטוריה (`messages`, עד 60 הודעות, כל אחת עד 2000 תווים). ה-`CallRecord` שנוצר שם לא נשמר ב-`st.calls`.
  - `idempotency` של `/calls` נשמר ב-dict בזיכרון (`AppState.idempotency`).
  - אין vector store, אין DB. סוכנים = קבצי JSON (בקוד כתוב: "Replaced by the database later").
- ב-`smart-crm` יש היסטוריית שיחות WhatsApp ב-Postgres (מודול `inbox`), אבל זו מערכת אחרת שאינה קשורה ל-NOA.

## 6. אינטגרציות WhatsApp קיימות

| # | איפה | ספק | כיוון | הערות |
|---|---|---|---|---|
| 1 | `smart-crm/src/modules/whatsapp/*` (`meta-provider.ts`, `webhook.ts`, `outbound.ts`, `jobs.ts`, `signature.ts`, `accounts.ts`, `mock-provider.ts`, `simulator.ts`) + `smart-crm/src/app/api/webhooks/whatsapp/route.ts` | **Meta WhatsApp Cloud API** (`https://graph.facebook.com/${META_GRAPH_VERSION}`) | נכנס (webhook חתום ב-`META_APP_SECRET`) + יוצא (worker) | `provider.ts`: "Only the official Meta WhatsApp Cloud API is supported in production". `WHATSAPP_PROVIDER` ∈ `mock`/`meta` (ברירת מחדל `mock`). טוקן הגישה לכל חשבון שמור מוצפן ב-DB (`schema.secrets`, `encryptSecret`/`decryptSecret`, `ENCRYPTION_KEY`). דורש מספר עסקי (WABA) — **לא המספר האישי**. |
| 2 | voice-agents `app/tools/builtin/telephony.py` (`SendWhatsapp`) | **Twilio** (`whatsapp:` prefix, `twilio.send_message`) | יוצא בלבד, ככלי של הסוכן | `from_number` מוגדר בסוכן (ב-`kerem-toys-orders.json` עדיין `[למלא: ...]`). `only_to_caller` מגביל לשולח רק לצד השני בשיחה. |
| 3 | `backend/app/services/notification_service.py` | **אין WhatsApp** — Resend (Email) + Telegram Bot | יוצא (התראת הזמנה חדשה לאדמין) | ה-WhatsApp היחיד ב-backend הוא ערך `"channel": "whatsapp"` בנתוני בדיקה (`backend/tests/test_crm_analytics.py`). |
| 4 | `voice-site/` (ענף `origin/ccr-973a7c93-hbmsf0`) | קישורי `wa.me` בלבד (`NEXT_PUBLIC_WHATSAPP_NUMBER`) | CTA באתר | לא אינטגרציית הודעות. |

**אף אחת מהאינטגרציות לא עובדת עם WhatsApp אישי.** כולן דורשות מספר עסקי, API רשמי, או Twilio sender.

## 7. Twilio / ElevenLabs

- מוגדרים **רק** במנוע voice-agents (`engine/app/config.py`, `engine/.env.example`). בשמות בלבד:
  `PUBLIC_BASE_URL`, `ENGINE_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_VALIDATE_SIGNATURE`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `AGENTS_DIR`, `CALLS_DIR`, `MORNING_API_KEY_ID`, `MORNING_API_KEY_SECRET`, `MORNING_SANDBOX`, `BLOCKED_NUMBERS`.
- Twilio: `app/telephony/twilio_api.py` (REST), `signature.py` (אימות `X-Twilio-Signature`), `phone.py` (נרמול מספרים ישראליים). Webhooks: `POST /twilio/voice?agent=<id>`, `POST /twilio/status`, `WS /twilio/stream`.
- ElevenLabs: STT ו-TTS ב-`app/pipeline.py`.
- ב-`main` (backend/frontend/smart-crm) **אין** Twilio ואין ElevenLabs.

## 8. מסדי נתונים

| מערכת | DB | סכמה / migrations |
|---|---|---|
| Kerem Orders | Supabase (Postgres + RLS + Auth) | `supabase/migrations/2026061200000{0,1,2}_*.sql`, `20260614000003_harden_grants.sql`, `20260614000004_crm.sql`, `20260614000005_catalog.sql`; קובץ מאוחד `supabase/setup_all.sql`. טבלאות: `profiles, customers, products, orders, order_items, sync_logs, audit_log, crm_*` (categories, contacts, customers, deals, invoices, leads, reps, sales, templates), `catalog_products`. בדיקות: `supabase/tests/auth_stub.sql` + `test_rls.sql`. |
| SMART CRM | Postgres (Drizzle ORM; Supabase בפרודקשן) | `smart-crm/supabase/migrations/2026101900*–20261021*.sql` (15 קבצים), bundle ב-`smart-crm/supabase/deploy/all-migrations.sql`, סכמת Drizzle נוצרת ב-`smart-crm/src/server/db/schema.ts` (`npm run db:generate` / `db:check`). |
| voice-agents | **אין DB** — קבצים: `agents/*.json` (`FileAgentStore`), `data/calls/*.json` (`CallRegistry`) | `.gitignore` של voice-agents מתעלם מ-`engine/data/` ו-`*.db`. |

> **פער כיסוי קיים (לא שלנו לתקן):** ה-job `rls` ב-`.github/workflows/ci.yml` מריץ רק את 3 ה-migrations הראשונות (`...000000_init`, `...000001_invite_linking`, `...000002_harden_writes`), ולא את `000003`–`000005` (grants, crm, catalog).

## 9. אימות (Authentication)

- **Kerem Orders:** Supabase Auth דרך הבקנד (`backend/app/routers/auth.py`: `/auth/signup`, `/auth/login`, `/auth/refresh-token`, `/auth/me`, `/auth/reset-password`). ב-`backend/app/dependencies.py` יש `HTTPBearer` → `get_current_user` → `require_admin`. אכיפה דו-שכבתית: RLS ב-DB + dependencies ב-FastAPI (`docs/architecture.md`).
- **SMART CRM:** `smart-crm/src/server/auth/` — `AUTH_PROVIDER` ∈ `local` (פיתוח בלבד; `env.ts` חוסם אותו בפרודקשן) / `supabase`; כולל `totp.ts` (2FA), `login-limits.ts`, `recovery.ts`, `password.ts`. RBAC ב-`src/server/rbac/`. ל-API ציבורי (`/api/v1/*`) יש מפתחות API (מודול `api`).
- **voice-agents:** `Authorization: Bearer <ENGINE_API_KEY>` אחד וגלובלי (סעיף 4.4). Webhooks של Twilio מאומתים בחתימה (`TWILIO_VALIDATE_SIGNATURE`, ברירת מחדל `true`).

## 10. ניהול סודות

- `.gitignore` בשורש: `.env`, `.env.*` (חוץ מ-`!.env.example`), `*.pem`, `*.key`. ב-`smart-crm/.gitignore` יש `.env*`. ב-voice-agents `.gitignore`: `.env`, `.env.*`, `!.env.example`.
- קבצי דוגמה (שמות משתנים בלבד):
  - `backend/.env.example`: `ENVIRONMENT, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RIVHIT_API_TOKEN, RIVHIT_API_BASE_URL, SYNC_ENABLED, SYNC_INTERVAL_HOURS, RESEND_API_KEY, EMAIL_FROM, ADMIN_NOTIFICATION_EMAIL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ALLOWED_ORIGINS`. בקוד יש גם `RIVHIT_WRITE_ENABLED`, `RIVHIT_QUOTE_DOCUMENT_TYPE`, `ENABLE_CRM`, `ENABLE_CATALOG`, `CATALOG_RIVHIT_TOKEN`, `CATALOG_RIVHIT_BASE_URL`.
  - `frontend/.env.example`: `VITE_API_URL` (ובקוד גם `VITE_ENABLE_CRM`, `VITE_ENABLE_CATALOG`).
  - `smart-crm/.env.example`: `APP_ENV, APP_URL, LOG_LEVEL, DATABASE_URL, DATABASE_POOL_MAX, ENCRYPTION_KEY, CRON_SECRET, AUTH_PROVIDER, AUTH_SIGNUP_LIMIT_PER_HOUR, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STORAGE_PROVIDER, LOCAL_STORAGE_DIR, SUPABASE_STORAGE_BUCKET, EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM, AI_PROVIDER, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_PRICE_INPUT_PER_1M, OPENAI_PRICE_OUTPUT_PER_1M, WHATSAPP_PROVIDER, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN, META_GRAPH_VERSION, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BILLING_PROVIDER, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, BILLING_LIVE_MODE`.
  - voice-agents `engine/.env.example`: ראו סעיף 7.
- בפרודקשן הסודות אמורים לחיות ב-env vars של Railway / Vercel (`docs/architecture.md`, כלל 4). את הערכים בפועל לא ניתן לאמת מכאן.
- ב-voice-agents, כלי webhook מרחיבים `${ENV_VAR}` בכותרות (`webhook.py`, `expand_env`), כדי שסודות לא יישבו בקובצי הסוכנים.
- לא נמצאו קבצי `.env` בריפו (`git ls-files` מכיל רק `.env.example`).

## 11. ממשקי API קיימים (תמצית)

**Kerem Orders (`backend/app/routers/*.py`):**
`GET /health`; `/auth/{signup,login,refresh-token,me,reset-password}`; `GET /products`, `GET /products/categories`, `GET /products/{id}`; `POST /orders`, `GET /orders`, `GET /orders/{id}`; `/admin/stats`, `/admin/orders[/{id}]` (GET/PATCH), `/admin/customers`, `POST /admin/customers/invite`, `/admin/users[/{id}]`; `POST /admin/orders/{id}/quote`, `POST /admin/orders/{id}/quote/confirm`; `POST /admin/sync`, `GET /admin/sync/logs`; `/crm/{entity}` CRUD + `/crm/analytics/summary`, `/crm/insights/{leads,reps,collections}`; `GET /catalog/products`, `POST /catalog/sync`; ו-SPA catch-all `/{full_path:path}`.

**SMART CRM (`smart-crm/src/app/api/**/route.ts`):**
`/api/health`; `/api/v1/{companies,contacts,deals,tasks}[/{id}]`, `/api/v1/me`; `/api/webhooks/whatsapp`, `/api/webhooks/billing`; `/api/cron/jobs`; `/api/automations/hooks/[token]`; `/api/attachments`, `/api/files/[id]`, `/api/files/raw`; `/api/quotes/[id]/pdf`; `/api/analytics/export`, `/api/contacts/export`. בנוסף Server Actions. מפרט: `smart-crm/docs/API.md`, `smart-crm/docs/openapi.json`.

**voice-agents (`engine/app/server.py`, העותק בענף):**
`GET /health`; `POST /twilio/voice?agent=`, `POST /twilio/status`, `WS /twilio/stream` (חתימת Twilio); ובמפתח מנוע: `POST /calls` (מחייג), `GET /calls/{id}`, `GET /agents`, `POST /agents/{id}/prompt` (קריאה בלבד), `POST /agents/{id}/chat` (מפעיל כלים).
`docs/API.md` מתעד גם `GET/PUT/DELETE /agents/{id}`, `POST /agents`, `GET /calls?limit=`, `GET /meta` — **שלא קיימים ב-`server.py` שבענף.** זה סימן שהגרסה החיה מתקדמת יותר מהעותק.

## 12. שירותי רקע

- **Kerem Orders:** `backend/app/scheduler.py` — `sync_loop()` מסנכרן מוצרים ולקוחות מ-Rivhit כל `SYNC_INTERVAL_HOURS` (ברירת מחדל 4) בתוך `asyncio.to_thread`; פועל רק כש-`SYNC_ENABLED=true`, ונעצר אם ה-interval קטן או שווה ל-0.
- **SMART CRM:** `smart-crm/src/worker/main.ts` (`npm run worker`) — worker ארוך-חיים שתופס jobs ב-`SKIP LOCKED`, מריץ `runScheduler()` כל דקה ומשחזר נעילות תקועות (`src/server/jobs/{queue,runner,scheduler,registry,maintenance}.ts`). מבצע שליחות WhatsApp, אוטומציות, תזכורות, webhooks יוצאים, מחזור חיי billing ו-retention (לפי `smart-crm/Dockerfile.worker`). בנוסף Vercel Cron: `/api/cron/jobs` פעם ביום, `0 3 * * *` (`smart-crm/vercel.json`).
- **voice-agents:** אין worker. השיחות רצות בתוך תהליך ה-FastAPI (WebSocket).

## 13. פריסה (Deployment)

| רכיב | קונפיג | מה הוא עושה |
|---|---|---|
| Kerem Orders (API + SPA) | `railway.json` (שורש): `builder: DOCKERFILE`, `dockerfilePath: backend/Dockerfile`, `healthcheckPath: /health` | Dockerfile רב-שלבי: שלב Node בונה `frontend/` (עם `VITE_ENABLE_CRM=1`, `VITE_ENABLE_CATALOG=1`), ושלב Python 3.11 מתקין `backend/requirements.txt` ומעתיק **רק** `backend/app` ו-`dist`. ה-build context הוא שורש הריפו. |
| חלופה | `backend/railway.toml` (NIXPACKS) | לפי ההערה בקובץ: נקרא רק אם Root Directory = `backend`. |
| Frontend (Vercel) | `frontend/vercel.json` — rewrite של SPA | `docs/architecture.md` מציין Vercel, ו-CORS כולל דומיין `*.vercel.app`. |
| SMART CRM web | `smart-crm/vercel.json` — `framework: nextjs`, `regions: ["fra1"]`, cron, `maxDuration` | — |
| SMART CRM worker | `smart-crm/railway.worker.json` → `smart-crm/Dockerfile.worker` (`restartPolicyType: ALWAYS`) | — |
| voice-agents | **אין Dockerfile או קונפיג פריסה בעותק שבענף** | איפה ואיך הוא רץ בפרודקשן — לא ידוע. |
| `.dockerignore` (שורש) | חוסם `node_modules`, `.env`, `backend/tests`, `docs`, `supabase`, `.github`, `.git` וכו' | **לא** חוסם את `noa-personal-bridge/`. זה לא משפיע על ה-image, כי ה-Dockerfile מעתיק נתיבים מפורשים בלבד, אבל התיקייה כן נכנסת ל-build context. |

> **סיכון פריסה עקיף (לא ניתן לאמת מהקוד):** ב-`railway.json` אין `watchPatterns`. אם השירותים ב-Railway/Vercel מחוברים ל-`main` עם auto-deploy, מיזוג commit של הגשר ל-`main` יפעיל build ו-deploy מחדש של Kerem Orders ושל ה-frontend, עם תוכן image זהה. ראו INTEGRATION_PLAN.

## 14. בדיקות קיימות

| רכיב | בדיקות | איך CI מריץ |
|---|---|---|
| backend | 13 קבצים ב-`backend/tests/` (137 בדיקות) | `ci.yml` job `backend`: Python 3.11, `pip install -r requirements-dev.txt`, `python -m pytest tests/ -v` מתוך `backend/` |
| supabase RLS | `supabase/tests/test_rls.sql` (+`auth_stub.sql`) | `ci.yml` job `rls`: שירות postgres:16, `psql -f` על 3 migrations + הבדיקה |
| frontend | אין בדיקות יחידה; lint + build | `ci.yml` job `frontend`: Node 22, `npm ci && npm run lint && npm run build` |
| smart-crm | `tests/unit` (12 קבצים, 164 בדיקות), `tests/integration` (28 קבצים, דורש Postgres), `tests/e2e` (13 specs של Playwright, דורש Postgres) | `smart-crm.yml`: `npm ci` → בדיקת קבצים מחוללים (`i18n:index`, `db:bundle` + `git diff --exit-code`) → `typecheck` → `lint` → `test:unit` → `test:integration` → schema drift (`db.ts reset` + `db:check`) → `build` → Playwright e2e |
| voice-agents (ענף) | `engine/tests/` — 5 קבצים, 60 בדיקות (כולל parametrize) | אין workflow בענף |

תוצאות הבסיס בפועל: `BASELINE_REGRESSION.md`.

## 15. תלויות בין רכיבים

- `frontend` → `backend` (HTTP דרך `VITE_API_URL`, או אותו דומיין כשה-SPA מוגש מה-backend).
- `backend` → Supabase (DB + Auth, `supabase-py`), Rivhit (`rivhit_service.py` בלבד), Resend, Telegram.
- `backend/Dockerfile` תלוי ב-`frontend/` (שלב build). כלומר **שינוי ב-`frontend/` משנה את ה-image של ה-backend.**
- `smart-crm` (web + worker) → Postgres/Supabase, Meta Graph API, OpenAI, Resend, Stripe, Google OAuth (לפי env). **אין תלות** בין `smart-crm` ל-`backend`/`frontend` (CI נפרד, פריסה נפרדת).
- voice-agents → Twilio, ElevenLabs, Anthropic, Morning/Green Invoice, webhooks ו-MCP חיצוניים. ב-`kerem-toys-orders.json` יש הערת ידע "...או לחבר כלי חיפוש מוצרים מהמערכת של Kerem Orders" — כלומר יש **כוונה** לחבר את NOA ל-Kerem Orders, אבל בעותק אין חיבור כזה בפועל.
- `noa-personal-bridge` (חדש) → voice-agents (`POST /agents/{id}/prompt` בלבד, לפי התכנון) + Anthropic. אין תלות ב-`backend/`, `frontend/`, `smart-crm/` או `supabase/`.

---

## מה לא נמצא / לא ניתן לאמת

1. **הריפו החי `orikenenb-lgtm/voice-agents`** — לא נגיש מהסשן. כל המידע על NOA מבוסס על העותק בענף `origin/ccr-a60c5c0c-bohsof` (2026-10-27). יש ראיה ישירה שהגרסה החיה שונה: `docs/API.md` מתעד endpoints ו-`dashboard/` שלא קיימים בעותק. **לפני חיבור צריך לאמת מול הגרסה החיה** ש-`POST /agents/{id}/prompt` קיים, שהחוזה שלו זהה, ושהוא עדיין ללא תופעות לוואי.
2. **איזה `agent_id` הוא ה-NOA של המשתמש** בפרודקשן, ומה התוכן העדכני שלו (בעותק — `kerem-toys-orders` עם `[למלא: ...]`).
3. **כתובת הפריסה של המנוע וה-`ENGINE_API_KEY` שלו**, ואם יש ל-NOA צרכנים נוספים של אותו מפתח (dashboard, MCP של הפלטפורמה). זה חשוב לתוכנית rollback (רוטציית מפתח).
4. **קונפיג הפרודקשן ב-Railway / Vercel / Supabase:** ערכי env, האם auto-deploy מ-`main` דלוק, Watch Paths, Root Directory של כל שירות, ו-branch protection / required checks ב-GitHub.
5. **התקנה עריכה (editable) של voice-agents:** `pip install -e engine[dev]` נכשל בעותק (setuptools flat-layout; פירוט ב-BASELINE_REGRESSION). לא ידוע איך המנוע נבנה בפרודקשן.
6. **בדיקות שדורשות Postgres** (RLS של Kerem Orders, integration, drift ו-e2e של smart-crm) — לא הורצו בסביבה הזו (פירוט ב-BASELINE_REGRESSION).
7. אין בריפו שום תיעוד של "זיכרון" ל-NOA, של חיבור ל-WhatsApp אישי, או של קבלת הודעות WhatsApp נכנסות ב-voice-agents.

## דיאגרמת רכיבים

```mermaid
flowchart LR
  subgraph main["ai-assistant (main @ c4ce0d7) — ללא שינוי"]
    FE["frontend/<br/>React + Vite"]
    BE["backend/<br/>FastAPI Kerem Orders<br/>scheduler.py sync_loop"]
    SB[("Supabase<br/>supabase/migrations")]
    CRM["smart-crm/ web<br/>Next.js (Vercel)"]
    CRMW["smart-crm worker<br/>(Railway)"]
    CRMDB[("Postgres / Drizzle")]
  end

  subgraph va["voice-agents engine (ענף ccr-a60c5c0c / ריפו חי לא נגיש)"]
    API["FastAPI server.py<br/>Bearer ENGINE_API_KEY"]
    PROMPT["POST /agents/{id}/prompt<br/>קריאה בלבד"]
    CHAT["POST /agents/{id}/chat<br/>מפעיל כלים ⚠"]
    CALLS["POST /calls<br/>מחייג ⚠"]
    TOOLS["Toolbox: send_whatsapp, send_sms,<br/>transfer_call, issue_document,<br/>webhook, MCP"]
    FILES[("agents/*.json<br/>data/calls/*.json")]
  end

  subgraph bridge["noa-personal-bridge (חדש, נפרד)"]
    APP["Android app<br/>טיוטות בלבד, שליחה ידנית"]
    BS["bridge-service<br/>BRIDGE_ENABLED=false כברירת מחדל"]
  end

  FE -->|HTTP| BE
  BE --> SB
  BE -->|REST| RIV["Rivhit"]
  BE -->|התראות| NOTIF["Resend / Telegram"]
  CRM --> CRMDB
  CRMW --> CRMDB
  CRMW -->|Cloud API| META["Meta WhatsApp Cloud API<br/>(מספר עסקי)"]
  META -->|webhook| CRM
  CRM --> OAI["OpenAI"]

  API --> PROMPT
  API --> CHAT
  API --> CALLS
  CHAT --> TOOLS
  TOOLS --> TW["Twilio (Voice/SMS/WhatsApp)"]
  TOOLS --> MOR["Morning / Green Invoice"]
  CALLS --> TW
  API --> FILES
  API --> ANT["Anthropic"]
  API --> EL["ElevenLabs"]

  APP -->|HTTPS + device token| BS
  BS -->|POST /prompt בלבד (persona)| PROMPT
  BS -->|Messages API ללא tools| ANT
  BS -. לעולם לא .-> CHAT
  BS -. לעולם לא .-> CALLS
```
