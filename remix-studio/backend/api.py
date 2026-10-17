"""FastAPI app: password login, job API, downloads, and the static frontend.

Modal-specific behaviour (spawning the worker, volume commit/reload) is injected,
so the same app runs in tests with an in-memory store and a thread "spawner".
"""
from __future__ import annotations

import hmac
import logging
import mimetypes
import shutil
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, TimestampSigner

from . import audio_io, pipeline
from .errors import UserError
from .jobs import JobStore, is_valid_id, new_id, public_job
from .planner import PRESETS

log = logging.getLogger(__name__)

COOKIE = "rs_session"
SESSION_DAYS = 30
LOGIN_WINDOW_SEC = 15 * 60
LOGIN_MAX_FAILS_IP = 5
LOGIN_MAX_FAILS_GLOBAL = 25

CONTENT_TYPES = {
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8",
    ".srt": "application/x-subrip; charset=utf-8",
}


@dataclass
class Settings:
    password: str
    session_secret: str
    data_dir: Path
    cookie_secure: bool = True
    frontend_dir: Path | None = None


@dataclass
class Hooks:
    spawn: Callable[[str], str | None]                  # job_id -> call id (optional)
    commit: Callable[[], None] = lambda: None            # persist volume writes
    reload: Callable[[], None] = lambda: None            # see other containers' writes
    cancel: Callable[[str], None] = lambda call_id: None


@dataclass
class _LoginLimiter:
    by_ip: dict = field(default_factory=lambda: defaultdict(deque))
    all: deque = field(default_factory=deque)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def _trim(self, q: deque, now: float) -> None:
        while q and now - q[0] > LOGIN_WINDOW_SEC:
            q.popleft()

    def blocked(self, ip: str) -> bool:
        now = time.time()
        with self.lock:
            q = self.by_ip[ip]
            self._trim(q, now)
            self._trim(self.all, now)
            return len(q) >= LOGIN_MAX_FAILS_IP or len(self.all) >= LOGIN_MAX_FAILS_GLOBAL

    def fail(self, ip: str) -> None:
        now = time.time()
        with self.lock:
            self.by_ip[ip].append(now)
            self.all.append(now)

    def reset(self, ip: str) -> None:
        with self.lock:
            self.by_ip.pop(ip, None)


def _err(status: int, message_he: str) -> JSONResponse:
    return JSONResponse({"error_he": message_he}, status_code=status)


