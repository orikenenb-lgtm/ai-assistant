"""Proves the privacy invariants: no message text, names, drafts or tokens in logs or on disk."""

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bridge_service.logging_setup import JsonFormatter, RedactionFilter
from bridge_service.main import create_app


def _exercise(c, settings, body, engine, engine_error_cls, marker, make_pairing_code):
    """Runs every code path that touches content, with the marker everywhere it can go."""
    code = make_pairing_code(settings.db_path)
    paired = c.post("/v1/pair", json={"pairing_code": code, "device_name": "Pixel"}).json()
    from types import SimpleNamespace

    dev = SimpleNamespace(token=paired["device_token"], device_id=paired["device_id"])

    import time
    import uuid

    def headers():
        return {
            "Authorization": f"Bearer {dev.token}",
            "X-Bridge-Timestamp": str(int(time.time() * 1000)),
            "X-Bridge-Nonce": str(uuid.uuid4()),
        }

    content = body(
        sender_display_name=f"שם-{marker}",
        messages=[{"text": f"טקסט {marker} 123456", "sent_at": 1}],
    )
    engine.draft_text = f"טיוטה {marker}"
    engine.notes = (f"הערה {marker}",)
    ok = c.post("/v1/drafts", json=content, headers=headers())
    assert ok.status_code == 200 and marker in ok.text  # the client does get its draft back
    assert c.post("/v1/drafts", json=content, headers=headers()).status_code == 200  # cached
    engine.error = engine_error_cls(f"engine leaked {marker}")
    assert c.post("/v1/drafts", json=body(messages=[{"text": marker, "sent_at": 1}]), headers=headers()).status_code == 502
    engine.error = RuntimeError(marker)
    assert c.post("/v1/drafts", json=body(messages=[{"text": marker, "sent_at": 1}]), headers=headers()).status_code == 502
    engine.error = None
    bad = body(conversation_ref=marker, messages=[{"text": marker, "sent_at": marker}])
    assert c.post("/v1/drafts", json=bad, headers=headers()).status_code == 422
    big = body(messages=[{"text": marker * 300, "sent_at": 1}])
    assert c.post("/v1/drafts", json=big, headers=headers()).status_code == 413
    assert c.post("/v1/drafts", content=marker.encode() * 5000, headers=headers()).status_code == 413
    assert c.post("/v1/pair", json={"pairing_code": marker}).status_code in (400, 422)
    return dev, code


@pytest.fixture
def exercised(settings, fake_engine_cls, body, engine_error_cls, marker, make_pairing_code, caplog):
    caplog.set_level(logging.DEBUG)
    engine = fake_engine_cls()
    with TestClient(create_app(settings, engine=engine)) as c:
        dev, code = _exercise(c, settings, body, engine, engine_error_cls, marker, make_pairing_code)
    return dev, code


def _record_strings(record: logging.LogRecord) -> list[str]:
    out = [record.getMessage()]
    out.extend(repr(v) for v in record.__dict__.values())
    return out


def test_logs_contain_no_content_names_or_tokens(exercised, caplog, marker):
    dev, code = exercised
    records = caplog.get_records("setup")
    assert len(records) >= 10, "expected request log lines"
    formatter = JsonFormatter()
    for record in records:
        blob = "\n".join(_record_strings(record)) + formatter.format(record)
        assert marker not in blob
        assert "123456" not in blob
        assert dev.token not in blob
        assert code not in blob


def test_request_log_line_has_metadata_only(exercised, caplog):
    lines = [r for r in caplog.get_records("setup") if getattr(r, "event", None) == "request"]
    drafts = [r for r in lines if r.path == "/v1/drafts" and r.status == 200]
    assert drafts
    rec = drafts[0]
    assert rec.method == "POST"
    assert rec.device.startswith("dev_") and len(rec.device) == 8
    assert len(rec.request_id) == 36
    assert isinstance(rec.latency_ms, float)


def test_sqlite_files_contain_no_content(exercised, settings, marker):
    dev, code = exercised
    db = Path(settings.db_path)
    files = [p for p in db.parent.iterdir() if p.name.startswith(db.name)]
    assert db in files
    needles = [marker.encode("utf-8"), "דנה".encode("utf-8"), dev.token.encode("ascii"), code.encode("ascii"), b"123456"]
    for path in files:
        data = path.read_bytes()
        for needle in needles:
            assert needle not in data, f"{needle!r} found in {path.name}"


def test_schema_has_no_content_tables(exercised, settings):
    import sqlite3

    conn = sqlite3.connect(settings.db_path)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    cols = {
        t: {r[1] for r in conn.execute(f"PRAGMA table_info({t})")} for t in tables
    }
    conn.close()
    assert tables == {"schema_migrations", "devices", "pairing_codes"}
    all_cols = set().union(*cols.values())
    assert not all_cols & {"text", "messages", "draft_text", "sender_display_name", "conversation_ref", "token"}


def test_redaction_filter_strips_forbidden_attributes(marker):
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "hello %(text)s", None, None)
    record.args = {"text": marker}
    for name in ("text", "messages", "draft_text", "sender_display_name", "authorization", "device_token"):
        setattr(record, name, marker)
    record.request_id = "rid"
    assert RedactionFilter().filter(record) is True
    out = JsonFormatter().format(record)
    assert marker not in out
    assert marker not in repr(record.__dict__)
    assert '"redacted": true' in out
    assert '"request_id": "rid"' in out


def test_redaction_filter_drops_exception_text(marker):
    try:
        raise ValueError(marker)
    except ValueError:
        import sys

        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "failed", None, sys.exc_info())
    RedactionFilter().filter(record)
    out = JsonFormatter().format(record)
    assert marker not in out
    assert '"exc_type": "ValueError"' in out


def test_configure_logging_installs_redacting_json_handler(capsys, marker):
    from bridge_service.logging_setup import configure_logging

    root = logging.getLogger()
    before = list(root.handlers)
    level = root.level
    try:
        configure_logging("INFO")
        configure_logging("INFO")  # idempotent
        ours = [h for h in root.handlers if getattr(h, "_bridge_handler", False)]
        assert len(ours) == 1
        logging.getLogger("bridge_service.test").info("hi", extra={"text": marker, "status": 200})
        err = capsys.readouterr().err
        assert '"status": 200' in err and marker not in err
    finally:
        for h in list(root.handlers):
            if h not in before:
                root.removeHandler(h)
        root.setLevel(level)
