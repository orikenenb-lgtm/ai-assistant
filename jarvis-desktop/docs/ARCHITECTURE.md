# ארכיטקטורה

## התמונה הכללית

```
┌──────────────────────── Renderer (Chromium, sandbox, בלי Node) ────────────────────────┐
│  HUD (React) · הגדרות · Controller (זרימת קול)                                        │
│  שכבת אודיו: מיקרופון → VAD → WAV 16kHz · השמעה + waveform · קול מערכת · מילת הפעלה   │
│                     │  window.jarvis  (contextBridge, API סגור וקפוא)                  │
└─────────────────────┼──────────────────────────────────────────────────────────────────┘
                      │ IPC: ערוצים קבועים, אימות שולח + zod לכל בקשה
┌─────────────────────┼──────────────── Main (Node 24 ב-Electron 44) ────────────────────┐
│  ipc.ts ──► ConversationEngine ──► LlmClient (Claude, tool calling)                    │
│               │  ToolRegistry (zod strict) ─► Policy/Approvals ─► ActionLog (dedupe)   │
│               ▼                                                                        │
│  כלים: open_application · open_project · get_system_status · create/list/complete_task│
│         create/list/cancel_reminder · capture_screen_for_analysis                      │
│               │                                                                        │
│  שירותים: Launcher (spawn בלי shell / shell.openPath) · SystemStatus · ScreenCapture   │
│           VisionAnalyzer (Claude, בלי כלים) · VoiceService (STT/TTS) · Porcupine       │
│           ReminderScheduler + Notifier · SQLite (node:sqlite) · Settings · SecretStore │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## עקרונות

1. **ה-renderer לא סומך על עצמו.** אין לו Node, `require`, מערכת קבצים, מפתחות או רשת. CSP קשיח קובע `connect-src 'self'`, כך שכל קריאה לענן יוצאת מ-main.
2. **המודל מציע, הקוד מחליט.** המודל מקבל רק 10 כלים עם סכמה קשיחה (`strict: true`, `additionalProperties: false`). כל קריאה עוברת כמה בדיקות:
   - אימות zod מקומי, עם המגבלות המלאות.
   - בדיקה שהכלי קיים.
   - מדיניות הרשאות.
   - אישור חד-פעמי, כשנדרש.
   - בדיקת כפילות.
   - timeout וביטול.
3. **אין shell.** פתיחת תוכנה משתמשת ב-`spawn(file, args, { shell: false })`. הקובץ והארגומנטים מגיעים רק מההגדרות שהמשתמש שמר, ולא מטקסט של המודל. פתיחת פרויקט משתמשת ב-`shell.openPath`, שמשתמש בשיוך הקבצים של Windows. ESLint חוסם `exec` ו-`shell: true` בכל `src/main`.
4. **תוצאה מאומתת ≠ טקסט המודל.** אירוע ה-`response` מכיל שני חלקים נפרדים:
   - `text`: מה שהמודל ניסח.
   - `actions[]`: מה שהקוד המקומי ביצע ואימת בפועל. ה-HUD מסמן אותו "✓ אומת ע״י הכלי".
5. **ענן הוא אופציה, לא תנאי.** פתיחת תוכנה, שמירת משימה ותזכורת ומצב מערכת עובדים גם בלי מפתחות ובלי אינטרנט, דרך הפענוח המקומי (`local-intents.ts`).

## זרימת בקשה קולית

```
מיקרופון (לחיצה / Ctrl+Alt+J / מילת הפעלה)
  → LISTENING: AudioWorklet → VAD → שתיקה של 1.3 שניות
  → THINKING: הקלטת WAV נשלחת ל-main ← STT (בדיקת הד מול הטקסט שהוקרא לאחרונה)
  → assistant.submit
  → ConversationEngine:
      Claude (system + <app_context> + בקשה) → tool_use
      → אימות → מדיניות → (AWAITING_APPROVAL) → EXECUTING: הכלי רץ → tool_result
      → Claude מנסח תשובה על בסיס tool_result
  → response {text, actions}
  → SPEAKING: TTS ב-main → השמעה ב-renderer, עם waveform אמיתי
  → IDLE
