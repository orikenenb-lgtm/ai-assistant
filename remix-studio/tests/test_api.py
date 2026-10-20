import io
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend import audio_io, jobs
from backend.api import Hooks, Settings, create_app
from backend.jobs import JobStore, MemoryKV, run_job
from backend.transcription import Segment, Transcript
from synth import song

PASSWORD = "test-pass-123"


@pytest.fixture
def env(tmp_path):
    mix, stems, _ = song(110, 12)
    store = JobStore(MemoryKV(), tmp_path / "data")
    gate = threading.Event()
    gate.set()

    def separate(a):
        gate.wait(10)
        return {k: v[:, : a.shape[1]] for k, v in stems.items()}

    def transcribe(y):
        return Transcript("he", 0.95, [Segment(0.2, 1.5, "שלום")])

    def spawn(job_id):
        threading.Thread(target=run_job, args=(job_id, store),
                         kwargs={"separate": separate, "transcribe": transcribe, "api_key": ""}, daemon=True).start()
        return None

    app = create_app(Settings(PASSWORD, "s" * 32, tmp_path / "data", cookie_secure=True), store, Hooks(spawn=spawn))
    client = TestClient(app, base_url="https://testserver")
    wav = io.BytesIO()
    import soundfile as sf
    sf.write(wav, mix.T, 44100, format="WAV")
    return client, store, wav.getvalue(), gate


def login(client, pw=PASSWORD):
    return client.post("/api/login", json={"password": pw})


