# גרף תלויות — משימות ורכיבים

## תלויות בין רכיבים (Runtime)

```mermaid
flowchart RL
    WA["WhatsApp האישי<br/>(com.whatsapp)"] -- "התראה (MessagingStyle)" --> NLS["NoaNotificationListenerService"]
    NLS -- "NotificationSnapshot" --> CORE["core: BridgeCoordinator<br/>Filter · Dedup · Debounce 15s · StateMachine · ApprovalGuard"]
    NLS -- "Reply action" --> REG["ReplyActionRegistry<br/>(זיכרון בלבד)"]
    CORE -- "DraftRequest" --> API["BridgeApiClient (OkHttp, TLS)"]
    API -- "POST /v1/drafts" --> SVC["bridge-service (FastAPI)<br/>Auth · Replay · RateLimit · Idempotency"]
    SVC --> ENG["ai: DraftEngine<br/>stub / anthropic / noa_persona<br/>ללא כלים"]
    ENG -. "POST /agents/{id}/prompt (קריאה בלבד)" .-> NOA["מנוע נועה (voice-agents)<br/>לא משתנה"]
    ENG -. "Messages API ללא tools" .-> LLM["Claude"]
    CORE -- "StateFlow&lt;Draft&gt;" --> UI["Compose UI (עברית, RTL)"]
    UI -- "approve → sendApproved" --> CORE
    CORE -- "רק עם אישור תקף" --> SND["RemoteInputReplySender"]
    SND -- "PendingIntent.send" --> WA
    NOA -. "אסור: /agents/{id}/chat (מריץ כלים)" .-x SVC
```

## תלויות בין משימות (Build)

```mermaid
flowchart TD
    P0["Phase 0: הגנת Repository + ענף"] --> P1["Phase 1: שלד Gradle + חוזים<br/>Model.kt · Api.kt · AppController.kt · API_CONTRACT.md · ai/base.py"]
    P1 --> A["Core (סוכן 07,10,15,22)"]
    P1 --> B["Android Platform (06,08,09,12,24)"]
    P1 --> C["Android UI (11,31)"]
    P1 --> D["Backend API (18,19,20,22)"]
    P1 --> E["AI Adapter (13–17)"]
    P0 --> F["מחקר היתכנות (34,08,09,12)"]
    P0 --> G["Audit + Baseline (21,29,05,30)"]
    A --> I["אינטגרציה + APK (מנהל־העל)"]
    B --> I
    C --> I
    D --> I2["אינטגרציית שרת"]
    E --> I2
    I --> W2["גל 2: ביקורת קוד, אבטחה, QA, ביצועים, נגישות, תיעוד"]
    I2 --> W2
    F --> W2
    G --> W2
    W2 --> FIX["תיקונים + אימות חוזר"]
    FIX --> GATE["שער: עצירה לפני ניסוי שליחה אמיתי — דורש אישור המשתמש"]
```

## בעלות על קבצים (מונעת עריכה כפולה)

| נתיב | בעלים | הערות |
|---|---|---|
| `android/core/src/main/.../Model.kt`, `Api.kt` | 04 (אדריכל) | חוזה — שינוי חתימה רק דרך `DECISION_LOG.md` |
| `android/core/**` (שאר) | צוות Core | |
| `android/app/.../AppController.kt` | 04 (אדריכל) | חוזה UI↔Platform |
| `android/app/.../platform/**`, `BridgeApplication.kt`, `AndroidManifest.xml`, `res/xml/**`, `src/debug/**` | צוות Platform | |
| `android/app/.../ui/**`, `MainActivity.kt`, `res/values*/**`, `res/drawable/**`, `res/mipmap*/**` | צוות UI | |
| `android/*.gradle.kts`, `gradle/**` | מנהל־העל (30) | הוספת תלויות בתיאום |
| `bridge-service/bridge_service/ai/base.py` | 04 (אדריכל) | חוזה |
| `bridge-service/bridge_service/ai/**` | צוות AI | |
| `bridge-service/` (שאר) | צוות Backend | |
| `noa-personal-bridge/API_CONTRACT.md` | 04 (אדריכל) | |
| `docs/noa-personal-bridge/ANDROID_FEASIBILITY.md` | צוות מחקר (34) | |
| `docs/noa-personal-bridge/EXISTING_SYSTEM_AUDIT.md`, `INTEGRATION_PLAN.md`, `BASELINE_REGRESSION.md` | צוות Audit (21,29) | |
| שאר `docs/noa-personal-bridge/*` | מנהל־העל / תיעוד (32) | |
| כל קובץ קיים מחוץ ל־`noa-personal-bridge/` ו־`docs/noa-personal-bridge/` | **אסור לשינוי** | למעט קובץ CI חדש |
