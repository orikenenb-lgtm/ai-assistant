"""Core authentication, session, CSRF and invitation tests (Wave 0)."""

from __future__ import annotations

from datetime import timedelta

from app.core.db import utcnow
from app.core.security import new_token, sha256_hex
from app.models import AuditEvent, AuthSession, Invitation, User
from tests.conftest import DEFAULT_PASSWORD, login


def test_health_and_ready(client):
    assert client.get("/api/health").json()["status"] == "ok"
    res = client.get("/api/ready")
    assert res.status_code == 200
    assert res.json()["checks"]["encryption"]["ok"] is True
    assert res.json()["booking_live_execution"] is False


def test_security_headers(client):
    res = client.get("/api/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "x-request-id" in res.headers
    assert res.headers["cache-control"] == "no-store"


def test_unknown_api_route_is_json_404(client):
    res = client.get("/api/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_me_requires_auth(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "UNAUTHORIZED"


def test_login_success_sets_httponly_cookie(client, make_user, db):
    user = make_user(role="owner", email="Owner@Family.test")
    res = client.post("/api/auth/login", json={"email": "owner@family.test", "password": DEFAULT_PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["email"] == "owner@family.test"
    assert body["user"]["can_book"] is True
    set_cookie = res.headers.get_list("set-cookie")
    session_cookie = next(c for c in set_cookie if c.startswith("ori_session="))
    assert "HttpOnly" in session_cookie and "SameSite=lax" in session_cookie
    # Only the hash of the token is stored
    raw = session_cookie.split(";")[0].split("=", 1)[1]
    stored = db.query(AuthSession).filter_by(user_id=user.id).one()
    assert stored.token_hash == sha256_hex(raw)
    assert stored.token_hash != raw
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["role"] == "owner"


def test_login_wrong_password_generic_error_and_audit(client, make_user, db):
    make_user(email="a@family.test")
    res = client.post("/api/auth/login", json={"email": "a@family.test", "password": "wrong-password"})
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "INVALID_CREDENTIALS"
    res2 = client.post("/api/auth/login", json={"email": "nobody@family.test", "password": "wrong-password"})
    assert res2.status_code == 401
    assert res2.json()["error"]["message"] == res.json()["error"]["message"]
    assert db.query(AuditEvent).filter_by(action="auth.login", outcome="failure").count() == 2


def test_lockout_after_failures(client, make_user, db):
    user = make_user(email="lock@family.test")
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "lock@family.test", "password": "nope-nope-1"})
    res = client.post("/api/auth/login", json={"email": "lock@family.test", "password": DEFAULT_PASSWORD})
    assert res.status_code == 429
    db.expire_all()
    assert db.get(User, user.id).locked_until is not None


def test_csrf_required_for_mutations(client, make_user):
    user = make_user(role="owner")
    login(client, user.email)
    token = client.headers.pop("X-CSRF-Token")
    res = client.post("/api/auth/logout")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_FAILED"
    client.headers["X-CSRF-Token"] = "wrong"
    assert client.post("/api/auth/logout").status_code == 403
    client.headers["X-CSRF-Token"] = token
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_foreign_origin_rejected(client, make_user):
    user = make_user(role="owner")
    login(client, user.email)
    res = client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "ORIGIN_REJECTED"


def test_non_json_mutation_rejected(client):
    res = client.post("/api/auth/login", content=b"email=a&password=b", headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert res.status_code == 415


def test_expired_and_revoked_sessions(client, make_user, db):
    user = make_user()
    login(client, user.email)
    s = db.query(AuthSession).filter_by(user_id=user.id).one()
    s.expires_at = utcnow() - timedelta(minutes=1)
    db.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_inactive_user_cannot_use_session(client, make_user, db):
    user = make_user()
    login(client, user.email)
    db.get(User, user.id).is_active = False
    db.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_change_password_revokes_other_sessions(app, make_user, db):
    from fastapi.testclient import TestClient

    user = make_user(role="owner")
    c1, c2 = TestClient(app), TestClient(app)
    login(c1, user.email)
    login(c2, user.email)
    weak = c1.post("/api/auth/change-password", json={"current_password": DEFAULT_PASSWORD, "new_password": "short"})
    assert weak.status_code == 400 and weak.json()["error"]["code"] == "WEAK_PASSWORD"
    res = c1.post("/api/auth/change-password", json={"current_password": DEFAULT_PASSWORD, "new_password": "New-Password-456"})
    assert res.status_code == 200
    assert c1.get("/api/auth/me").status_code == 200
    assert c2.get("/api/auth/me").status_code == 401
    c3 = TestClient(app)
    login(c3, user.email, "New-Password-456")


def test_reauth(client, make_user):
    user = make_user(role="owner")
    login(client, user.email)
    assert client.post("/api/auth/reauth", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/auth/reauth", json={"password": DEFAULT_PASSWORD}).status_code == 200


def _invite(db, role="adult", attested=True, hours=72) -> str:
    raw = new_token(24)
    db.add(
        Invitation(
            email="kid@family.test",
            display_name="נועה",
            role=role,
            legal_adult_attested=attested,
            token_hash=sha256_hex(raw),
            expires_at=utcnow() + timedelta(hours=hours),
        )
    )
    db.commit()
    return raw


def test_accept_invitation_flow(client, db):
    raw = _invite(db, role="viewer", attested=False)
    prev = client.post("/api/auth/invitations/preview", json={"token": raw})
    assert prev.status_code == 200 and prev.json()["role"] == "viewer"
    assert client.get(f"/api/auth/invitations/{raw}").status_code == 200  # legacy path still works
    res = client.post("/api/auth/invitations/accept", json={"token": raw, "password": "Strong-Pass-789"})
    assert res.status_code == 200, res.text
    assert res.json()["user"]["role"] == "viewer"
    assert res.json()["user"]["can_book"] is False
    # Token is single use
    again = client.post("/api/auth/invitations/accept", json={"token": raw, "password": "Strong-Pass-789"})
    assert again.status_code == 404


def test_expired_invitation_rejected(client, db):
    raw = _invite(db, hours=-1)
    assert client.get(f"/api/auth/invitations/{raw}").status_code == 404


def test_no_public_signup_route(client):
    assert client.post("/api/auth/register", json={"email": "x@y.z", "password": "Abcdefgh-123"}).status_code == 404
    assert client.post("/api/auth/signup", json={"email": "x@y.z", "password": "Abcdefgh-123"}).status_code == 404


def test_login_does_not_imply_step_up(client, make_user, db):
    """AUD-22: a fresh session is not 'recently re-authenticated'."""
    user = make_user(role="owner")
    login(client, user.email)
    session = db.query(AuthSession).filter_by(user_id=user.id).one()
    assert session.reauth_at is None
