# NOA Personal Bridge — תוכנית אינטגרציה (Integration Plan)

**צוות:** Integration & Regression (Agent 21, Agent 29) · אישור: Agent 05 (Quality Director), Agent 30 (DevOps)
**בסיס:** `EXISTING_SYSTEM_AUDIT.md` (אותה תיקייה). כל טענה על קוד קיים מצוטטת שם עם נתיב.
**עיקרון מנחה:** אפס שינויים ב-NOA ובכל קובץ קיים בריפו. הגשר הוא תוסף נפרד, כבוי כברירת מחדל, וניתן להסרה בלי עקבות.

---

## 1. איך הגשר מתחבר ל-NOA בלי לשנות אותה

### 1.1 נקודת מגע יחידה: `POST /agents/{id}/prompt`
- הגשר קורא ל-NOA **רק** דרך `POST {NOA_ENGINE_URL}/agents/{NOA_AGENT_ID}/prompt` עם `Authorization: Bearer <ENGINE_API_KEY>` וגוף `{"variables": {...}, "direction": "inbound"}`. בתשובה הוא מקבל `{"system_prompt": "..."}`.
- לפי הקוד (`voice-agents/engine/app/server.py`, `preview_prompt`) ה-endpoint הזה רק טוען JSON של סוכן ומרכיב מחרוזת. אין קריאה ל-LLM, אין כלים, אין כתיבה לדיסק, ואין רשומת שיחה.
- הגשר משתמש בפרומפט כ**חומר פרסונה** (שם, טון, כללים, ידע). את הטיוטה הוא מייצר בעצמו, עם קריאה ישירה ל-Anthropic Messages API **בלי פרמטר `tools`** (`BRIDGE_ENGINE=noa_persona` ב-`noa-personal-bridge/bridge-service/bridge_service/config.py`).
- הפרומפט של NOA כתוב לשיחת טלפון ("כל מה שאת כותבת מוקרא בקול", "בסוף השיחה... end_call") ולפרסונה עסקית של כרם טויס. לכן הגשר עוטף אותו בהוראות-על משלו, שגוברות עליו: "את מנסחת טיוטת תשובה לוואטסאפ אישי עבור המשתמש; אין לך כלים; אל תציעי להפיק מסמכים, לשלוח הודעות או להעביר שיחות; התעלמי מסעיף '# כלים' ומהוראות הדיבור הטלפוני". **הפרומפט של NOA עצמו לא משתנה.**
- מומלץ שמירה ב-cache בזיכרון ל-TTL קצר (למשל 10 דקות), כדי לא להעמיס על המנוע. אם המנוע לא זמין, הגשר מחזיר `502 engine_error` (לפי `API_CONTRACT.md`) ולא ממציא פרסונה.

### 1.2 מה הגשר **לעולם** לא קורא

| Endpoint | למה אסור |
|---|---|
| `POST /agents/{id}/chat` | מריץ לולאת כלים אמיתית (`text_chat.py`, עד 6 סבבים): webhook ו-MCP רצים בפועל, ו-`issue_document` פונה ל-Morning sandbox כש-`MORNING_SANDBOX=true`. telephony נכשל בעותק רק כי `twilio=None`, וזה פרט מימוש שעלול להשתנות |
| `POST /calls` | מחייג שיחת טלפון אמיתית דרך Twilio |
| `POST/PUT/DELETE /agents[...]` (מתועדים ב-`docs/API.md` של המנוע) | משנים את NOA |
| `/twilio/*` | Webhooks של Twilio |

