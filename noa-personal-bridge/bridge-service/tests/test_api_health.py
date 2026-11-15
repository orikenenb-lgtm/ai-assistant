from fastapi.testclient import TestClient

from bridge_service.main import create_app


def test_health_shape(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "enabled": True, "engine": "fake", "version": "0.1.0"}


def test_health_works_when_disabled(settings_factory, engine):
    app = create_app(settings_factory(enabled=False), engine=engine)
    with TestClient(app) as c:
        resp = c.get("/health")
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_health_reports_kill_switch(settings_factory, engine, tmp_path):
    kill = tmp_path / "KILL"
    app = create_app(settings_factory(kill_switch_file=str(kill)), engine=engine)
    with TestClient(app) as c:
        assert c.get("/health").json()["enabled"] is True
        kill.write_text("")
        assert c.get("/health").json()["enabled"] is False


def test_security_headers_and_no_cors(client):
    resp = client.get("/health", headers={"Origin": "https://evil.example"})
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["referrer-policy"] == "no-referrer"
    assert "access-control-allow-origin" not in resp.headers


def test_docs_disabled_by_default(client):
    for path in ("/docs", "/openapi.json", "/redoc"):
        resp = client.get(path)
        assert resp.status_code == 404
        assert resp.json()["error"] == "not_found"


def test_docs_enabled_with_flag(settings_factory, engine):
    app = create_app(settings_factory(debug_docs=True), engine=engine)
    with TestClient(app) as c:
        assert c.get("/openapi.json").status_code == 200
        assert c.get("/docs").status_code == 200


def test_unknown_route_and_method_use_contract_envelope(client):
    resp = client.get("/v1/nope")
    assert resp.status_code == 404
    assert set(resp.json()) == {"error", "message"}
    resp = client.get("/v1/drafts")
    assert resp.status_code == 405
    assert resp.json()["error"] == "method_not_allowed"


def test_lifespan_closes_engine(settings, engine):
    app = create_app(settings, engine=engine)
    with TestClient(app):
        assert engine.closed is False
    assert engine.closed is True