```

**ביטול:** כפתור העצירה, `Esc` או המילה "עצור". הביטול:

- מבטל את בקשת ה-HTTP ל-Claude (AbortController).
- מבטל אישורים פתוחים.
- מסמן פעולות שעוד לא בוצעו כמבוטלות.
- לא מקריא תשובה.

## מצבי ה-HUD

| מצב | מתי בדיוק |
|---|---|
| `IDLE` | אין פעילות |
| `LISTENING` | המיקרופון מקליט בפועל (MediaStream פעיל) |
| `THINKING` | תמלול בתהליך, או קריאה ל-Claude בתהליך |
| `EXECUTING` | כלי רץ (פתיחת תוכנה, שמירה, צילום) |
| `SPEAKING` | אודיו מושמע בפועל |
| `AWAITING_APPROVAL` | יש בקשת אישור פתוחה |
| `ERROR` | התור האחרון נכשל. חוזר ל-IDLE אחרי 4 שניות |

הסדר בין מצבים חופפים נקבע בפונקציה טהורה, `deriveDisplayState`, שיש לה בדיקות יחידה.

## אחסון

| נתון | איפה | הערות |
|---|---|---|
| הגדרות | `settings.json` | מאומת ב-zod. קובץ פגום מגובה, לא נמחק |
| מפתחות | `secrets.json` | מוצפן ב-safeStorage (DPAPI). פענוח אסינכרוני בהפעלה |
| משימות, תזכורות, היסטוריה, יומן פעולות, שימוש | `jarvis.db` | `node:sqlite` (מובנה ב-Electron 44, בלי מודול נייטיבי), WAL, migrations לפי `user_version` |
| לוגים | `logs/*.log` | JSONL, צמצום מידע אישי, 7 ימים |

**מוכנות לסנכרון:** לכל רשומה יש `updated_at` ו-`deleted` (tombstone), ויש ממשק `SyncAdapter` (`src/main/db/sync.ts`). הסנכרון עצמו ל-Supabase מתוכנן ל-V2. JARVIS לא תלוי בענן כדי לשמור.

## תזכורות

- **מועד:** נשמר ב-UTC. הפענוח והתצוגה לפי `Asia/Jerusalem`, עם luxon ו-ICU, כולל שעון קיץ.
  - שעה שלא קיימת (מעבר לשעון קיץ) גורמת לבקשת הבהרה.
  - שעה שקורית פעמיים (חזרה לשעון חורף) גורמת לבקשת הבהרה.
- **המתזמן:**
  - בדיקה כל 10 שניות, ועוד טיימר מדויק לתזכורת הבאה.
  - בדיקה מחדש בהפעלה, ביציאה ממצב שינה (`powerMonitor.resume`) ובשחרור נעילה.
- **מניעת כפילות:** המעבר `scheduled → fired` או `scheduled → missed` הוא `UPDATE ... WHERE status='scheduled'` אטומי. רק מי שביצע את המעבר שולח התראה.
- **תזכורת שהוחמצה:** אם התזכורת עברה לפני יותר מ-5 דקות (ניתן לשינוי), היא מסומנת "הוחמצה". היא מוצגת פעם אחת בהתראה מסכמת וברשימה ב-HUD, עד שמסמנים אותה כנקראה.
- **מגבלה:** כשהמחשב כבוי או ישן, אין תזכורת בזמן. היא תוצג בהפעלה הבאה. פתרון: סנכרון לענן ופוש לטלפון ב-V2.

## ראייה (צילום מסך)

1. רק כלי `capture_screen_for_analysis`, או כפתור המצלמה ב-HUD.
2. **אישור:** כשהמודל מבקש צילום, מופיע דיאלוג אישור (ברירת מחדל) עם בחירת מסך. הבחירה מבוססת על גאומטריה בלבד, בלי צילום מקדים.
3. **חיווי:** "מצלם מסך…" ← "שולח לניתוח…" ← "התמונה נמחקה מהזיכרון".
4. **שמירה:** התמונה לא נכתבת לדיסק. אחרי השימוש החוצץ מאופס.
5. **ניתוח:** קריאת vision נפרדת **בלי כלים בכלל**, עם הוראה מפורשת שטקסט בתמונה הוא מידע ולא הוראה.
6. **"נגוע" (taint):** אחרי ניתוח מסך, כל כלי עם השפעה באותו תור דורש אישור מפורש. כך, גם אם הוראה זדונית בתמונה תשכנע את המודל, שום דבר לא יבוצע בלי אישורך.

## קבצים מרכזיים

| תחום | קבצים |
|---|---|
| חוזים | `src/shared/*`, `src/main/core/contracts.ts` |
| הרכבה | `src/main/main.ts` |
| אבטחה | `src/main/app/security.ts`, `protocol.ts`, `ipc.ts`, `scripts/after-pack.cjs` (Fuses) |
| מוח | `src/main/conversation/*`, `src/main/ai/*`, `src/main/permissions/*`, `src/main/tools/registry.ts` |
| כלים | `src/main/tools/*`, `src/main/launcher/*`, `src/main/system/*`, `src/main/screen/*` |
| נתונים | `src/main/db/*`, `src/main/time/*`, `src/main/reminders/*` |
| קול | `src/main/voice/*`, `src/renderer/audio/*`, `src/wakeword/*`, `src/main/wakeword/*` |
| ממשק | `src/renderer/*` |