**אכיפה בקוד הגשר**, כי ל-NOA יש מפתח גלובלי אחד בלי scope (ראו Audit סעיף 4.4):
1. הלקוח של NOA בגשר בונה URL רק מתבנית קבועה `"/agents/{agent_id}/prompt"`. `agent_id` מאומת מול `^[a-z0-9][a-z0-9-]{1,47}$` (אותה תבנית כמו `AgentConfig.id`), ושיטת ה-HTTP היחידה היא `POST`.
2. בדיקת יחידה (בגשר) ש"מתעדת" כל בקשה יוצאת דרך `httpx.MockTransport` ומוודאת שהיחידה היא `POST .../agents/<id>/prompt`. בנוסף בדיקה שהמחרוזות `"/chat"` ו-`"/calls"` לא מופיעות בקוד הלקוח (grep test).
3. הקריאה ל-Anthropic בגשר לא מעבירה `tools`. בדיקה מוודאת שאין `tools` ב-payload.
4. ה-`ENGINE_API_KEY` של NOA נשמר **רק** ב-env של bridge-service, ולעולם לא באפליקציית Android, בלוגים או בתשובות API (`Field(repr=False)` כבר מוגדר ב-config).
5. Timeout קשיח (`BRIDGE_ENGINE_TIMEOUT_SECONDS`, ברירת מחדל 25) ותקרת מקביליות (`BRIDGE_MAX_CONCURRENT_DRAFTS`).

### 1.3 משתנים שהפרומפט דורש
- `call_values()` זורק 422 אם חסר משתנה חובה. ב-`kerem-toys-orders` אין משתני חובה. ב-`personal-assistant` חובה `on_behalf_of`, `task_topic`, `task_goal`.
- הגשר שולח `variables` קבועים מהקונפיג (למשל `on_behalf_of = BRIDGE_OWNER_DISPLAY_NAME`) ו-`direction: "inbound"`. **תוכן הודעות WhatsApp לא נשלח ל-NOA לעולם.** הוא עובר רק ל-Anthropic, בתוך בקשת הטיוטה.

### 1.4 ללא NOA בכלל (מצב בטוח)
`BRIDGE_ENGINE=stub` (ברירת מחדל) או `anthropic` (פרסונה מקומית בגשר) לא פונים ל-NOA. כך אפשר לפתח ולבדוק את הגשר כולו בלי מפתח של המנוע.

## 2. שירות נפרד

- קוד: `noa-personal-bridge/bridge-service/` (Python, FastAPI) ו-`noa-personal-bridge/android/` (Kotlin). אין import, אין קובץ משותף, ואין תלות בחבילות של `backend/`, `frontend/`, `smart-crm/`, `supabase/` או voice-agents.
- אחסון: SQLite מקומי של הגשר (`BRIDGE_DB_PATH`, ברירת מחדל `data/bridge.sqlite3`) רק ל-device tokens (hash), קודי צימוד ו-nonces. **לא** Supabase של Kerem Orders ו**לא** Postgres של smart-crm.
- פריסה: שירות **חדש ונפרד** (למשל שירות Railway חדש עם Root Directory = `noa-personal-bridge/bridge-service` ו-Dockerfile משלו בתוך התיקייה). **אסור** להשתמש בשירות ש-`railway.json` בשורש מגדיר, ואסור לשנות את `railway.json`, `backend/railway.toml`, `backend/Dockerfile`, `.dockerignore`, `frontend/vercel.json` או `smart-crm/*.json`.
- רשת: הגשר מאזין כברירת מחדל ל-`127.0.0.1:8787` (`BRIDGE_HOST`/`BRIDGE_PORT`). חשיפה לאינטרנט רק מאחורי HTTPS. `BRIDGE_TRUST_PROXY_HEADERS=true` רק מאחורי proxy בשליטתנו.

## 3. CI — workflow נפרד עם path filters

### 3.1 מה קיים (אומת מול הקבצים)

