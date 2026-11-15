"""Security review fixes on the HTTP/security/storage side: L-2, L-3, L-4, L-10, L-11."""

from __future__ import annotations

import os
import sqlite3
import stat
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from bridge_service import admin
from bridge_service.api.errors import MESSAGE_REQUEST_ID_REUSED
from bridge_service.main import create_app
from bridge_service.security.pairing import (
    generate_pairing_code,
    hash_pairing_code,
    load_or_create_pepper,
    pepper_path_for,
)
from bridge_service.security.ratelimit import SlidingWindowLimiter
from bridge_service.security.replay import ReplayGuard, ReplayVerdict
from bridge_service.security.tokens import sha256_hex
from bridge_service.storage.db import DAY_SECONDS, MIGRATIONS, Database


class Clock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def xff(i: int) -> dict[str, str]:
    return {"X-Forwarded-For": f"203.0.113.{i}"}


def post_draft(c, device, payload, **headers):
    return c.post("/v1/drafts", json=payload, headers={**device.headers(), **headers})


# =============================================================================== L-2 pairing


def test_global_pairing_failure_cap_blocks_every_ip_and_valid_codes(settings_factory, engine, make_pairing_code):
    settings = settings_factory(trust_proxy_headers=True, pairing_attempts_per_hour=100)
    with TestClient(create_app(settings, engine=engine)) as c:
        for i in range(20):  # 20 failures, each from a different IP → per-IP limits never trigger
            assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}, headers=xff(i)).status_code == 400
        valid = make_pairing_code(settings.db_path)
        resp = c.post("/v1/pair", json={"pairing_code": valid}, headers=xff(200))
        assert resp.status_code == 429 and resp.json()["error"] == "rate_limited"
        assert 0 < int(resp.headers["retry-after"]) <= 3600
        assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}, headers=xff(201)).status_code == 429


def test_successful_pairing_is_unaffected_before_the_cap(settings_factory, engine, make_pairing_code):
    settings = settings_factory(trust_proxy_headers=True, pairing_attempts_per_hour=100)
    with TestClient(create_app(settings, engine=engine)) as c:
        for i in range(19):
            assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}, headers=xff(i)).status_code == 400
        for j in range(5):  # successes do not count towards the cap
            code = make_pairing_code(settings.db_path)
            assert c.post("/v1/pair", json={"pairing_code": code}, headers=xff(100 + j)).status_code == 200
        # malformed bodies (422) are not pairing guesses and do not count either
        assert c.post("/v1/pair", content=b"not json", headers=xff(150)).status_code == 422
        code = make_pairing_code(settings.db_path)
        assert c.post("/v1/pair", json={"pairing_code": code}, headers=xff(151)).status_code == 200
        # the 20th failure (wrong-format codes count too) closes pairing
        assert c.post("/v1/pair", json={"pairing_code": "abc"}, headers=xff(19)).status_code == 400
        code = make_pairing_code(settings.db_path)
        assert c.post("/v1/pair", json={"pairing_code": code}, headers=xff(152)).status_code == 429


def test_global_pairing_cap_lifts_after_the_hour(settings_factory, engine, make_pairing_code):
    settings = settings_factory(pairing_attempts_per_hour=100, pairing_failures_per_hour_global=3)
    app = create_app(settings, engine=engine)
    clock = Clock()
    app.state.bridge.pair_failures = SlidingWindowLimiter([(3, 3600.0)], max_keys=1, clock=clock)
    with TestClient(app) as c:
        for _ in range(3):
            assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}).status_code == 400
        code = make_pairing_code(settings.db_path)
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 429
        clock.t += 3599
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 429
        clock.t += 2
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 200


def test_trust_proxy_headers_is_documented_as_overwrite_only():
    here = os.path.dirname(__file__)
    for rel in ("../bridge_service/config.py", "../README.md", "../.env.example"):
        text = open(os.path.join(here, rel), encoding="utf-8").read()
        assert "overwrite" in text.lower() and "X-Forwarded-For" in text, rel


# =============================================================================== L-3 nonces / auth


def test_nonce_is_recorded_only_after_the_token_is_validated(client, device, body):
    state = client.app.state.bridge
    nonce = str(uuid.uuid4())
    ts = str(int(time.time() * 1000))
    for _ in range(3):
        resp = client.post(
            "/v1/drafts",
            json=body(),
            headers={"Authorization": "Bearer not-a-token", "X-Bridge-Timestamp": ts, "X-Bridge-Nonce": nonce},
        )
        assert resp.status_code == 401
    assert len(state.replay._nonces) == 0
    # the same nonce is still fresh for the real device
    assert post_draft(client, device, body(), **{"X-Bridge-Nonce": nonce}).status_code == 200
    assert len(state.replay._nonces) == 1


