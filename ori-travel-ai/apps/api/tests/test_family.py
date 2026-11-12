from __future__ import annotations

from app.core.db import utcnow
from app.core.security import sha256_hex
from app.models import AuditEvent, AuthSession, FamilyMember, Invitation, TravelerProfile, User
from tests.conftest import DEFAULT_PASSWORD, login


def test_members_crud_roles(auth_client, db):
    owner = auth_client("owner")
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    body = {"display_name": "נועה", "relation": "בת", "age_group": "child"}
    assert viewer.post("/api/family/members", json=body).status_code == 403
    res = adult.post("/api/family/members", json=body)
    assert res.status_code == 201
    mid = res.json()["id"]
    assert res.json()["is_minor"] is True
    assert viewer.get("/api/family/members").status_code == 200
    assert viewer.patch(f"/api/family/members/{mid}", json={"display_name": "x"}).status_code == 403
    res = adult.patch(f"/api/family/members/{mid}", json={"display_name": "נועה כהן"})
    assert res.json()["display_name"] == "נועה כהן"
    assert adult.delete(f"/api/family/members/{mid}").status_code == 403
    assert viewer.delete(f"/api/family/members/{mid}").status_code == 403
    assert owner.delete(f"/api/family/members/{mid}").status_code == 200
    assert db.get(FamilyMember, mid) is None
    assert db.query(AuditEvent).filter_by(action="family.member_delete").count() == 1


def test_member_list_has_user_and_profile_flag(auth_client):
    owner = auth_client("owner")
    items = owner.get("/api/family/members").json()
    mine = next(i for i in items if i["user"] and i["user"]["id"] == owner.user.id)
    assert mine["user"]["role"] == "owner" and mine["has_traveler_profile"] is False


def test_delete_member_deletes_traveler_profile(auth_client, db):
    owner = auth_client("owner")
    mid = owner.post("/api/family/members", json={"display_name": "דני", "age_group": "adult"}).json()["id"]
    res = owner.put(
        f"/api/travelers/{mid}",
        json={"legal_first_name": "Dani", "legal_last_name": "Cohen", "date_of_birth": "1985-01-02"},
    )
    assert res.status_code == 200
    assert db.query(TravelerProfile).count() == 1
    assert owner.delete(f"/api/family/members/{mid}").status_code == 200
    db.expire_all()
    assert db.query(TravelerProfile).count() == 0


def test_cannot_delete_member_of_active_owner(auth_client, db):
    owner = auth_client("owner")
    mid = db.query(FamilyMember).filter_by(user_id=owner.user.id).one().id
    res = owner.delete(f"/api/family/members/{mid}")
    assert res.status_code == 409 and res.json()["error"]["code"] == "MEMBER_LINKED_TO_OWNER"


def test_users_admin_role_matrix(auth_client):
    owner = auth_client("owner")
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    assert adult.get("/api/family/users").status_code == 403
    assert viewer.get("/api/family/users").status_code == 403
    users = owner.get("/api/family/users").json()
    assert len(users) == 3
    assert adult.patch(f"/api/family/users/{viewer.user.id}", json={"is_active": False}).status_code == 403
    assert viewer.patch(f"/api/family/users/{viewer.user.id}", json={"role": "owner"}).status_code == 403


def test_self_protection_and_last_owner(auth_client):
    owner = auth_client("owner")
    res = owner.patch(f"/api/family/users/{owner.user.id}", json={"role": "adult"})
    assert res.status_code == 409 and res.json()["error"]["code"] == "CANNOT_CHANGE_OWN_ROLE"
    res = owner.patch(f"/api/family/users/{owner.user.id}", json={"is_active": False})
    assert res.json()["error"]["code"] == "CANNOT_DEACTIVATE_SELF"
    # second owner can demote... only while another active owner remains
    owner2 = auth_client("owner")
    res = owner.patch(f"/api/family/users/{owner2.user.id}", json={"role": "adult"})
    assert res.status_code == 200
    # now owner is the only active owner; a deactivated-owner scenario: promote then deactivate other owner
    res = owner.patch(f"/api/family/users/{owner2.user.id}", json={"role": "owner"})
    assert res.status_code == 200
    res = owner2.patch(f"/api/family/users/{owner.user.id}", json={"is_active": False})
    assert res.status_code == 200  # owner2 remains
    res = owner2.patch(f"/api/family/users/{owner2.user.id}", json={"is_active": False})
    assert res.json()["error"]["code"] == "CANNOT_DEACTIVATE_SELF"


