"""Job records, limits, and the worker entry point.

The key-value store is anything with get/put/pop (a modal.Dict in production,
MemoryKV in tests). Files live under DATA_DIR (a modal.Volume in production).
"""
from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import pipeline
from .errors import UserError
from .planner import make_plan

log = logging.getLogger(__name__)

MAX_ACTIVE_JOBS = 3
MAX_JOBS_PER_DAY = 40
HISTORY_SIZE = 30
INDEX_LIMIT = 300
STALE_AFTER_SEC = 25 * 60       # longer than the worker timeout -> the worker died
RETENTION_DAYS = 7

ACTIVE = ("queued", "running")


class MemoryKV:
    """Thread-safe in-memory stand-in for modal.Dict."""

    def __init__(self):
        self._d: dict = {}
        self._lock = threading.Lock()

    def get(self, key, default=None):
        with self._lock:
            return self._d.get(key, default)

    def put(self, key, value):
        with self._lock:
            self._d[key] = value

    def pop(self, key, default=None):
        with self._lock:
            return self._d.pop(key, default)


def new_id() -> str:
    return uuid.uuid4().hex


def is_valid_id(s: str) -> bool:
    return isinstance(s, str) and len(s) == 32 and all(c in "0123456789abcdef" for c in s)


def _now() -> float:
    return time.time()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class JobStore:
    def __init__(self, kv, data_dir: Path):
        self.kv = kv
        self.data_dir = Path(data_dir)
        self._lock = threading.Lock()

    # ---- paths
    def upload_dir(self, upload_id: str) -> Path:
        return self.data_dir / "uploads" / upload_id

    def out_dir(self, job_id: str) -> Path:
        return self.data_dir / "jobs" / job_id / "out"

    # ---- records
    def get(self, job_id: str) -> dict | None:
        return self.kv.get(f"job:{job_id}") if is_valid_id(job_id) else None

    def save(self, job: dict) -> None:
        job["updated"] = _now()
        self.kv.put(f"job:{job['id']}", job)

    def index(self) -> list[str]:
        return list(self.kv.get("index", []) or [])

    def recent(self, n: int = HISTORY_SIZE) -> list[dict]:
        out = []
        for jid in self.index()[:n]:
            j = self.get(jid)
            if j:
                out.append(self._mark_stale(j))
        return out

    def _mark_stale(self, job: dict) -> dict:
        if job["status"] in ACTIVE and _now() - job.get("updated", job["created"]) > STALE_AFTER_SEC:
            job["status"] = "error"
            job["error_he"] = "העיבוד נתקע ובוטל. נסה שוב."
            self.save(job)
        return job

    def active_count(self) -> int:
        return sum(1 for j in self.recent(HISTORY_SIZE) if j["status"] in ACTIVE)

    def jobs_today(self) -> int:
        return int(self.kv.get(f"day:{_today()}", 0) or 0)

    def create(self, *, mode: str, upload: dict, instruction: str, preset: str | None,
               output_format: str, source_job_id: str | None = None) -> dict:
        with self._lock:
            if self.active_count() >= MAX_ACTIVE_JOBS:
                raise UserError(f"יש כבר {MAX_ACTIVE_JOBS} עיבודים פעילים. חכה שאחד מהם יסתיים.")
            if self.jobs_today() >= MAX_JOBS_PER_DAY:
                raise UserError(f"הגעת למגבלה היומית ({MAX_JOBS_PER_DAY} עיבודים). נסה שוב מחר.")
            jid = new_id()
            job = {
                "id": jid, "status": "queued", "mode": mode, "created": _now(), "updated": _now(),
                "upload": upload, "instruction": instruction, "preset": preset,
                "output_format": output_format, "source_job_id": source_job_id,
                "step": "upload", "progress": 0,
                "steps": [{"key": k, "label_he": l, "state": "pending"} for k, l in pipeline.STEPS[mode]],
                "result": None, "error_he": None, "call_id": None,
            }
            job["steps"][0]["state"] = "done"
            self.save(job)
            self.kv.put("index", [jid] + self.index()[: INDEX_LIMIT - 1])
            self.kv.put(f"day:{_today()}", self.jobs_today() + 1)
            return job

    def set_progress(self, job: dict, step: str, pct: int) -> None:
        keys = [s["key"] for s in job["steps"]]
        if step not in keys:
            return
        i = keys.index(step)
        for k, s in enumerate(job["steps"]):
            s["state"] = "done" if k < i or (k == i and pct >= 100) else ("active" if k == i else "pending")
        job["step"] = step
        job["progress"] = int(round(100 * (i + min(pct, 100) / 100) / len(keys)))
        self.save(job)

    def delete(self, job_id: str) -> bool:
        job = self.get(job_id)
        if not job:
            return False
        shutil.rmtree(self.data_dir / "jobs" / job_id, ignore_errors=True)
        self.kv.pop(f"job:{job_id}")
        self.kv.put("index", [j for j in self.index() if j != job_id])
        up = job.get("upload", {}).get("id")
        if up and not any((self.get(j) or {}).get("upload", {}).get("id") == up for j in self.index()):
            shutil.rmtree(self.upload_dir(up), ignore_errors=True)
        return True

    def cleanup(self, days: int = RETENTION_DAYS) -> int:
        cutoff = _now() - days * 86400
        removed = 0
        for jid in self.index():
            j = self.get(jid)
            if j is None or (j["created"] < cutoff and j["status"] not in ACTIVE):
                if j is None:
                    self.kv.put("index", [x for x in self.index() if x != jid])
                else:
                    self.delete(jid)
                removed += 1
        # Orphan directories (e.g. uploads whose job record was lost).
        known_uploads = {(self.get(j) or {}).get("upload", {}).get("id") for j in self.index()}
        for sub, known in (("uploads", known_uploads), ("jobs", set(self.index()))):
            root = self.data_dir / sub
            if root.exists():
                for p in root.iterdir():
                    if p.name not in known and p.stat().st_mtime < cutoff:
                        shutil.rmtree(p, ignore_errors=True)
        return removed


