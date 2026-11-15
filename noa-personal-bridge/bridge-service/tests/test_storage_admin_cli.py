from fastapi.testclient import TestClient

from bridge_service import admin
from bridge_service.main import create_app
from bridge_service.storage.db import Database


def test_init_db(settings, capsys):
    assert admin.main(["init-db"], settings=settings) == 0
    assert "schema version: 1" in capsys.readouterr().out


def test_create_code_pair_list_revoke(settings, engine, capsys):
    assert admin.main(["create-pairing-code", "--ttl-minutes", "5"], settings=settings) == 0
    code = capsys.readouterr().out.strip()
    assert len(code) == 8

    with TestClient(create_app(settings, engine=engine)) as c:
        resp = c.post("/v1/pair", json={"pairing_code": code, "device_name": "Pixel 9"})
        assert resp.status_code == 200
        token = resp.json()["device_token"]
        device_id = resp.json()["device_id"]

    assert admin.main(["list-devices"], settings=settings) == 0
    out = capsys.readouterr().out
    assert device_id in out and "Pixel 9" in out and "active" in out
    assert token not in out

    assert admin.main(["revoke-device", device_id], settings=settings) == 0
    assert Database(settings.db_path).get_device(device_id).revoked
    assert admin.main(["list-devices"], settings=settings) == 0
    assert "revoked" in capsys.readouterr().out
    assert admin.main(["revoke-device", "dev_missing"], settings=settings) == 1


def test_create_code_rejects_bad_ttl(settings):
    assert admin.main(["create-pairing-code", "--ttl-minutes", "0"], settings=settings) == 2


def test_list_devices_empty(settings, capsys):
    assert admin.main(["list-devices"], settings=settings) == 0
    assert "no devices" in capsys.readouterr().out
