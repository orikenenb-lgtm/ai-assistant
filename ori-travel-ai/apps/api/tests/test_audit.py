from __future__ import annotations

from app.core.audit import record_audit


def test_audit_owner_only(auth_client):
    assert auth_client("adult").get("/api/audit").status_code == 403
    assert auth_client("viewer").get("/api/audit").status_code == 403
    assert auth_client("owner").get("/api/audit").status_code == 200


def test_audit_filters_pagination_and_redaction(auth_client, db):
    owner = auth_client("owner")
    for i in range(5):
        record_audit(
            db, "x.test", actor_user_id=owner.user.id, entity_type="thing", entity_id=str(i), details={"password": "hunter2", "n": i}
        )
    record_audit(db, "y.other", entity_type="other")
    db.commit()

    res = owner.get("/api/audit?action=x.test&page_size=2").json()
    assert res["total"] == 5 and len(res["items"]) == 2
    assert res["items"][0]["details"]["password"] != "hunter2"
    assert res["items"][0]["actor_display_name"] == owner.user.display_name
    assert [i["entity_id"] for i in res["items"]] == ["4", "3"]  # newest first
    assert owner.get("/api/audit?entity_type=other").json()["total"] == 1
    assert owner.get(f"/api/audit?actor_user_id={owner.user.id}&action=y.other").json()["total"] == 0
    assert owner.get("/api/audit?page_size=1000").status_code == 422