def public_job(job: dict) -> dict:
    """What the client may see (no internal paths)."""
    res = job.get("result")
    out = {k: job.get(k) for k in ("id", "status", "mode", "step", "progress", "steps", "created",
                                   "instruction", "preset", "output_format", "error_he", "source_job_id")}
    up = job.get("upload") or {}
    out["input"] = {"name": up.get("name"), "duration": up.get("duration"),
                    "url": f"/api/jobs/{job['id']}/input"}
    if res:
        out["result"] = {
            **{k: res.get(k) for k in ("bpm", "key", "notes_he", "transcript", "duration", "plan_source")},
            "files": [{**f, "url": f"/api/files/{job['id']}/{f['name']}"} for f in res.get("files", [])],
        }
    else:
        out["result"] = None
    return out


def run_job(job_id: str, store: JobStore, *, separate=None, transcribe=None,
            reload: Callable[[], None] = lambda: None, commit: Callable[[], None] = lambda: None,
            api_key: str | None = None) -> None:
    """Worker entry point: process one job end to end, recording progress and result."""
    reload()
    job = store.get(job_id)
    if not job or job["status"] not in ACTIVE:
        return
    job["status"] = "running"
    store.save(job)
    up = job["upload"]
    input_path = store.upload_dir(up["id"]) / up["file"]
    out_dir = store.out_dir(job_id)
    last = [0.0]

    def progress(step: str, pct: int) -> None:
        if pct >= 100 or _now() - last[0] > 1.0:
            last[0] = _now()
            store.set_progress(job, step, pct)

    try:
        plan, source = None, None
        if job["mode"] == "remix":
            plan, source = make_plan(job.get("instruction"), job.get("preset"), job["output_format"], api_key=api_key)
        res = pipeline.run(
            job["mode"], input_path, out_dir, base_name=up["stem"], output_format=job["output_format"],
            plan=plan, separate=separate, transcribe=transcribe, progress=progress,
            stems_cache=store.upload_dir(up["id"]) / "stems",
        )
        commit()
        files = [f.to_dict((out_dir / f.name).stat().st_size) for f in res.files]
        job["result"] = {"files": files, "bpm": res.bpm, "key": res.key, "notes_he": res.notes_he,
                         "transcript": res.transcript, "duration": res.duration, "plan": res.plan,
                         "plan_source": source, "stats": res.stats}
        job["status"] = "done"
        job["progress"] = 100
        for s in job["steps"]:
            s["state"] = "done"
        log.info("job %s done in %.1fs stats=%s", job_id, res.stats.get("seconds_total", -1), res.stats)
    except UserError as e:
        job["status"], job["error_he"] = "error", e.message_he
    except Exception:
        log.exception("job %s failed", job_id)
        job["status"], job["error_he"] = "error", "משהו השתבש בעיבוד. נסה שוב, ואם זה חוזר — נסה קובץ אחר."
    finally:
        store.save(job)
