"""Local development server (no Modal, no GPU) for working on the frontend.

    python dev_server.py           # http://localhost:8000  password: dev

Heavy models are replaced by a crude CPU separator (HPSS + mid/side), so remix and
separation run end-to-end locally but sound worse than production (Demucs).
Transcription needs the GPU model and is unavailable here.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

import librosa
import numpy as np
import uvicorn

from backend.api import Hooks, Settings, create_app
from backend.errors import UserError
from backend.jobs import JobStore, MemoryKV, run_job

HERE = Path(__file__).parent


def rough_separate(audio: np.ndarray) -> dict[str, np.ndarray]:
    """DEV ONLY. Percussive part -> drums, low harmonic -> bass, centre harmonic -> vocals."""
    out = {k: np.zeros_like(audio) for k in ("vocals", "drums", "bass", "other")}
    for c in range(2):
        H, P = librosa.decompose.hpss(librosa.stft(audio[c]), margin=2.0)
        n = audio.shape[1]
        out["drums"][c] = librosa.istft(P, length=n)
        h = librosa.istft(H, length=n)
        freqs = librosa.fft_frequencies(sr=44100)
        low = H * (freqs[:, None] < 180)
        out["bass"][c] = librosa.istft(low, length=n)
        out["other"][c] = h - out["bass"][c]
    mid = out["other"].mean(axis=0)
    side = (out["other"][0] - out["other"][1]) / 2
    out["vocals"] = np.stack([mid, mid]) * 0.7
    out["other"] = np.stack([side + mid * 0.3, -side + mid * 0.3])
    return {k: v.astype(np.float32) for k, v in out.items()}


def no_transcribe(_y):
    raise UserError("תמלול זמין רק בשרת עם GPU (Modal).")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    data = Path(os.environ.get("DATA_DIR", HERE / "data"))
    store = JobStore(MemoryKV(), data)

    def spawn(job_id: str):
        threading.Thread(target=run_job, args=(job_id, store), daemon=True,
                         kwargs={"separate": rough_separate, "transcribe": no_transcribe,
                                 "api_key": os.environ.get("ANTHROPIC_API_KEY")}).start()

    settings = Settings(password=os.environ.get("APP_PASSWORD", "dev"), session_secret="dev-secret-not-for-prod",
                        data_dir=data, cookie_secure=False, frontend_dir=HERE / "frontend")
    uvicorn.run(create_app(settings, store, Hooks(spawn=spawn)), host="127.0.0.1", port=int(os.environ.get("PORT", 8000)))


if __name__ == "__main__":
    main()
