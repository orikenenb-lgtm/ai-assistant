# Remix Studio — plan & decisions

## Structure
```
remix-studio/
  modal_app.py          Modal app: web (CPU), process (CPU worker), Models (GPU), cleanup (cron)
  dev_server.py         local server without Modal/GPU (crude CPU separator, for UI work)
  backend/
    audio_io.py         ffprobe/ffmpeg decode -> 44.1k stereo float32; MP3 320k / WAV 24-bit
    analysis.py         BPM, regularized beat grid, downbeats, key, loudness
    beats.py            synthesized drum kit + 8 styles, placed on the real beat grid
    effects.py          pedalboard chains (vocal, drum bus, 808 bus, master, LP sweep)
    timestretch.py      Rubber Band (fallback librosa) tempo / pitch
    mixing.py           ducking, true-peak lookahead limiter, -14 LUFS normalization
    planner.py          Hebrew text -> RemixPlan (Claude structured output -> keyword fallback -> preset)
    separation.py       Demucs htdemucs (lazy torch import)
    transcription.py    faster-whisper large-v3, .txt/.srt
    pipeline.py         the four modes + progress steps
    jobs.py             job store (modal.Dict / in-memory), limits, worker entry point
    api.py              FastAPI: login, jobs, downloads, static frontend
  frontend/             vanilla HTML/CSS/ES modules, RTL, PWA
  tests/                pytest (synthetic audio only)
  scripts/ui_smoke.py   Playwright run of the whole UI (375px + desktop)
```

## Decisions
- **Beat grid**: librosa beat tracking → snap to onset peaks → integer beat indices (fills dropped beats) →
  local robust linear regression (±8 beats; follows drift, removes jitter) → global phase correction from a
  1.5 ms log-energy attack detector (spectral-flux envelopes peak ~10–15 ms late). Measured: ≤5 ms error on
  synthetic tracks. Drums are placed by interpolating this grid, never from a constant BPM.
- **Half/double time**: analysis normalizes to 70–180 BPM; each style has a natural tempo range and picks
  ×0.5 / ×1 / ×2; the plan can force `feel`.
- **Free tempo** (a cappella / voice notes): detected by grid residual / salience. The voice is not warped;
  a steady grid starts at the first vocal onset, and `notes_he` warns.
- **GPU**: T4 (cheapest Modal GPU with 16 GB — enough for htdemucs + whisper large-v3 fp16). Override with
  `REMIX_GPU=L4 modal deploy modal_app.py`. Weights are baked into the image at build time.
  Demucs loads in `@modal.enter`; Whisper is loaded lazily once per container (remix jobs never need it,
  so their cold start stays short).
- **Data flow**: web saves the upload to the Volume and commits → `process.spawn(job_id)` → CPU worker calls
  `Models.separate_to_volume` (GPU writes stems as float16 .npy next to the upload) → worker reloads, analyzes,
  builds the beat, mixes, writes outputs, commits. Big arrays never travel as function arguments.
  "עוד גרסה" re-uses the cached stems → no GPU time.
- **Limits**: 3 active jobs, 40 jobs/day, 50 MB, 10 min; GPU `max_containers=2`, worker `max_containers=3`.
- **Planner**: model `claude-sonnet-5-5` with a strict JSON schema; Pydantic clamps every value.
  No key / error / refusal → Hebrew keyword parser over the preset → never crashes.
- **Auth**: one password (Modal secret), itsdangerous-signed httpOnly/Secure/SameSite=Lax cookie (30 days),
  constant-time compare, 5 failures / 15 min per IP + 25 global.