def test_per_device_nonce_quota_limits_only_that_device(settings_factory, engine, pair, body):
    settings = settings_factory(nonce_quota_per_device=10, rate_limit_per_minute=1000, rate_limit_per_day=10_000)
    with TestClient(create_app(settings, engine=engine)) as c:
        greedy, other = pair(c, settings), pair(c, settings)
        bad = body(conversation_ref="not-hex")  # 422 after auth: still consumes a nonce
        for _ in range(10):
            assert post_draft(c, greedy, bad).status_code == 422
        resp = post_draft(c, greedy, body())
        assert resp.status_code == 429 and resp.json()["error"] == "rate_limited"
        assert 0 < int(resp.headers["retry-after"]) <= 2 * settings.replay_window_seconds
        assert post_draft(c, other, body()).status_code == 200  # other devices unaffected


def test_replay_guard_device_quota_frees_up_as_nonces_expire():
    clock = Clock()
    wall = {"now": 1_000_000_000}
    guard = ReplayGuard(300, 10_000, wall_clock_ms=lambda: wall["now"], per_device_quota=3, clock=clock)
    ts = str(wall["now"])
    for _ in range(3):
        assert guard.check("d1", ts, str(uuid.uuid4())) is ReplayVerdict.OK
    assert guard.check("d1", ts, str(uuid.uuid4())) is ReplayVerdict.DEVICE_QUOTA
    assert guard.check("d2", ts, str(uuid.uuid4())) is ReplayVerdict.OK
    assert guard.live_nonces("d1") == 3 and guard.quota_retry_after("d1") == 600
    clock.t += 601
    assert guard.check("d1", ts, str(uuid.uuid4())) is ReplayVerdict.OK
    guard.forget_device("d1")
    assert guard.live_nonces("d1") == 0


def test_failed_auth_is_rate_limited_per_ip_without_db_lookups(settings_factory, engine, pair, body):
    settings = settings_factory(auth_failures_per_10_minutes=5, trust_proxy_headers=True)
    app = create_app(settings, engine=engine)
    lookups = []
    real = app.state.bridge.db.get_device_by_token_hash
    app.state.bridge.db.get_device_by_token_hash = lambda h: lookups.append(h) or real(h)
    with TestClient(app) as c:
        dev = pair(c, settings)
        bad = {"Authorization": "Bearer wrong-token", **xff(9)}
        for _ in range(5):
            assert c.post("/v1/drafts", json=body(), headers=bad).status_code == 401
        assert len(lookups) == 5
        for _ in range(20):
            resp = c.post("/v1/drafts", json=body(), headers=bad)
            assert resp.status_code == 429
        assert len(lookups) == 5  # the flood no longer reaches the DB
        assert int(resp.headers["retry-after"]) > 0
        assert c.post("/v1/drafts", json=body(), headers=xff(9)).status_code == 429  # no header at all
        # another IP (and the real device behind it) is unaffected
        assert post_draft(c, dev, body(), **xff(10)).status_code == 200


def test_failed_auth_limit_window_is_ten_minutes(settings_factory, engine, body):
    settings = settings_factory(auth_failures_per_10_minutes=2)
    app = create_app(settings, engine=engine)
    clock = Clock()
    app.state.bridge.auth_failures = SlidingWindowLimiter([(2, 600.0)], clock=clock)
    with TestClient(app) as c:
        h = {"Authorization": "Bearer nope"}
        assert [c.post("/v1/drafts", json=body(), headers=h).status_code for _ in range(3)] == [401, 401, 429]
        clock.t += 601
        assert c.post("/v1/drafts", json=body(), headers=h).status_code == 401


# =============================================================================== L-4 idempotency


def test_same_request_id_with_different_body_is_rejected(client, device, body, engine):
    first = body()
    assert post_draft(client, device, first).status_code == 200
    other = body(request_id=first["request_id"], conversation_ref="b" * 64)
    resp = post_draft(client, device, other)
    assert resp.status_code == 422
    assert resp.json() == {"error": "invalid_request", "message": "מזהה הבקשה כבר שימש לבקשה אחרת"}
    assert MESSAGE_REQUEST_ID_REUSED == "מזהה הבקשה כבר שימש לבקשה אחרת"
    assert first["conversation_ref"] not in resp.text and "draft_text" not in resp.text
    changed_msg = body(request_id=first["request_id"], messages=[{"text": "אחר", "sent_at": 1}])
    assert post_draft(client, device, changed_msg).status_code == 422
    assert len(engine.calls) == 1
    # the original body still gets its cached draft
    assert post_draft(client, device, first).status_code == 200
    assert len(engine.calls) == 1


