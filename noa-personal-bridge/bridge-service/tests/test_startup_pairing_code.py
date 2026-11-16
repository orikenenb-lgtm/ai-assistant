"""BRIDGE_STARTUP_PAIRING_CODE: hosted deployments (Railway) read the one-time code from the log."""

import logging
import re

from fastapi.testclient import TestClient

from bridge_service.config import Settings
from bridge_service.main import create_app
from bridge_service.ai.stub import StubEngine


def _settings(tmp_path, **kw):
    return Settings(enabled=True, db_path=str(tmp_path / "bridge.sqlite3"), **kw)


def test_startup_code_is_logged_and_pairs_once(tmp_path, caplog):
    caplog.set_level(logging.WARNING, logger="bridge_service")
    app = create_app(_settings(tmp_path, startup_pairing_code=True), engine=StubEngine())
    records = [r for r in caplog.records if getattr(r, "event", None) == "startup_pairing_code"]
    assert len(records) == 1
    code = re.search(r"PAIRING CODE: ([0-9A-Z]{8})", records[0].getMessage()).group(1)
    with TestClient(app) as client:
        first = client.post("/v1/pair", json={"pairing_code": code, "device_name": "t"})
        assert first.status_code == 200, first.text
        again = client.post("/v1/pair", json={"pairing_code": code, "device_name": "t"})
        assert again.status_code == 400  # single use


def test_no_startup_code_by_default(tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="bridge_service")
    create_app(_settings(tmp_path), engine=StubEngine())
    assert not [r for r in caplog.records if getattr(r, "event", None) == "startup_pairing_code"]
    assert "PAIRING CODE" not in caplog.text