def create_app(settings: Settings, store: JobStore, hooks: Hooks) -> FastAPI:
    if not settings.password or not settings.session_secret:
        raise RuntimeError("APP_PASSWORD and SESSION_SECRET must be set")
    app = FastAPI(title="Remix Studio", docs_url=None, redoc_url=None, openapi_url=None)
    signer = TimestampSigner(settings.session_secret, salt="remix-studio-session")
    limiter = _LoginLimiter()

    def client_ip(request: Request) -> str:
        fwd = request.headers.get("x-forwarded-for", "")
        return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?"))[:64]

    def authed(request: Request) -> bool:
        token = request.cookies.get(COOKIE)
        if not token:
            return False
        try:
            return signer.unsign(token, max_age=SESSION_DAYS * 86400) == b"ok"
        except (BadSignature, SignatureExpired):
            return False

    @app.middleware("http")
    async def guard(request: Request, call_next):
        path = request.url.path
        if path == "/api/jobs" and request.method == "POST":
            try:
                if int(request.headers.get("content-length", "0")) > audio_io.MAX_UPLOAD_BYTES + 1_000_000:
                    return _err(413, "הקובץ גדול מדי. המקסימום הוא 50MB.")
            except ValueError:
                pass
        if path.startswith("/api/") and path not in ("/api/login", "/api/health", "/api/session") and not authed(request):
            return _err(401, "צריך להתחבר מחדש.")
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(UserError)
    async def _user_error(_request, exc: UserError):
        return _err(400, exc.message_he)

    @app.exception_handler(Exception)
    async def _unhandled(_request, exc: Exception):
        log.exception("unhandled error")
        return _err(500, "שגיאת שרת. נסה שוב בעוד רגע.")

    # ------------------------------------------------------------- auth

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/session")
    def session(request: Request):
        return {"authenticated": authed(request)}

    @app.post("/api/login")
    async def login(request: Request):
        ip = client_ip(request)
        if limiter.blocked(ip):
            return _err(429, "יותר מדי ניסיונות. נסה שוב בעוד רבע שעה.")
        try:
            body = await request.json()
            password = str(body.get("password", ""))[:256]
        except Exception:
            password = ""
        if not hmac.compare_digest(password.encode(), settings.password.encode()):
            limiter.fail(ip)
            log.warning("failed login from %s", ip)
            return _err(401, "סיסמה שגויה.")
        limiter.reset(ip)
        resp = JSONResponse({"ok": True})
        resp.set_cookie(COOKIE, signer.sign(b"ok").decode(), max_age=SESSION_DAYS * 86400, httponly=True,
                        secure=settings.cookie_secure, samesite="lax", path="/")
        return resp

    @app.post("/api/logout")
    def logout():
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(COOKIE, path="/")
        return resp

    # ------------------------------------------------------------- jobs

    @app.get("/api/presets")
    def presets():
        return [{"id": k, "label_he": v["label_he"]} for k, v in PRESETS.items()]

    @app.post("/api/jobs")
    async def create_job(
        request: Request,
        mode: str = Form(...),
        file: UploadFile | None = File(None),
        instruction: str = Form(""),
        preset: str = Form(""),
        output_format: str = Form("mp3"),
        source_job_id: str = Form(""),
    ):
        if mode not in pipeline.MODES:
            raise UserError("מצב לא מוכר.")
        if output_format not in ("mp3", "wav"):
            output_format = "mp3"
        preset = preset if preset in PRESETS else None
        instruction = (instruction or "").strip()[:1000]

        if source_job_id:
            # "Another version": reuse a previous upload (and its cached stems).
            hooks.reload()
            src = store.get(source_job_id)
            if not src:
                raise UserError("העיבוד המקורי לא נמצא (אולי נמחק).")
            upload = dict(src["upload"])
            if not (store.upload_dir(upload["id"]) / upload["file"]).exists():
                raise UserError("הקובץ המקורי כבר נמחק. העלה אותו שוב.")
        else:
            if file is None:
                raise UserError("לא נבחר קובץ.")
            upload = await _save_upload(file, store)
        job = store.create(mode=mode, upload=upload, instruction=instruction, preset=preset,
                           output_format=output_format, source_job_id=source_job_id or None)
        hooks.commit()
        try:
            call_id = hooks.spawn(job["id"])
        except Exception:
            log.exception("spawn failed")
            job["status"], job["error_he"] = "error", "לא הצלחתי להתחיל את העיבוד. נסה שוב."
            store.save(job)
            raise UserError(job["error_he"])
        if call_id:
            j = store.get(job["id"]) or job
            j["call_id"] = call_id
            store.save(j)
        return {"job_id": job["id"]}

    @app.get("/api/jobs")
    def list_jobs():
        return {"jobs": [public_job(j) for j in store.recent()]}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = store.get(job_id)
        if not job:
            return _err(404, "העיבוד לא נמצא.")
        return public_job(store._mark_stale(job))

    @app.delete("/api/jobs/{job_id}")
    def delete_job(job_id: str):
        job = store.get(job_id)
        if not job:
            return _err(404, "העיבוד לא נמצא.")
        if job.get("call_id") and job["status"] in ("queued", "running"):
            try:
                hooks.cancel(job["call_id"])
            except Exception:
                log.exception("cancel failed")
        hooks.reload()
        store.delete(job_id)
        hooks.commit()
        return {"ok": True}

    @app.get("/api/jobs/{job_id}/input")
    def job_input(job_id: str):
        job = store.get(job_id)
        if not job:
            return _err(404, "העיבוד לא נמצא.")
        up = job["upload"]
        path = store.upload_dir(up["id"]) / up["file"]
        if not path.exists():
            hooks.reload()
        if not path.exists():
            return _err(404, "הקובץ המקורי לא נמצא.")
        return FileResponse(path, media_type=up.get("content_type") or "application/octet-stream",
                            filename=up["name"], content_disposition_type="inline")

    @app.get("/api/files/{job_id}/{name}")
    def download(job_id: str, name: str, request: Request):
        job = store.get(job_id) if is_valid_id(job_id) else None
        if not job or not job.get("result"):
            return _err(404, "הקובץ לא נמצא.")
        # Only names the job itself produced are served -> no path traversal possible.
        allowed = {f["name"] for f in job["result"]["files"]}
        if name not in allowed:
            return _err(404, "הקובץ לא נמצא.")
        path = store.out_dir(job_id) / name
        if not path.exists():
            hooks.reload()
        if not path.exists():
            return _err(404, "הקובץ לא נמצא.")
        ext = path.suffix.lower()
        inline = request.query_params.get("inline") == "1"
        return FileResponse(path, media_type=CONTENT_TYPES.get(ext, "application/octet-stream"), filename=name,
                            content_disposition_type="inline" if inline else "attachment")

    # ------------------------------------------------------------- static frontend

    if settings.frontend_dir and Path(settings.frontend_dir).exists():
        app.mount("/", StaticFiles(directory=str(settings.frontend_dir), html=True), name="static")

    return app


async def _save_upload(file: UploadFile, store: JobStore) -> dict:
    upload_id = new_id()
    d = store.upload_dir(upload_id)
    d.mkdir(parents=True, exist_ok=True)
    original = (file.filename or "audio").replace("\\", "/").split("/")[-1][:200]
    ext = Path(original).suffix.lower()
    ext = ext if ext in audio_io.ALLOWED_EXTENSIONS else ".bin"
    path = d / f"input{ext}"
    size = 0
    try:
        with open(path, "wb") as fh:
            while chunk := await file.read(1 << 20):
                size += len(chunk)
                if size > audio_io.MAX_UPLOAD_BYTES:
                    raise UserError("הקובץ גדול מדי. המקסימום הוא 50MB.")
                fh.write(chunk)
        if size == 0:
            raise UserError("הקובץ ריק.")
        info = audio_io.probe(path)  # real validation: must contain decodable audio
        if info.duration > audio_io.MAX_DURATION_SEC + 1:
            raise UserError("הקובץ ארוך מדי. האורך המקסימלי הוא 10 דקות.")
    except Exception:
        shutil.rmtree(d, ignore_errors=True)
        raise
    ctype = file.content_type if (file.content_type or "").startswith(("audio/", "video/")) else (
        mimetypes.guess_type(original)[0] or "application/octet-stream")
    return {"id": upload_id, "file": path.name, "name": original, "stem": audio_io.safe_stem(original),
            "size": size, "duration": round(info.duration, 2) or None, "content_type": ctype}