def test_same_body_with_other_formatting_still_hits_the_cache(client, device, body, engine):
    import json as _json

    payload = body()
    first = post_draft(client, device, payload)
    reordered = dict(reversed(list(payload.items())))
    reordered["request_id"] = payload["request_id"].upper()
    reordered["unknown_field"] = "ignored"
    raw = _json.dumps(reordered, indent=2, ensure_ascii=True).encode()
    second = client.post(
        "/v1/drafts", content=raw, headers={**device.headers(), "Content-Type": "application/json"}
    )
    assert second.status_code == 200 and second.json() == first.json()
    assert len(engine.calls) == 1


def test_contract_documents_request_id_reuse_rejection():
    path = os.path.join(os.path.dirname(__file__), "..", "..", "API_CONTRACT.md")
    text = open(path, encoding="utf-8").read()
    assert "even if the body differs" not in text
    assert "מזהה הבקשה כבר שימש לבקשה אחרת" in text


# =============================================================================== L-10 retention


def test_purge_deletes_only_devices_revoked_over_30_days_ago(tmp_path):
    db = Database(tmp_path / "b.sqlite3")
    db.migrate()
    now = int(time.time())
    with db.connect() as conn:
        for dev_id, revoked in [("dev_old", now - 31 * DAY_SECONDS), ("dev_recent", now - 29 * DAY_SECONDS),
                                ("dev_active", None)]:
            conn.execute(
                "INSERT INTO devices(id, token_sha256, name, created_at, last_seen_at, revoked_at)"
                " VALUES (?, ?, 'P', ?, NULL, ?)",
                (dev_id, sha256_hex(dev_id), now - 40 * DAY_SECONDS, revoked),
            )
        conn.execute("INSERT INTO pairing_codes VALUES ('dead', ?, ?, NULL)", (now - 3 * DAY_SECONDS, now - 2 * DAY_SECONDS))
    result = db.purge()
    assert result.devices == 1 and result.pairing_codes == 1
    assert sorted(d.id for d in db.list_devices()) == ["dev_active", "dev_recent"]
    assert db.purge().devices == 0


def test_admin_purge_command(settings, capsys):
    db = Database(settings.db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO devices VALUES ('dev_gone', 'h', 'P', 1, NULL, ?)", (int(time.time()) - 60 * DAY_SECONDS,)
        )
    assert admin.main(["purge"], settings=settings) == 0
    assert "purged 1 revoked device" in capsys.readouterr().out
    assert db.get_device("dev_gone") is None


def test_startup_purges_long_revoked_devices(settings, engine):
    db = Database(settings.db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO devices VALUES ('dev_gone', 'h', 'P', 1, NULL, ?)", (int(time.time()) - 31 * DAY_SECONDS,)
        )
    create_app(settings, engine=engine)
    assert db.get_device("dev_gone") is None


def test_last_seen_at_has_day_granularity(client, device, settings, body):
    assert post_draft(client, device, body()).status_code == 200
    dev = Database(settings.db_path).get_device(device.device_id)
    today = int(time.time()) // DAY_SECONDS * DAY_SECONDS
    assert dev.last_seen_at == today and dev.last_seen_at % DAY_SECONDS == 0


def test_touch_device_writes_at_most_once_per_day(tmp_path):
    db = Database(tmp_path / "b.sqlite3")
    db.migrate()
    with db.connect() as conn:
        conn.execute("INSERT INTO devices VALUES ('d', 'h', 'P', 1, 0, NULL)")
    db.touch_device("d")
    today = int(time.time()) // DAY_SECONDS * DAY_SECONDS
    assert db.get_device("d").last_seen_at == today
    db.touch_device("d", min_interval_seconds=0)
    assert db.get_device("d").last_seen_at == today


def test_migration_v2_coarsens_existing_last_seen_and_is_idempotent(tmp_path):
    path = tmp_path / "old.sqlite3"
    db = Database(path)
    # Simulate a database created by the previous release (schema v1 only).
    import bridge_service.storage.db as dbmod

    v1_only = tuple(m for m in MIGRATIONS if m[0] == 1)
    original = dbmod.MIGRATIONS
    dbmod.MIGRATIONS = v1_only
    try:
        assert db.migrate() == [1]
    finally:
        dbmod.MIGRATIONS = original
    precise = 1_763_236_845  # 2025-11-15 19:20:45 UTC
    with db.connect() as conn:
        conn.execute("INSERT INTO devices VALUES ('d', 'h', 'P', 1, ?, NULL)", (precise,))
    assert db.migrate() == [2]
    assert db.get_device("d").last_seen_at == precise - precise % DAY_SECONDS
    assert db.migrate() == []
    assert db.schema_version() == 2
    assert db.get_device("d").last_seen_at == precise - precise % DAY_SECONDS


