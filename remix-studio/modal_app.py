"""Remix Studio on Modal.

    modal serve modal_app.py     # dev (hot reload, temporary URL)
    modal deploy modal_app.py    # production

Containers:
  web      CPU, FastAPI + static frontend (1 container, many concurrent requests)
  process  CPU worker: decoding, analysis, beat building, mixing (one job per call)
  Models   GPU (T4 by default): Demucs htdemucs + faster-whisper large-v3
  cleanup  daily cron: deletes jobs/files older than 7 days
"""
from __future__ import annotations

import os
from pathlib import Path

import modal

APP_NAME = "remix-studio"
GPU = os.environ.get("REMIX_GPU", "T4")   # T4 is the cheapest GPU that fits both models (16 GB)
DATA = "/data"
MODELS = "/models"
HERE = Path(__file__).parent

# Pinned versions (tested locally with the test suite).
CPU_DEPS = [
    "numpy==2.4.6", "scipy==1.17.1", "librosa==0.11.0", "numba==0.68.0", "soundfile==0.14.0",
    "soxr==1.1.0", "pedalboard==0.9.26", "pyloudnorm==0.2.0", "pyrubberband==0.4.0",
    "pydantic==2.14.1", "anthropic==1.15.0",
]
WEB_DEPS = ["fastapi==0.143.3", "python-multipart==0.0.32", "itsdangerous==2.2.0"]
GPU_DEPS = ["torch==2.5.1", "torchaudio==2.5.1", "demucs==4.0.1", "faster-whisper==1.2.1"]

cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "rubberband-cli", "libsndfile1")
    .uv_pip_install(*CPU_DEPS, *WEB_DEPS)
    .env({"NUMBA_CACHE_DIR": "/tmp/numba"})
)


def _download_models() -> None:
    """Runs once at image build: bakes model weights into the image (no download on cold start)."""
    from demucs.pretrained import get_model
    from faster_whisper import WhisperModel

    get_model("htdemucs")
    WhisperModel("large-v3", device="cpu", compute_type="int8", download_root=f"{MODELS}/whisper")


gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .uv_pip_install(*CPU_DEPS, *GPU_DEPS)
    .env({"TORCH_HOME": f"{MODELS}/torch", "HF_HOME": f"{MODELS}/hf", "NUMBA_CACHE_DIR": "/tmp/numba"})
    .run_function(_download_models)
)

cpu_image = cpu_image.add_local_python_source("backend").add_local_dir(HERE / "frontend", "/root/frontend")
gpu_image = gpu_image.add_local_python_source("backend")

app = modal.App(APP_NAME)
volume = modal.Volume.from_name("remix-studio-data", create_if_missing=True)
jobs_dict = modal.Dict.from_name("remix-studio-jobs", create_if_missing=True)
secrets = [modal.Secret.from_name("remix-studio-secrets")]


class ModalKV:
    """Adapter: modal.Dict with the get/put/pop interface JobStore expects."""

    def __init__(self, d):
        self.d = d

    def get(self, key, default=None):
        return self.d.get(key, default)

    def put(self, key, value):
        self.d[key] = value

    def pop(self, key, default=None):
        try:
            return self.d.pop(key)
        except KeyError:
            return default


def _store():
    from backend.jobs import JobStore

    return JobStore(ModalKV(jobs_dict), Path(DATA))


def _reload():
    try:
        volume.reload()
    except Exception as e:  # e.g. open files; the next reload will catch up
        print(f"volume.reload skipped: {type(e).__name__}")


# ---------------------------------------------------------------- GPU models

@app.cls(gpu=GPU, image=gpu_image, volumes={DATA: volume}, timeout=15 * 60,
         scaledown_window=120, max_containers=2)