| Workflow | Triggers | Concurrency | מושפע מקבצי הגשר? |
|---|---|---|---|
| `.github/workflows/ci.yml` ("CI") | `push: branches: ["**"]` + `pull_request` (כל PR), **בלי path filters** | אין | **רץ** על כל push/PR, כולל commits של הגשר. ה-jobs שלו (`backend`, `rls`, `frontend`) קוראים רק את `backend/`, `supabase/`, `frontend/`, ולכן התוצאה זהה. זה יתרון: ה-workflow הזה משמש כ-regression guard אוטומטי על כל PR של הגשר. |
| `.github/workflows/smart-crm.yml` ("SMART CRM AI") | `push`/`pull_request` עם `paths: ["smart-crm/**", ".github/workflows/smart-crm.yml"]` | `smart-crm-${{ github.ref }}` | **לא רץ** על commits שנוגעים רק ב-`noa-personal-bridge/**`, `docs/**` או `.github/workflows/noa-personal-bridge.yml`. |
| `.github/workflows/noa-personal-bridge.yml` ("NOA Personal Bridge") — **כבר קיים ב-HEAD (נוסף ב-commit `3eebc89`)** | `push`/`pull_request` עם `paths: ["noa-personal-bridge/**", ".github/workflows/noa-personal-bridge.yml"]` | `noa-bridge-${{ github.ref }}` | שני jobs: `bridge-service` (Python 3.12, pytest) ו-`android` (JDK 21, Gradle: `:core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`). `permissions: contents: read`, בלי deploy. |

### 3.2 למה קובץ workflow חדש לא משנה את הקיימים
- ב-GitHub Actions כל קובץ ב-`.github/workflows/` הוא workflow עצמאי. ה-triggers, ה-jobs וה-concurrency של `ci.yml` ו-`smart-crm.yml` מוגדרים רק בתוך הקבצים שלהם, ושניהם לא שונו (`git diff --stat main -- .github/workflows/ci.yml .github/workflows/smart-crm.yml` ריק).
- קבוצת ה-concurrency של הגשר (`noa-bridge-*`) שונה מ-`smart-crm-*`, ול-`ci.yml` אין concurrency. כלומר `cancel-in-progress` של הגשר לא יכול לבטל ריצות של workflows אחרים.
- ה-workflow של הגשר לא משתמש ב-`workflow_run`, `workflow_call`, secrets או artifacts של workflows אחרים, ולא כותב לריפו.
- דבר שלא ניתן לאמת מכאן: אם ב-branch protection של `main` מוגדרים required checks, צריך לוודא ש-"NOA Personal Bridge" **לא** יסומן כ-required. אחרת PRs שלא נוגעים בגשר ייתקעו (ה-workflow לא ירוץ עליהם בגלל path filters, והבדיקה תישאר "Expected"). זו הגדרה ב-GitHub UI, לא בקוד.

### 3.3 שערי איכות לכל PR של הגשר
1. "NOA Personal Bridge" ירוק.
2. "CI" (`ci.yml`) ירוק, עם אותן ספירות כמו ב-`BASELINE_REGRESSION.md` (backend: 137 passed).
3. `git diff --stat origin/main -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'` ריק. זו הבדיקה שמוכיחה שלא נגענו בקוד קיים.

## 4. Feature flag ו-kill switch

- `BRIDGE_ENABLED` — ברירת מחדל `false` (`config.py`: `enabled: bool = False`). כשהוא כבוי, `/v1/pair` ו-`/v1/drafts` מחזירים `503 disabled` (`API_CONTRACT.md`). `/health` מדווח `"enabled": false`.
- `BRIDGE_KILL_SWITCH_FILE` — אם הקובץ קיים, השירות מתנהג כמו כבוי, בלי restart.
- `BRIDGE_ENGINE` — `stub` (ברירת מחדל, בלי רשת), `anthropic`, או `noa_persona` (רק אז יש פנייה ל-NOA).
- הדגלים האלה חיים רק בגשר. אין דגל חדש ב-NOA, ב-backend או ב-smart-crm.

## 5. משתני סביבה (שמות בלבד)

**bridge-service** (prefix `BRIDGE_`, מ-`noa-personal-bridge/bridge-service/bridge_service/config.py`; הקונפיג לא קורא `.env` אוטומטית — `env_file=None`):

