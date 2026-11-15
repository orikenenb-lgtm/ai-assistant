from fastapi.testclient import TestClient

from bridge_service.main import create_app
from bridge_service.security.pairing import PAIRING_ALPHABET

GENERIC = "invalid_pairing_code"


def test_pair_success(client, settings, make_pairing_code):
    code = make_pairing_code(settings.db_path)
    resp = client.post("/v1/pair", json={"pairing_code": code, "device_name": "Galaxy S25 Ultra"})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"device_id", "device_token"}
    assert body["device_id"].startswith("dev_")
    assert len(body["device_token"]) >= 43  # 32 bytes base64url


def test_pair_code_is_case_and_dash_insensitive(client, settings, make_pairing_code):
    code = make_pairing_code(settings.db_path)
    resp = client.post("/v1/pair", json={"pairing_code": f"{code[:4].lower()}-{code[4:].lower()}"})
    assert resp.status_code == 200


def test_pair_device_name_optional(client, settings, make_pairing_code):
    code = make_pairing_code(settings.db_path)
    assert client.post("/v1/pair", json={"pairing_code": code}).status_code == 200


def _assert_generic(resp, reference=None):
    assert resp.status_code == 400
    assert resp.json()["error"] == GENERIC
    if reference is not None:
        assert resp.json() == reference


def test_invalid_expired_used_codes_share_one_message(client, settings, make_pairing_code):
    invalid = client.post("/v1/pair", json={"pairing_code": "ZZZZ2222"})
    _assert_generic(invalid)
    reference = invalid.json()

    expired = make_pairing_code(settings.db_path, ttl_seconds=-1)
    _assert_generic(client.post("/v1/pair", json={"pairing_code": expired}), reference)

    code = make_pairing_code(settings.db_path)
    assert client.post("/v1/pair", json={"pairing_code": code}).status_code == 200
    _assert_generic(client.post("/v1/pair", json={"pairing_code": code}), reference)

    # Wrong alphabet / wrong length never even reaches the DB but looks identical.
    _assert_generic(client.post("/v1/pair", json={"pairing_code": "O0I1O0I1"}), reference)
    _assert_generic(client.post("/v1/pair", json={"pairing_code": "ABC"}), reference)


def test_pair_rate_limited_per_ip(settings_factory, engine):
    app = create_app(settings_factory(pairing_attempts_per_hour=3), engine=engine)
    with TestClient(app) as c:
        for _ in range(3):
            assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}).status_code == 400
        resp = c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"})
    assert resp.status_code == 429
    assert resp.json()["error"] == "rate_limited"
    assert int(resp.headers["retry-after"]) > 0


def test_pair_rate_limit_uses_forwarded_ip_only_when_trusted(settings_factory, engine):
    app = create_app(
        settings_factory(pairing_attempts_per_hour=1, trust_proxy_headers=True), engine=engine
    )
    with TestClient(app) as c:
        h1 = {"X-Forwarded-For": "1.1.1.1, 10.0.0.1"}
        h2 = {"X-Forwarded-For": "1.1.1.1, 10.0.0.2"}
        assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}, headers=h1).status_code == 400
        assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}, headers=h1).status_code == 429
        assert c.post("/v1/pair", json={"pairing_code": "ZZZZ2222"}, headers=h2).status_code == 400


def test_pair_disabled_returns_503(settings_factory, engine, make_pairing_code):
    settings = settings_factory(enabled=False)
    app = create_app(settings, engine=engine)
    code = make_pairing_code(settings.db_path)
    with TestClient(app) as c:
        resp = c.post("/v1/pair", json={"pairing_code": code})
    assert resp.status_code == 503
    assert resp.json()["error"] == "disabled"


def test_pair_validation(client):
    resp = client.post("/v1/pair", json={"pairing_code": "ABCD2345", "device_name": "x" * 61})
    assert resp.status_code == 422
    assert resp.json()["error"] == "invalid_request"
    assert client.post("/v1/pair", json={}).status_code == 422
    assert client.post("/v1/pair", content=b"not json").status_code == 422
    assert client.post("/v1/pair", json={"pairing_code": 12345678}).status_code == 422


def test_paired_tokens_are_unique(client, settings, pair):
    a = pair(client, settings)
    b = pair(client, settings)
    assert a.token != b.token and a.device_id != b.device_id


def test_alphabet_has_no_lookalikes():
    assert not set("0O1IL U") & set(PAIRING_ALPHABET)
    assert len(PAIRING_ALPHABET) == 30