class Models:
    @modal.enter()
    def load(self):
        from backend.separation import Separator

        self.separator = Separator("htdemucs", device="cuda")
        self._transcriber = None   # whisper is loaded on first use (remix jobs never need it)

    def _whisper(self):
        if self._transcriber is None:
            from backend.transcription import Transcriber

            self._transcriber = Transcriber("large-v3", device="cuda", compute_type="float16",
                                            download_root=f"{MODELS}/whisper")
        return self._transcriber

    @modal.method()
    def separate_to_volume(self, input_rel: str, stems_rel: str) -> dict:
        """Reads the upload from the volume, writes 4 stems (.npy float16) next to it."""
        import time

        import numpy as np

        from backend import audio_io

        t0 = time.time()
        _reload()
        audio = audio_io.decode(Path(DATA) / input_rel)
        stems = self.separator.separate(audio)
        out = Path(DATA) / stems_rel
        out.mkdir(parents=True, exist_ok=True)
        for name, y in stems.items():
            np.save(out / f"{name}.npy", y.astype(np.float16))
        volume.commit()
        return {"gpu_seconds": round(time.time() - t0, 2), "duration": audio.shape[1] / audio_io.SR}

    @modal.method()
    def transcribe_file(self, input_rel: str) -> dict:
        import time

        import librosa

        from backend import audio_io
        from backend.transcription import WHISPER_SR

        t0 = time.time()
        _reload()
        audio = audio_io.decode(Path(DATA) / input_rel)
        y16 = librosa.resample(audio_io.to_mono(audio), orig_sr=audio_io.SR, target_sr=WHISPER_SR)
        tr = self._whisper().transcribe(y16)
        return {"language": tr.language, "prob": tr.language_probability,
                "segments": [(s.start, s.end, s.text) for s in tr.segments],
                "gpu_seconds": round(time.time() - t0, 2)}


# ---------------------------------------------------------------- CPU worker

@app.function(image=cpu_image, secrets=secrets, volumes={DATA: volume}, cpu=4.0, memory=8192,
              timeout=15 * 60, max_containers=3, scaledown_window=60)
def process(job_id: str) -> None:
    import logging

    import numpy as np

    from backend.jobs import run_job
    from backend.separation import STEMS
    from backend.transcription import Segment, Transcript

    logging.basicConfig(level=logging.INFO)
    store = _store()
    job = store.get(job_id)
    if not job:
        return
    up = job["upload"]
    input_rel = f"uploads/{up['id']}/{up['file']}"
    stems_rel = f"uploads/{up['id']}/stems"
    gpu_stats = {}

    def separate(audio):
        gpu_stats.update(Models().separate_to_volume.remote(input_rel, stems_rel))
        _reload()
        d = Path(DATA) / stems_rel
        return {s: np.load(d / f"{s}.npy").astype(np.float32) for s in STEMS}

    def transcribe(_y16):
        r = Models().transcribe_file.remote(input_rel)
        gpu_stats["gpu_seconds"] = r["gpu_seconds"]
        return Transcript(r["language"], r["prob"], [Segment(*s) for s in r["segments"]])

    run_job(job_id, store, separate=separate, transcribe=transcribe, reload=_reload, commit=volume.commit,
            api_key=os.environ.get("ANTHROPIC_API_KEY") or None)
    if gpu_stats:
        j = store.get(job_id)
        if j and j.get("result"):
            j["result"].setdefault("stats", {}).update(gpu_stats)
            store.save(j)
    volume.commit()


# ---------------------------------------------------------------- web

@app.function(image=cpu_image, secrets=secrets, volumes={DATA: volume}, max_containers=1,
              scaledown_window=300, timeout=10 * 60)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def web():
    import logging

    from backend.api import Hooks, Settings, create_app

    logging.basicConfig(level=logging.INFO)

    def spawn(job_id: str) -> str:
        return process.spawn(job_id).object_id

    def cancel(call_id: str) -> None:
        modal.FunctionCall.from_id(call_id).cancel()

    settings = Settings(
        password=os.environ["APP_PASSWORD"], session_secret=os.environ["SESSION_SECRET"],
        data_dir=Path(DATA), cookie_secure=True, frontend_dir=Path("/root/frontend"),
    )
    return create_app(settings, _store(), Hooks(spawn=spawn, commit=volume.commit, reload=_reload, cancel=cancel))


# ---------------------------------------------------------------- daily cleanup

@app.function(image=cpu_image, volumes={DATA: volume}, schedule=modal.Cron("17 3 * * *"), timeout=600)
def cleanup() -> None:
    _reload()
    removed = _store().cleanup()
    volume.commit()
    print(f"cleanup: removed {removed} old jobs")