def wait(client, jid, timeout=90):
    t = time.time()
    while time.time() - t < timeout:
        j = client.get(f"/api/jobs/{jid}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.3)
    raise AssertionError("job timed out")


def test_requires_login(env):
    client, *_ = env
    assert client.get("/api/health").status_code == 200
    for method, url in [("get", "/api/jobs"), ("get", "/api/jobs/" + "a" * 32), ("post", "/api/jobs"),
                        ("get", f"/api/files/{'a'*32}/x.mp3"), ("delete", "/api/jobs/" + "a" * 32)]:
        r = getattr(client, method)(url)
        assert r.status_code == 401, url
        assert "error_he" in r.json()


def test_wrong_password_and_rate_limit(env):
    client, *_ = env
    for _ in range(5):
        assert login(client, "nope").status_code == 401
    assert login(client, "nope").status_code == 429
    assert login(client).status_code == 429   # locked out for a while, even with the right password


def test_cookie_flags(env):
    client, *_ = env
    r = login(client)
    assert r.status_code == 200
    sc = r.headers["set-cookie"].lower()
    assert "httponly" in sc and "secure" in sc and "samesite=lax" in sc and "max-age=2592000" in sc


def test_tampered_or_expired_session(env, monkeypatch):
    client, *_ = env
    client.cookies.set("rs_session", "ok.garbage.sig", domain="testserver")
    assert client.get("/api/jobs").status_code == 401
    client.cookies.clear()
    login(client)
    assert client.get("/api/jobs").status_code == 200
    import itsdangerous.timed as timed
    real = time.time
    monkeypatch.setattr(timed.time, "time", lambda: real() + 31 * 86400)
    assert client.get("/api/jobs").status_code == 401


def test_full_flow_remix_download_rerun_delete(env):
    client, store, wav, _ = env
    login(client)
    r = client.post("/api/jobs", data={"mode": "remix", "preset": "trap", "instruction": "תוסיף תופים טראפ ותאיץ קצת"},
                    files={"file": ("השיר שלי.wav", wav, "audio/wav")})
    assert r.status_code == 200, r.text
    jid = r.json()["job_id"]
    j = wait(client, jid)
    assert j["status"] == "done", j
    res = j["result"]
    assert res["bpm"] and res["notes_he"] and res["files"]
    assert all(s["state"] == "done" for s in j["steps"])
    f = res["files"][0]
    assert f["name"].startswith("השיר-שלי_remix_trap")
    d = client.get(f["url"])
    assert d.status_code == 200 and d.headers["content-type"] == "audio/mpeg"
    assert "filename*=utf-8''" in d.headers["content-disposition"]
    assert len(d.content) == f["size"]
    # Range requests work (needed for seeking on iPhone).
    rr = client.get(f["url"], headers={"Range": "bytes=0-99"})
    assert rr.status_code == 206 and len(rr.content) == 100
    # Original input for the A/B toggle.
    assert client.get(j["input"]["url"]).status_code == 200
    # History.
    assert client.get("/api/jobs").json()["jobs"][0]["id"] == jid
    # Another version without re-uploading.
    r2 = client.post("/api/jobs", data={"mode": "remix", "preset": "house", "source_job_id": jid})
    j2 = wait(client, r2.json()["job_id"])
    assert j2["status"] == "done" and "house" in j2["result"]["files"][0]["name"]
    # Delete.
    assert client.delete(f"/api/jobs/{jid}").status_code == 200
    assert client.get(f"/api/jobs/{jid}").status_code == 404
    assert client.get(f["url"]).status_code == 404
    # Upload is still used by the second job, so it must survive.
    assert client.get(j2["input"]["url"]).status_code == 200


def test_path_traversal_is_blocked(env):
    client, store, wav, _ = env
    login(client)
    jid = client.post("/api/jobs", data={"mode": "convert"}, files={"file": ("a.wav", wav, "audio/wav")}).json()["job_id"]
    wait(client, jid)
    for name in ["../../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "%2e%2e/%2e%2e/etc/passwd", "hits.json",
                 "..\\..\\x", "a.wav"]:
        r = client.get(f"/api/files/{jid}/{name}")
        assert r.status_code == 404, name
    assert client.get("/api/files/../../etc/passwd").status_code in (401, 404)


def test_other_modes(env):
    client, store, wav, _ = env
    login(client)
    for mode, n in [("separate", 4), ("transcribe", 2), ("convert", 1)]:
        jid = client.post("/api/jobs", data={"mode": mode, "output_format": "wav"},
                          files={"file": ("x.wav", wav, "audio/wav")}).json()["job_id"]
        j = wait(client, jid)
        assert j["status"] == "done" and len(j["result"]["files"]) == n, (mode, j)
        for f in j["result"]["files"]:
            assert client.get(f["url"]).status_code == 200
    tr = [j for j in client.get("/api/jobs").json()["jobs"] if j["mode"] == "transcribe"][0]
    assert tr["result"]["transcript"] == "שלום"


def test_bad_uploads(env):
    client, store, wav, _ = env
    login(client)
    r = client.post("/api/jobs", data={"mode": "remix"}, files={"file": ("x.mp3", b"not audio at all", "audio/mpeg")})
    assert r.status_code == 400 and "error_he" in r.json()
    r = client.post("/api/jobs", data={"mode": "remix"})
    assert r.status_code == 400
    r = client.post("/api/jobs", data={"mode": "hack"}, files={"file": ("x.wav", wav, "audio/wav")})
    assert r.status_code == 400
    big = b"\0" * (audio_io.MAX_UPLOAD_BYTES + 10)
    r = client.post("/api/jobs", data={"mode": "convert"}, files={"file": ("big.wav", big, "audio/wav")})
    assert r.status_code in (400, 413) and "50MB" in r.json()["error_he"]
    # Nothing left behind for rejected uploads.
    up = store.data_dir / "uploads"
    assert not up.exists() or not any(up.iterdir())


def test_silent_upload_gives_hebrew_error(env):
    client, *_ = env
    login(client)
    buf = io.BytesIO()
    import soundfile as sf
    sf.write(buf, np.zeros((44100 * 2, 2)), 44100, format="WAV")
    jid = client.post("/api/jobs", data={"mode": "convert"}, files={"file": ("s.wav", buf.getvalue(), "audio/wav")}).json()["job_id"]
    j = wait(client, jid)
    assert j["status"] == "error" and "שקט" in j["error_he"]


def test_concurrency_and_daily_limits(env, monkeypatch):
    client, store, wav, gate = env
    login(client)
    gate.clear()  # hold separation so jobs stay active
    ids = []
    for _ in range(3):
        r = client.post("/api/jobs", data={"mode": "separate"}, files={"file": ("x.wav", wav, "audio/wav")})
        assert r.status_code == 200
        ids.append(r.json()["job_id"])
    r = client.post("/api/jobs", data={"mode": "separate"}, files={"file": ("x.wav", wav, "audio/wav")})
    assert r.status_code == 400 and "3" in r.json()["error_he"]
    gate.set()
    for jid in ids:
        assert wait(client, jid)["status"] == "done"
    monkeypatch.setattr(jobs, "MAX_JOBS_PER_DAY", 4)
    r = client.post("/api/jobs", data={"mode": "convert"}, files={"file": ("x.wav", wav, "audio/wav")})
    assert r.status_code == 200
    r = client.post("/api/jobs", data={"mode": "convert"}, files={"file": ("x.wav", wav, "audio/wav")})
    assert r.status_code == 400 and "יומית" in r.json()["error_he"]


def test_cleanup_removes_old_jobs(env):
    client, store, wav, _ = env
    login(client)
    jid = client.post("/api/jobs", data={"mode": "convert"}, files={"file": ("x.wav", wav, "audio/wav")}).json()["job_id"]
    wait(client, jid)
    j = store.get(jid)
    j["created"] -= 8 * 86400
    store.kv.put(f"job:{jid}", j)
    assert store.cleanup() == 1
    assert store.get(jid) is None and not (store.data_dir / "jobs" / jid).exists()