def test_last_owner_guard_blocks(auth_client, make_user, db):
    from app.modules.family.service import _active_owner_count

    owner = auth_client("owner")
    victim = make_user("owner")
    # Owners can only be removed by another active owner, so at least one always remains.
    victim_client = auth_client("owner")
    assert victim_client.patch(f"/api/family/users/{victim.id}", json={"is_active": False}).status_code == 200
    assert owner.patch(f"/api/family/users/{victim_client.user.id}", json={"is_active": False}).status_code == 200
    # owner is now the last active owner; victim_client was deactivated (session revoked)
    assert victim_client.get("/api/auth/me").status_code == 401
    db.expire_all()
    assert _active_owner_count(db) == 1
    res = owner.patch(f"/api/family/users/{owner.user.id}", json={"role": "viewer"})
    assert res.status_code == 409
    res = owner.patch(f"/api/family/users/{owner.user.id}", json={"legal_adult_attested": False})
    assert res.status_code == 400 and res.json()["error"]["code"] == "ATTESTATION_REQUIRED"


def test_deactivation_revokes_sessions(auth_client, db):
    owner = auth_client("owner")
    adult = auth_client("adult")
    assert adult.get("/api/auth/me").status_code == 200
    assert owner.patch(f"/api/family/users/{adult.user.id}", json={"is_active": False}).status_code == 200
    assert adult.get("/api/auth/me").status_code == 401
    db.expire_all()
    sessions = db.query(AuthSession).filter_by(user_id=adult.user.id).all()
    assert sessions and all(s.revoked_at is not None for s in sessions)
    assert db.query(AuditEvent).filter_by(action="family.user_update").count() == 1