| משתנה | תפקיד | סוד? |
|---|---|---|
| `BRIDGE_ENABLED` | מתג ראשי (ברירת מחדל `false`) | לא |
| `BRIDGE_KILL_SWITCH_FILE` | נתיב קובץ שמכבה את השירות | לא |
| `BRIDGE_DB_PATH` | SQLite של הגשר | לא |
| `BRIDGE_ENGINE` | `stub` / `anthropic` / `noa_persona` | לא |
| `BRIDGE_ANTHROPIC_API_KEY` | מפתח Anthropic **של הגשר** (מומלץ מפתח נפרד מזה של המנוע, למעקב עלויות ולרוטציה עצמאית) | **כן** |
| `BRIDGE_ANTHROPIC_MODEL` | ברירת מחדל `claude-haiku-5-5` | לא |
| `BRIDGE_NOA_ENGINE_URL` | בסיס ה-URL של מנוע voice-agents (HTTPS) | לא |
| `BRIDGE_NOA_ENGINE_API_KEY` | ה-`ENGINE_API_KEY` של NOA | **כן** (רגיש במיוחד — ראו 1.2) |
| `BRIDGE_NOA_AGENT_ID` | מזהה הסוכן (למשל `kerem-toys-orders` או סוכן אישי) | לא |
| `BRIDGE_ENGINE_TIMEOUT_SECONDS`, `BRIDGE_MAX_CONCURRENT_DRAFTS` | הגנות | לא |
| `BRIDGE_OWNER_DISPLAY_NAME` | שם המשתמש בפרומפט / משתנה `on_behalf_of` | לא |
| `BRIDGE_RATE_LIMIT_PER_MINUTE`, `BRIDGE_RATE_LIMIT_PER_DAY`, `BRIDGE_PAIRING_ATTEMPTS_PER_HOUR`, `BRIDGE_PAIRING_CODE_TTL_MINUTES`, `BRIDGE_REPLAY_WINDOW_SECONDS`, `BRIDGE_IDEMPOTENCY_TTL_SECONDS`, `BRIDGE_MAX_BODY_BYTES`, `BRIDGE_MEMORY_MAX_ENTRIES` | מגבלות שימוש לרעה | לא |
| `BRIDGE_TRUST_PROXY_HEADERS`, `BRIDGE_DEBUG_DOCS`, `BRIDGE_HOST`, `BRIDGE_PORT`, `BRIDGE_ACCESS_LOG`, `BRIDGE_LOG_LEVEL` | HTTP / לוגים | לא |

**Android:** רק כתובת השרת (נקבעת בצימוד). ה-device token נשמר מוצפן במכשיר. אין באפליקציה מפתח Anthropic או מפתח של NOA.

**אין צורך באף משתנה חדש** ב-`backend/`, `frontend/`, `smart-crm/` או ב-voice-agents.

## 6. מה המשתמש צריך להגדיר בצד NOA

רק שני ערכים, לשימוש לקריאה בלבד, **בלי לשנות שום קובץ, קונפיג או פריסה של NOA:**
1. **`ENGINE_API_KEY` קיים** של המנוע (מועבר ל-`BRIDGE_NOA_ENGINE_API_KEY`). אם המנוע רץ בלי `ENGINE_API_KEY`, ה-API שלו סגור (401) והגשר יעבוד רק ב-`stub`/`anthropic`. **אנחנו לא מבקשים להגדיר מפתח חדש במנוע**, כי זה שינוי ב-NOA.
2. **`agent_id`** של הסוכן שמהווה את NOA (מועבר ל-`BRIDGE_NOA_AGENT_ID`), ו-URL הבסיס של המנוע.

