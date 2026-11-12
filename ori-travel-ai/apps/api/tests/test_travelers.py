from __future__ import annotations

import pytest
from sqlalchemy import text

from app.core.config import get_settings, reset_settings_cache
from app.core.crypto import generate_key
from app.models import AuditEvent, FamilyMember, TravelerProfile

PAYLOAD = {
    "legal_first_name": "Dana",
    "legal_last_name": "Levi",
    "date_of_birth": "1988-03-04",
    "passport_number": "AB1234567",
    "passport_expiry": "2031-06-15",
    "nationality": "il",
    "kosher_required": True,
    "accessibility_needs": ["wheelchair"],
    "frequent_flyer": "LY123456",
}


@pytest.fixture
def member_id(auth_client):
    owner = auth_client("owner")
    return owner.post("/api/family/members", json={"display_name": "דנה", "age_group": "adult"}).json()["id"]


def test_role_matrix_mutations(auth_client, member_id):
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    assert viewer.put(f"/api/travelers/{member_id}", json=PAYLOAD).status_code == 403
    assert viewer.delete(f"/api/travelers/{member_id}").status_code == 403
    assert viewer.post(f"/api/travelers/{member_id}/passport/reveal").status_code == 403
    assert adult.put(f"/api/travelers/{member_id}", json=PAYLOAD).status_code == 200
    assert adult.delete(f"/api/travelers/{member_id}").status_code == 200
    assert adult.delete(f"/api/travelers/{member_id}").status_code == 404


def test_encrypted_at_rest(auth_client, member_id, db):
    adult = auth_client("adult")
    res = adult.put(f"/api/travelers/{member_id}", json=PAYLOAD)
    assert res.status_code == 200
    assert res.json()["nationality"] == "IL"
    row = db.execute(text("select * from traveler_profiles")).mappings().one()
    for col in ("legal_first_name_enc", "legal_last_name_enc", "date_of_birth_enc", "passport_number_enc",
                "passport_expiry_enc", "frequent_flyer_enc"):
        assert row[col].startswith("v1:")
    blob = " ".join(str(v) for v in row.values())
    for plain in ("Dana", "Levi", "1988", "AB1234567", "LY123456", "2031-06"):
        assert plain not in blob


def test_masking_and_detail_levels(auth_client, member_id):
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    adult.put(f"/api/travelers/{member_id}", json=PAYLOAD)

    lst = viewer.get("/api/travelers").json()
    assert len(lst) == 1
    item = lst[0]
    assert item["has_passport"] is True and item["passport_masked"].endswith("567")
    assert "AB1234567" not in str(item) and item["passport_expiry_month"] == "2031-06"
    assert "date_of_birth" not in item and "legal_first_name" not in item

    masked = viewer.get(f"/api/travelers/{member_id}").json()
    assert masked["detail_level"] == "masked" and masked["legal_first_name"] is None and masked["date_of_birth"] is None
    assert "AB1234567" not in str(masked)

    full = adult.get(f"/api/travelers/{member_id}").json()
    assert full["detail_level"] == "full"
    assert full["legal_first_name"] == "Dana" and full["date_of_birth"] == "1988-03-04"
    assert full["passport_masked"].endswith("567") and "AB1234567" not in str(full)
    assert full["age_group_suggestion"] == "adult"


def test_partial_update_keeps_passport(auth_client, member_id):
    adult = auth_client("adult")
    adult.put(f"/api/travelers/{member_id}", json=PAYLOAD)
    body = {k: v for k, v in PAYLOAD.items() if k not in ("passport_number", "passport_expiry", "frequent_flyer")}
    body["legal_first_name"] = "Dani"
    res = adult.put(f"/api/travelers/{member_id}", json=body).json()
    assert res["has_passport"] is True and res["legal_first_name"] == "Dani"
    res = adult.put(f"/api/travelers/{member_id}", json={**body, "passport_number": None}).json()
    assert res["has_passport"] is False


