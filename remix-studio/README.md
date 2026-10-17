# Remix Studio — רמיקס סטודיו

A private web app (phone + desktop, same URL) that takes a song, a sung recording, or a WhatsApp voice note and:

1. **Remix** – keeps the original vocal and adds synthesized drums / 808 that are locked to the song's real beat
   grid, plus tempo, pitch, and vocal effects. You describe it in free Hebrew text or tap a preset.
2. **Separate** – vocals / drums / bass / other (Demucs htdemucs).
3. **Transcribe** – Hebrew first, other languages auto-detected (faster-whisper large-v3) → `.txt` + `.srt`.
4. **Don't touch** – a clean MP3/WAV normalized to -14 LUFS.

All heavy processing runs on [Modal](https://modal.com) GPUs. No samples are used: every drum sound is
synthesized in code.

## Architecture

```
 phone / desktop browser (Hebrew RTL PWA, vanilla JS)
        │  HTTPS, signed session cookie
        ▼
 ┌──────────────────────── Modal app "remix-studio" ────────────────────────┐
 │  web  (CPU, FastAPI + static files, 1 container)                         │
 │    POST /api/jobs ─ save upload ─► Volume remix-studio-data               │
 │                   ─ job record ──► Dict   remix-studio-jobs               │
 │                   ─ process.spawn(job_id)                                 │
 │                                                                           │
 │  process  (CPU worker, 4 vCPU)                                            │
 │    decode → [GPU] → analyze → beat → effects → mix → -14 LUFS → encode    │
 │                │                                                          │
 │  Models  (GPU T4)  Demucs htdemucs ─ stems (.npy) ─► Volume               │
 │                    faster-whisper large-v3 ─ segments                     │
 │                                                                           │
 │  cleanup (cron, daily) – deletes jobs and files older than 7 days        │
 └───────────────────────────────────────────────────────────────────────────┘
 Claude API (claude-sonnet-5-5): Hebrew instruction → RemixPlan JSON (falls back to keywords/preset)
```

Details and design decisions: [PLAN.md](PLAN.md).

## Deploy (Windows PowerShell)

```powershell
cd remix-studio
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
modal setup                     # opens the browser to log in to Modal (once)
```

Create the secret **yourself** (never commit or paste these anywhere else):

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"     # copy the output as SESSION_SECRET
modal secret create remix-studio-secrets ANTHROPIC_API_KEY=sk-ant-... APP_PASSWORD=choose-a-password SESSION_SECRET=<the value above>
```

`ANTHROPIC_API_KEY` is optional — without it free-text instructions use the built-in Hebrew keyword parser.

```powershell
modal serve modal_app.py        # dev URL with hot reload (first run builds images, ~10-15 min)
modal deploy modal_app.py       # production URL: https://<workspace>--remix-studio-web.modal.run
curl https://<workspace>--remix-studio-web.modal.run/api/health
```

Use an L4 instead of a T4: `$env:REMIX_GPU="L4"; modal deploy modal_app.py`.

### Change the password

```powershell
modal secret create remix-studio-secrets --force ANTHROPIC_API_KEY=... APP_PASSWORD=new-password SESSION_SECRET=...
modal deploy modal_app.py
```

Changing `SESSION_SECRET` as well logs out every device.

## Develop and test locally (no GPU needed)

```powershell
pip install -r requirements-dev.txt
python -m pytest                  # ~80 tests, synthetic audio only (needs ffmpeg on PATH)
python dev_server.py              # http://localhost:8000, password "dev"
python -m playwright install chromium
python scripts/ui_smoke.py        # full UI run at 375px and desktop against dev_server
```

`dev_server.py` replaces Demucs with a crude CPU separator (sounds worse; for UI work only) and has no
transcription.

What the tests check (all with generated audio): BPM within ±2 (120/95/140/82), detected beats and generated
drum hits within 20 ms of the real beat (both the event list and by re-detecting the rendered audio), no
output above -0.3 dBFS, loudness -14 ±1 LUFS after MP3/WAV encoding, durations after tempo change, clean
Hebrew errors for silent/corrupt/too-long/oversized files, WhatsApp `.opus`, iPhone `.m4a`, browser `.webm`,
`.mp4` video, 14 Hebrew phrasings incl. vague and impossible requests, login/rate limit/expired session,
path traversal, concurrency and daily limits, cleanup.

## Add a drum style

1. In `backend/beats.py` add an entry to `STYLES` — 16-step strings per instrument
   (`x` accent, `o` normal, `-` ghost, `.` rest) for the main bar `a`, the variation `b` (every 4th bar) and
   the `fill`; set its natural `bpm_range`, `swing`, optional `bass_808` rhythm and per-instrument `gains`.
   Instruments: `kick snare clap hat ohat rim shaker doum tek`.
2. Add its Hebrew name to `STYLE_NAMES_HE`, keywords to `_STYLE_WORDS` in `backend/planner.py`, and
   optionally a preset in `PRESETS` (it then shows up as a chip in the UI automatically).
3. `python -m pytest tests/test_beats.py` — every style is checked for beat lock automatically.

## Cost notes

Measured locally (4 CPU cores, 30 s synthetic song): the CPU part of a remix (analysis + beat + mix + MP3)
takes 3–6 s, i.e. roughly 0.1–0.2 s per second of audio. **GPU time has not been measured yet** — the build
environment could not reach Modal. Each job's result stores `stats.gpu_seconds` and `stats.seconds_total`;
read them after a few real jobs (`GET /api/jobs/{id}` → `result` → `stats`) to get real numbers.
Typical published figures for htdemucs on a T4 are ~10–20 s for a 3–4 minute song, plus a cold start of
~20–40 s when the GPU container was idle (`scaledown_window` is 2 minutes). "עוד גרסה" reuses the stems and
costs no GPU time. Limits (3 concurrent, 40/day, GPU `max_containers=2`) cap the worst case.

---

## איך משתמשים

1. נכנסים לכתובת של האפליקציה מהטלפון או מהמחשב, ומקלידים את הסיסמה. החיבור נשמר ל-30 יום.
2. **בחר שמע**: לוחצים על "לחץ לבחירת קובץ" (במחשב אפשר גם לגרור), או על "הקלט עכשיו" ומקליטים ישירות.
   אפשר שיר, הודעה קולית מוואטסאפ או סרטון. עד 50MB ועד 10 דקות.
3. **מה לעשות?** בוחרים אחד מהארבעה:
   - **רמיקס** — בוחרים סגנון מוכן (טראפ, האוס, מזרחית קצבית…) או כותבים במילים, למשל
     "תוסיף תופים טראפ ותאיץ קצת" או "רק ריוורב על הקול".
   - **הפרדת שכבות** — מקבלים ארבעה קבצים: קול, תופים, בס ושאר הכלים.
   - **תמלול** — מקבלים טקסט וקובץ כתוביות SRT.
   - **אל תיגע** — רק המרה נקייה לעוצמה אחידה.
4. לוחצים **יאללה**. רואים את השלבים מתקדמים. אפשר לסגור את הדף ולחזור: העיבוד ממשיך, והאפליקציה פותחת אותו שוב לבד.
5. **בתוצאה**: מנגנים, ועוברים בין "רמיקס" ל"מקור" כדי להשוות. מורידים כל קובץ, משתפים מהטלפון,
   או לוחצים "עוד גרסה" כדי לנסות סגנון אחר בלי להעלות שוב (וגם בלי לחכות להפרדה מחדש).
6. **היסטוריה** (אייקון השעון למעלה): כל העיבודים מ-7 הימים האחרונים. אפשר לנגן, להוריד ולמחוק.
7. כדי להוסיף למסך הבית: באייפון, ב-Safari לוחצים "שתף" ואז "הוסף למסך הבית". באנדרואיד, ב-Chrome פותחים את התפריט ובוחרים "הוסף למסך הבית".

**טוב לדעת:** שירה בלי מטרונום (קצב חופשי) לא תמיד תינעל בדיוק על התופים, ותקבל על זה הודעה.
אין אוטו-טיון ואין החלפת קול לקול של זמר אחר. המערכת אומרת מה לא בוצע, ומבצעת את כל השאר.