ובנוסף צריך החלטה של המשתמש, כי בעותק שבענף "נועה" היא נציגת מכירות של כרם טויס (`kerem-toys-orders`):
- האם הטון והכללים של הסוכן העסקי מתאימים לוואטסאפ האישי? אם לא — `BRIDGE_ENGINE=anthropic` עם פרסונה מקומית בגשר, או סוכן אחר ב-NOA שהמשתמש יוצר בעצמו בכלים הקיימים שלו (מחוץ להיקף שלנו).
- אימות מול הריפו החי `orikenenb-lgtm/voice-agents` (לא נגיש לנו): ש-`POST /agents/{id}/prompt` קיים שם, עם אותו חוזה, ועדיין ללא תופעות לוואי. **זה תנאי לפני הפעלת `BRIDGE_ENGINE=noa_persona`.**

**הסבר למשתמש על המפתח:** ה-`ENGINE_API_KEY` של NOA פותח גם חיוג (`/calls`) וגם הפעלת כלים (`/chat`). הגשר מתחייב בקוד ובבדיקות להשתמש רק ב-`/prompt`, אבל מי שמשיג את המפתח מהשרת של הגשר יקבל את כל ההרשאות. לכן המפתח נשמר רק ב-env של השרת, ואם יש חשד לדליפה — עוברים מיד ל-`BRIDGE_ENGINE=stub` ומבצעים רוטציה במנוע (ראו סעיף 8).

## 7. חלופות שנשקלו

| חלופה | החלטה | נימוק |
|---|---|---|
| להוסיף routes ל-`backend/` (Kerem Orders) | **נדחתה** | נוגע בשירות פרודקשן של הזמנות. `backend/Dockerfile` ו-`railway.json` פורסים את ה-API יחד עם ה-SPA, כך שכל שינוי מסכן את Kerem Orders. ה-backend משתמש ב-Supabase עם service role ו-RLS, וכל טבלה חדשה היא migration בפרודקשן. בנוסף זה מערבב אחריות (הזמנות סיטונאיות מול הודעות אישיות) ותוכן פרטי. |
| להשתמש במודול WhatsApp Cloud API של `smart-crm` | **נדחתה** | `smart-crm/src/modules/whatsapp/provider.ts`: "Only the official Meta WhatsApp Cloud API is supported". זה דורש WABA, מספר עסקי ואישור Meta, ו**לא עובד על המספר האישי** של המשתמש. מספר שעובר ל-Cloud API מפסיק לעבוד באפליקציית WhatsApp הרגילה. בנוסף smart-crm רב-דיירי, עם DB ו-worker פרודקשן משלו. |
| לקרוא ל-`POST /agents/{id}/chat` של NOA | **נדחתה** | מריץ כלים אמיתיים (Audit 4.3), עולה כסף ב-Anthropic של המנוע, חוזר 422 על סוכן עם `[למלא: ...]`, ושולח את תוכן ההודעות הפרטיות לתוך המנוע (ולוגים אפשריים בכלים). |
| כלי `send_whatsapp` של voice-agents (Twilio) | **נדחתה** | שולח הודעות מ-Twilio sender עסקי, לא מהמספר האישי. ובנוסף, הגשר בכוונה **לא שולח שום הודעה**. השליחה מתבצעת ידנית בטלפון, אחרי אישור. |
| לשנות את NOA ולהוסיף endpoint ייעודי או מפתח read-only | **נדחתה (בשלב הזה)** | מפר את דרישת "אפס שינויים ב-NOA". אפשר להציע את זה למשתמש כשיפור עתידי בריפו של NOA, אבל לא כחלק מהפרויקט. |
| להעתיק את טקסט הפרסונה ידנית לגשר (`BRIDGE_ENGINE=anthropic`) | **נשמרה כ-fallback** | אפס פנייה ל-NOA ואפס מפתח של NOA. החיסרון: אין סנכרון אוטומטי עם עדכוני הפרסונה. |

## 8. Rollback

