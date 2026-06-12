"""בדיקת עשן ראשונה — השרת עולה ו-/health מחזיר תשובה תקינה."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    """GET /health חייב להחזיר 200 עם status=ok."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "kerem-orders-api"
