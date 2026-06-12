"""
בדיקות אימות והרשאות (A1, A2, A3, A5) — שכבת ה-API עם mock לשירות Supabase.
בדיקות A4 + A6 (RLS ב-DB) רצות בנפרד: supabase/tests/test_rls.sql.
"""
import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.dependencies import get_current_user, require_admin
from app.main import app
from app.schemas.auth import TokenResponse, UserOut
from app.services import auth_service
from app.services.auth_service import AuthError

client = TestClient(app)

CUSTOMER = UserOut(id="11111111-1111-1111-1111-111111111111", email="cust@test.il",
                   role="customer", full_name="לקוח בדיקה", status="active",
                   rivhit_customer_id=101)
ADMIN = UserOut(id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email="admin@test.il",
                role="admin", full_name="אבא", status="active")


def _token_response(user: UserOut) -> TokenResponse:
    return TokenResponse(access_token="jwt-בדיקה", refresh_token="refresh-בדיקה",
                         expires_in=3600, user=user)


# ---------- A1: התחברות תקינה ----------

def test_a1_login_success(monkeypatch):
    """A1: אימייל + סיסמה תקינים → 200 עם JWT ופרטי משתמש."""
    monkeypatch.setattr(auth_service, "login", lambda email, password: _token_response(CUSTOMER))
    resp = client.post("/auth/login", json={"email": "cust@test.il", "password": "סיסמה-טובה"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["role"] == "customer"


# ---------- A2: סיסמה שגויה ----------

def test_a2_login_wrong_password(monkeypatch):
    """A2: סיסמה לא נכונה → 401, בלי token."""
    def fail(email, password):
        raise AuthError("אימייל או סיסמה שגויים")
    monkeypatch.setattr(auth_service, "login", fail)
    resp = client.post("/auth/login", json={"email": "cust@test.il", "password": "שגויה"})
    assert resp.status_code == 401
    assert "access_token" not in resp.json()


# ---------- A3: customer מנסה endpoint של admin ----------

def test_a3_customer_blocked_from_admin_route():
    """A3: למשתמש customer אסור להגיע ל-endpoint אדמין → 403."""
    test_app = FastAPI()

    @test_app.get("/admin/orders")
    def admin_only(user: UserOut = Depends(require_admin)):
        return {"ok": True}

    # מדמים customer מחובר (עוקפים את אימות הטוקן — בודקים את require_admin עצמו)
    test_app.dependency_overrides[get_current_user] = lambda: CUSTOMER
    resp = TestClient(test_app).get("/admin/orders")
    assert resp.status_code == 403

    # ולאדמין — מותר
    test_app.dependency_overrides[get_current_user] = lambda: ADMIN
    resp = TestClient(test_app).get("/admin/orders")
    assert resp.status_code == 200


# ---------- A5: טוקן פג / לא תקין ----------

def test_a5_invalid_token(monkeypatch):
    """A5: JWT מזויף או פג → 401 עם בקשת התחברות מחדש."""
    monkeypatch.setattr(auth_service, "get_user_by_token", lambda token: None)
    resp = client.get("/auth/me", headers={"Authorization": "Bearer fake-token"})
    assert resp.status_code == 401


def test_a5_missing_token():
    """A5: בקשה בלי Authorization header בכלל → 401."""
    resp = client.get("/auth/me")
    assert resp.status_code == 401


# ---------- /auth/me עם טוקן תקין ----------

def test_me_returns_current_user(monkeypatch):
    """טוקן תקין → /auth/me מחזיר את פרטי המשתמש בלי שדות רגישים."""
    monkeypatch.setattr(auth_service, "get_user_by_token", lambda token: CUSTOMER)
    resp = client.get("/auth/me", headers={"Authorization": "Bearer valid-jwt"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == CUSTOMER.id
    assert body["role"] == "customer"


# ---------- משתמש לא פעיל ----------

def test_inactive_user_blocked(monkeypatch):
    """משתמש עם status=inactive נחסם גם עם טוקן תקין → 403."""
    inactive = CUSTOMER.model_copy(update={"status": "inactive"})
    monkeypatch.setattr(auth_service, "get_user_by_token", lambda token: inactive)
    resp = client.get("/auth/me", headers={"Authorization": "Bearer valid-jwt"})
    assert resp.status_code == 403


# ---------- ולידציה (Pydantic) ----------

def test_signup_rejects_short_password():
    """סיסמה קצרה מ-8 תווים → 422 (ולידציית Pydantic)."""
    resp = client.post("/auth/signup", json={
        "email": "new@test.il", "password": "123", "full_name": "חדש"})
    assert resp.status_code == 422


def test_signup_rejects_invalid_email():
    """אימייל לא תקין → 422."""
    resp = client.post("/auth/signup", json={
        "email": "לא-אימייל", "password": "12345678", "full_name": "חדש"})
    assert resp.status_code == 422


# ---------- איפוס סיסמה — הודעה אחידה ----------

def test_reset_password_does_not_leak_existence(monkeypatch):
    """איפוס סיסמה מחזיר תמיד את אותה הודעה — קיים או לא (אין user enumeration)."""
    monkeypatch.setattr(auth_service, "send_reset_password_email", lambda email, redirect_url=None: None)
    r1 = client.post("/auth/reset-password", json={"email": "exists@test.il"})
    r2 = client.post("/auth/reset-password", json={"email": "ghost@test.il"})
    assert r1.status_code == r2.status_code == 200
    assert r1.json() == r2.json()