לפי סדר, מהקל לכבד. כל שלב עצמאי, ואף אחד לא נוגע במערכת קיימת:
1. **כיבוי מיידי:** ליצור את הקובץ ש-`BRIDGE_KILL_SWITCH_FILE` מצביע עליו (בלי restart), או `BRIDGE_ENABLED=false` ו-restart. כל `/v1/*` מחזיר 503.
2. **ניתוק מ-NOA:** `BRIDGE_ENGINE=stub` ומחיקת `BRIDGE_NOA_ENGINE_API_KEY` מה-env של הגשר. NOA לא מושפעת, כי היא אף פעם לא ידעה על הגשר.
3. **ביטול מכשירים:** "ניתוק מלא" באפליקציה (`POST /v1/devices/revoke`), או מחיקת קובץ ה-SQLite של הגשר.
4. **עצירת השירות:** כיבוי או מחיקה של שירות הגשר בפלטפורמת הפריסה. השירותים הקיימים (Kerem Orders, smart-crm, voice-agents) לא תלויים בו.
5. **הסרת קוד:** `git revert` של commits הגשר. הם מוסיפים רק `noa-personal-bridge/**`, `docs/noa-personal-bridge/**` ו-`.github/workflows/noa-personal-bridge.yml`, כך שה-revert לא יכול להתנגש בקוד קיים. אחרי ה-revert צריך לוודא שוב שה-diff מול `main` שמחוץ לתיקיות האלה ריק, ושה-CI הקיים ירוק עם אותן ספירות.
6. **אם מפתח NOA דלף:** רוטציה של `ENGINE_API_KEY` במנוע. **שימו לב:** זו פעולה בצד NOA, והיא תשבור צרכנים אחרים של אותו מפתח (dashboard / MCP, אם קיימים — לא ידוע לנו). מתבצעת רק ע"י המשתמש, בתיאום.
7. **Android:** הסרת האפליקציה מהטלפון מבטלת את הרשאת ה-Notification Listener שלה.

## 9. סיכוני פריסה עקיפים והמלצות (בלי לשנות קבצים קיימים)

- **Auto-deploy ממיזוג ל-`main`:** אם Railway (`railway.json` → Kerem Orders) ו-Vercel (`frontend/`, `smart-crm/`) מחוברים ל-`main` בלי Watch Paths, מיזוג של הגשר יגרום ל-rebuild ול-redeploy שלהם. התוכן זהה, כי ה-Dockerfile מעתיק רק `frontend/` ו-`backend/app`, אבל עדיין יש redeploy, ו-downtime רגעי אפשרי. **המלצה:** שהמשתמש יגדיר Watch Paths / Ignored Build Step **בממשק** של Railway/Vercel (לא בקוד), או ימזג בחלון זמן שקט. לא משנים את `railway.json`.
- **Build context:** `.dockerignore` לא מחריג את `noa-personal-bridge/`. זה לא משפיע על ה-image. קבצי build של Android (`android/app/build`, `.gradle`, `local.properties`) מוחרגים ב-`noa-personal-bridge/android/.gitignore` (אומת עם `git check-ignore`), ולכן לא יגיעו ל-git ול-context של Railway.
- **`ci.yml` רץ על כל push:** עלות דקות CI קטנה נוספת לכל commit של הגשר. זה מקובל, ואף רצוי כ-regression guard.

## 10. סדר הפעלה מומלץ

1. מיזוג הקוד כש-`BRIDGE_ENABLED=false`, ואימות ש-"CI" ירוק עם אותן ספירות כמו בבסיס.
2. פריסת bridge-service כשירות נפרד עם `BRIDGE_ENGINE=stub`, ובדיקת `/health`.
3. צימוד מכשיר אחד, ו-`BRIDGE_ENABLED=true` עם `stub` (טיוטות מדומות).
4. `BRIDGE_ENGINE=anthropic` (בלי NOA).
5. רק אחרי אימות מול הריפו החי ואישור המשתמש: `BRIDGE_ENGINE=noa_persona` עם `BRIDGE_NOA_ENGINE_URL`, `BRIDGE_NOA_ENGINE_API_KEY`, `BRIDGE_NOA_AGENT_ID`.