def test_list_devices_shows_last_seen_as_date_only(settings, capsys):
    db = Database(settings.db_path)
    db.migrate()
    with db.connect() as conn:
        conn.execute("INSERT INTO devices VALUES ('dev_1', 'h', 'P', 1, ?, NULL)", (20_407 * DAY_SECONDS,))
    assert admin.main(["list-devices"], settings=settings) == 0
    line = [ln for ln in capsys.readouterr().out.splitlines() if ln.startswith("dev_1")][0]
    cols = line.split()  # id, status, created date, created time, last-seen DATE, name
    assert cols[4] == "2025-11-15" and cols[5] == "P"


# =============================================================================== L-11 pepper


def test_pepper_file_is_created_next_to_db_with_0600_and_not_in_db(settings, engine, make_pairing_code):
    with TestClient(create_app(settings, engine=engine)) as c:
        pepper_file = pepper_path_for(settings.db_path)
        assert pepper_file.name == "pepper.key"
        assert str(pepper_file.parent) == os.path.dirname(settings.db_path)
        assert stat.S_IMODE(os.stat(pepper_file).st_mode) == 0o600
        pepper = pepper_file.read_text().strip()
        assert len(pepper) >= 64
        code = make_pairing_code(settings.db_path)
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 200
    for p in [settings.db_path, settings.db_path + "-wal"]:
        if os.path.exists(p):
            assert pepper.encode() not in open(p, "rb").read()


def test_pairing_code_hash_is_hmac_with_pepper(tmp_path):
    a = hash_pairing_code("ABCD2345", b"a" * 32)
    b = hash_pairing_code("ABCD2345", b"b" * 32)
    assert a != b and len(a) == 64
    assert a != sha256_hex("pairing:ABCD2345")  # the old unsalted scheme
    with pytest.raises(ValueError):
        hash_pairing_code("ABCD2345", b"")


def test_old_unsalted_codes_stop_working_after_upgrade(settings, engine):
    db = Database(settings.db_path)
    db.migrate()
    code = generate_pairing_code()
    db.add_pairing_code(sha256_hex("pairing:" + code), 600)  # stored by the previous release
    with TestClient(create_app(settings, engine=engine)) as c:
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 400


def test_configured_pepper_is_used_and_no_file_is_written(settings_factory, engine, make_pairing_code):
    settings = settings_factory(pairing_pepper="configured-pepper-0123456789")
    with TestClient(create_app(settings, engine=engine)) as c:
        assert c.app.state.bridge.pairing_pepper == b"configured-pepper-0123456789"
        code = make_pairing_code(settings.db_path, pepper="configured-pepper-0123456789")
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 200
        assert not pepper_path_for(settings.db_path).exists()  # configured → no pepper file
        file_code = make_pairing_code(settings.db_path)  # hashed with a *different* (file) pepper
    with TestClient(create_app(settings, engine=engine)) as c:
        assert c.post("/v1/pair", json={"pairing_code": file_code}).status_code == 400


def test_pepper_is_stable_across_restarts_and_admin(settings, engine, capsys):
    first = load_or_create_pepper(pepper_path_for(settings.db_path))
    assert load_or_create_pepper(pepper_path_for(settings.db_path)) == first
    assert admin.main(["create-pairing-code"], settings=settings) == 0
    code = capsys.readouterr().out.strip()
    with TestClient(create_app(settings, engine=engine)) as c:  # new process-equivalent
        assert c.app.state.bridge.pairing_pepper == first
        assert c.post("/v1/pair", json={"pairing_code": code}).status_code == 200


def test_short_configured_pepper_is_rejected(tmp_path):
    from pydantic import ValidationError

    from bridge_service.config import Settings

    with pytest.raises(ValidationError):
        Settings(db_path=str(tmp_path / "x.db"), pairing_pepper="short")
    secret = "s3cret-pepper-value-xyz"
    assert secret not in repr(Settings(db_path=str(tmp_path / "x.db"), pairing_pepper=secret))


def test_sqlite_has_no_pepper_column(settings, engine):
    create_app(settings, engine=engine)
    conn = sqlite3.connect(settings.db_path)
    cols = {r[1] for t in ("devices", "pairing_codes") for r in conn.execute(f"PRAGMA table_info({t})")}
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert not any("pepper" in x for x in cols | tables)