def test_role_requires_attestation(auth_client, make_user):
    owner = auth_client("owner")
    viewer = make_user("viewer")
    res = owner.patch(f"/api/family/users/{viewer.id}", json={"role": "adult"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "ATTESTATION_REQUIRED"
    res = owner.patch(f"/api/family/users/{viewer.id}", json={"role": "adult", "legal_adult_attested": True})
    assert res.status_code == 200 and res.json()["can_book"] is True


def test_invitation_roles_and_validation(auth_client):
    owner = auth_client("owner")
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    body = {"email": "new@family.test", "display_name": "חדש", "role": "viewer"}
    for c in (adult, viewer):
        assert c.get("/api/family/invitations").status_code == 403
        assert c.post("/api/family/invitations", json=body).status_code == 403
        assert c.delete("/api/family/invitations/x").status_code == 403
    res = owner.post("/api/family/invitations", json={**body, "role": "adult"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "ATTESTATION_REQUIRED"
    res = owner.post("/api/family/invitations", json={**body, "email": adult.user.email})
    assert res.status_code == 409 and res.json()["error"]["code"] == "USER_EXISTS"


def test_invitation_lifecycle(auth_client, client, db):
    owner = auth_client("owner")
    res = owner.post(
        "/api/family/invitations",
        json={"email": "Grandma@Family.test", "display_name": "סבתא", "role": "adult", "legal_adult_attested": True},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["invitation"]["status"] == "pending"
    path = data["invite_path"]
    assert path.startswith("/invite#")  # token in the URL fragment: never sent to the server
    token = path.removeprefix("/invite#")
    inv = db.get(Invitation, data["invitation"]["id"])
    assert inv.token_hash == sha256_hex(token) and token not in str(data["invitation"])
    listing = owner.get("/api/family/invitations").json()
    assert listing[0]["status"] == "pending" and "token" not in str(listing)

    preview = client.get(f"/api/auth/invitations/{token}")
    assert preview.status_code == 200 and preview.json()["email"] == "grandma@family.test"
    acc = client.post("/api/auth/invitations/accept", json={"token": token, "password": DEFAULT_PASSWORD})
    assert acc.status_code == 200
    assert owner.get("/api/family/invitations").json()[0]["status"] == "accepted"
    assert owner.delete(f"/api/family/invitations/{data['invitation']['id']}").status_code == 409


def test_duplicate_pending_invitation_revokes_old(auth_client, client):
    owner = auth_client("owner")
    body = {"email": "x@family.test", "display_name": "X", "role": "viewer"}
    t1 = owner.post("/api/family/invitations", json=body).json()["invite_path"].removeprefix("/invite#")
    t2 = owner.post("/api/family/invitations", json=body).json()["invite_path"].removeprefix("/invite#")
    assert client.get(f"/api/auth/invitations/{t1}").status_code == 404
    assert client.get(f"/api/auth/invitations/{t2}").status_code == 200
    statuses = sorted(i["status"] for i in owner.get("/api/family/invitations").json())
    assert statuses == ["pending", "revoked"]


def test_revoke_and_expired_status(auth_client, client, db):
    owner = auth_client("owner")
    created = owner.post("/api/family/invitations", json={"email": "r@family.test", "display_name": "R", "role": "viewer"}).json()
    token = created["invite_path"].removeprefix("/invite#")
    assert owner.delete(f"/api/family/invitations/{created['invitation']['id']}").status_code == 200
    assert client.get(f"/api/auth/invitations/{token}").status_code == 404
    assert owner.get("/api/family/invitations").json()[0]["status"] == "revoked"
    assert owner.delete("/api/family/invitations/nope").status_code == 404

    created = owner.post("/api/family/invitations", json={"email": "e@family.test", "display_name": "E", "role": "viewer"}).json()
    inv = db.get(Invitation, created["invitation"]["id"])
    inv.expires_at = utcnow().replace(year=2000)
    db.commit()
    statuses = {i["email"]: i["status"] for i in owner.get("/api/family/invitations").json()}
    assert statuses["e@family.test"] == "expired"
    assert db.query(AuditEvent).filter_by(action="family.invitation_create").count() == 2


def test_accept_links_family_member(auth_client, client, db):
    owner = auth_client("owner")
    mid = owner.post("/api/family/members", json={"display_name": "סבא", "age_group": "adult"}).json()["id"]
    created = owner.post(
        "/api/family/invitations",
        json={"email": "g@family.test", "display_name": "סבא", "role": "viewer", "family_member_id": mid},
    ).json()
    token = created["invite_path"].removeprefix("/invite#")
    client.post("/api/auth/invitations/accept", json={"token": token, "password": DEFAULT_PASSWORD})
    db.expire_all()
    assert db.get(FamilyMember, mid).user_id is not None
    user = db.query(User).filter_by(email="g@family.test").one()
    login(client, user.email)


def test_member_age_consistency(auth_client):
    owner = auth_client("owner")
    assert owner.post("/api/family/members", json={"display_name": "a", "age_group": "adult", "is_minor": True}).status_code == 422
    assert owner.post("/api/family/members", json={"display_name": "a", "age_group": "child", "is_minor": False}).status_code == 422
    mid = owner.post("/api/family/members", json={"display_name": "a", "age_group": "adult"}).json()["id"]
    assert owner.patch(f"/api/family/members/{mid}", json={"is_minor": True}).status_code == 422
    res = owner.patch(f"/api/family/members/{mid}", json={"age_group": "infant"})
    assert res.status_code == 200 and res.json()["is_minor"] is True
    assert owner.patch(f"/api/family/members/{mid}", json={"age_group": "adult", "is_minor": True}).status_code == 422


def test_linked_member_edit_restricted(auth_client, db):
    owner = auth_client("owner")
    adult = auth_client("adult")
    owner_mid = db.query(FamilyMember).filter_by(user_id=owner.user.id).one().id
    adult_mid = db.query(FamilyMember).filter_by(user_id=adult.user.id).one().id
    assert adult.patch(f"/api/family/members/{owner_mid}", json={"display_name": "hacked"}).status_code == 403
    assert adult.patch(f"/api/family/members/{adult_mid}", json={"relation": "אמא"}).status_code == 200
    assert owner.patch(f"/api/family/members/{adult_mid}", json={"relation": "דודה"}).status_code == 200
    free = owner.post("/api/family/members", json={"display_name": "f", "age_group": "adult"}).json()["id"]
    assert adult.patch(f"/api/family/members/{free}", json={"relation": "x"}).status_code == 200


def test_minor_cannot_be_invited_as_adult(auth_client):
    owner = auth_client("owner")
    mid = owner.post("/api/family/members", json={"display_name": "נועה", "age_group": "child"}).json()["id"]
    body = {"email": "n@family.test", "display_name": "נועה", "role": "adult", "legal_adult_attested": True, "family_member_id": mid}
    res = owner.post("/api/family/invitations", json=body)
    assert res.status_code == 400 and res.json()["error"]["code"] == "MINOR_CANNOT_BE_ADULT"
    assert owner.post("/api/family/invitations", json={**body, "role": "owner"}).status_code == 400
    assert owner.post("/api/family/invitations", json={**body, "role": "viewer", "legal_adult_attested": False}).status_code == 201


def test_delete_user_rules(auth_client, make_user, db):
    from datetime import timedelta

    owner = auth_client("owner")
    other_owner = auth_client("owner")
    adult = auth_client("adult")
    adult_mid = db.query(FamilyMember).filter_by(user_id=adult.user.id).one().id
    uid = adult.user.id

    assert adult.delete(f"/api/family/users/{uid}").status_code == 403
    assert owner.delete(f"/api/family/users/{owner.user.id}").json()["error"]["code"] == "CANNOT_DELETE_SELF"
    assert owner.delete(f"/api/family/users/{other_owner.user.id}").json()["error"]["code"] == "CANNOT_DELETE_OWNER"
    assert owner.delete(f"/api/family/users/{uid}").json()["error"]["code"] == "USER_STILL_ACTIVE"
    owner.patch(f"/api/family/users/{uid}", json={"is_active": False})

    sess = db.query(AuthSession).filter_by(user_id=owner.user.id).one()
    sess.reauth_at = utcnow() - timedelta(hours=1)
    db.commit()
    res = owner.delete(f"/api/family/users/{uid}")
    assert res.status_code == 403 and res.json()["error"]["code"] == "REAUTH_REQUIRED"
    owner.post("/api/auth/reauth", json={"password": DEFAULT_PASSWORD})
    assert owner.delete(f"/api/family/users/{uid}").status_code == 200
    db.expire_all()
    assert db.get(User, uid) is None
    assert db.get(FamilyMember, adult_mid).user_id is None
    assert db.query(AuditEvent).filter_by(action="family.user_delete").count() == 1
    assert owner.delete(f"/api/family/users/{uid}").status_code == 404


def test_member_delete_scrubs_booking_names(auth_client, db):
    from app.models import Approval, BookingIntent, Offer, Reservation

    owner = auth_client("owner")
    mid = owner.post("/api/family/members", json={"display_name": "יעקב ישראלי", "age_group": "adult"}).json()["id"]
    other = owner.post("/api/family/members", json={"display_name": "שרה", "age_group": "adult"}).json()["id"]
    travelers = [
        {"family_member_id": mid, "display_name": "יעקב ישראלי", "age_group": "adult"},
        {"family_member_id": other, "display_name": "שרה", "age_group": "adult"},
    ]
    offer = Offer(provider_id="d", mode="DEMO", category="flight", supplier_offer_id="s", dedupe_key="k", title="t",
                  total_amount_minor=1, currency="ILS", price_status="known", fetched_at=utcnow(), data={})
    db.add(offer)
    db.flush()
    intent = BookingIntent(created_by_id=owner.user.id, offer_id=offer.id, category="flight", provider_id="d", offer_snapshot={},
                           travelers=travelers, quoted_amount_minor=1, current_amount_minor=1, currency="ILS")
    db.add(intent)
    db.flush()
    db.add(Approval(booking_intent_id=intent.id, terms_hash="h", approved_amount_minor=1, currency="ILS",
                    summary="נוסעים (2): יעקב ישראלי (מבוגר), שרה (מבוגר)", expires_at=utcnow()))
    db.add(Reservation(booking_intent_id=intent.id, provider_id="d", supplier_reference="R", mode="SIMULATION", amount_minor=1,
                       currency="ILS", confirmed_at=utcnow(), details={"travelers": travelers, "title": "x"}))
    db.commit()

    assert owner.delete(f"/api/family/members/{mid}").status_code == 200
    db.expire_all()
    intent = db.query(BookingIntent).one()
    assert [t["display_name"] for t in intent.travelers] == ["[נמחק]", "שרה"]
    assert intent.travelers[0]["family_member_id"] == mid
    assert [t["display_name"] for t in db.query(Reservation).one().details["travelers"]] == ["[נמחק]", "שרה"]
    summary = db.query(Approval).one().summary
    assert "יעקב" not in summary and "[נמחק]" in summary and "שרה" in summary