def test_validation(auth_client, member_id):
    adult = auth_client("adult")
    url = f"/api/travelers/{member_id}"
    bad = [
        {"date_of_birth": "2999-01-01"},
        {"date_of_birth": "1800-01-01"},
        {"passport_expiry": "not-a-date"},
        {"nationality": "ISR"},
        {"nationality": "1x"},
        {"accessibility_needs": ["a"] * 11},
        {"accessibility_needs": ["x" * 100]},
        {"passport_number": "<script>"},
    ]
    for patch in bad:
        res = adult.put(url, json={**PAYLOAD, **patch})
        assert res.status_code == 422, patch
    assert adult.put("/api/travelers/missing", json=PAYLOAD).status_code == 404
    assert adult.get(url).status_code == 404  # no profile yet


def test_age_group_suggestion(auth_client, member_id):
    from datetime import date, timedelta

    adult = auth_client("adult")
    today = date.today()
    for years, expected in ((1, "infant"), (10, "child"), (30, "adult")):
        dob = (today - timedelta(days=int(365.25 * years) + 10)).isoformat()
        res = adult.put(f"/api/travelers/{member_id}", json={**PAYLOAD, "date_of_birth": dob})
        assert res.json()["age_group_suggestion"] == expected


def test_reveal_requires_reauth_and_is_audited(auth_client, member_id, db):
    from app.models import AuthSession

    owner = auth_client("owner")
    owner.put(f"/api/travelers/{member_id}", json=PAYLOAD)
    # fresh login sets reauth_at; age it to simulate an old session
    sess = db.query(AuthSession).filter_by(user_id=owner.user.id).one()
    from datetime import timedelta

    from app.core.db import utcnow

    sess.reauth_at = utcnow() - timedelta(hours=1)
    db.commit()
    res = owner.post(f"/api/travelers/{member_id}/passport/reveal")
    assert res.status_code == 403 and res.json()["error"]["code"] == "REAUTH_REQUIRED"
    assert owner.post("/api/auth/reauth", json={"password": "Test-Password-123"}).status_code == 200
    res = owner.post(f"/api/travelers/{member_id}/passport/reveal")
    assert res.status_code == 200 and res.json() == {"passport_number": "AB1234567"}
    db.expire_all()
    events = db.query(AuditEvent).filter_by(action="traveler.passport_reveal").all()
    assert {e.outcome for e in events} == {"denied", "success"}
    assert "AB1234567" not in str([e.details for e in db.query(AuditEvent).all()])


def test_reveal_without_passport_is_404(auth_client, member_id):
    owner = auth_client("owner")
    owner.put(f"/api/travelers/{member_id}", json={k: v for k, v in PAYLOAD.items() if k != "passport_number"})
    assert owner.post(f"/api/travelers/{member_id}/passport/reveal").status_code == 404


def test_503_without_key(auth_client, member_id, monkeypatch):
    adult = auth_client("adult")
    monkeypatch.delenv("ORI_DATA_KEY")
    monkeypatch.setattr(get_settings(), "data_key", None)
    res = adult.put(f"/api/travelers/{member_id}", json=PAYLOAD)
    assert res.status_code == 503 and res.json()["error"]["code"] == "ENCRYPTION_UNAVAILABLE"
    reset_settings_cache()


def test_data_with_wrong_key_returns_503_not_500(auth_client, member_id, monkeypatch):
    adult = auth_client("adult")
    adult.put(f"/api/travelers/{member_id}", json=PAYLOAD)
    monkeypatch.setenv("ORI_DATA_KEY", generate_key())
    reset_settings_cache()
    res = adult.get(f"/api/travelers/{member_id}")
    assert res.status_code == 503 and res.json()["error"]["code"] == "DECRYPTION_FAILED"
    # list degrades gracefully
    assert adult.get("/api/travelers").status_code == 200
    reset_settings_cache()


def test_audit_has_no_plaintext(auth_client, member_id, db):
    adult = auth_client("adult")
    adult.put(f"/api/travelers/{member_id}", json=PAYLOAD)
    adult.delete(f"/api/travelers/{member_id}")
    dump = str([(e.action, e.details) for e in db.query(AuditEvent).all()])
    assert "traveler.create" in dump and "traveler.delete" in dump
    for plain in ("Dana", "Levi", "AB1234567", "1988"):
        assert plain not in dump
    assert db.query(TravelerProfile).count() == 0
    assert db.query(FamilyMember).filter_by(id=member_id).count() == 1
