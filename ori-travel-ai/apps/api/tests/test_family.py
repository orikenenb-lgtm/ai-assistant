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
    assert path.startswith("/invite/")
    token = path.removeprefix("/invite/")
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
    t1 = owner.post("/api/family/invitations", json=body).json()["invite_path"].removeprefix("/invite/")
    t2 = owner.post("/api/family/invitations", json=body).json()["invite_path"].removeprefix("/invite/")
    assert client.get(f"/api/auth/invitations/{t1}").status_code == 404
    assert client.get(f"/api/auth/invitations/{t2}").status_code == 200
    statuses = sorted(i["status"] for i in owner.get("/api/family/invitations").json())
    assert statuses == ["pending", "revoked"]


def test_revoke_and_expired_status(auth_client, client, db):
    owner = auth_client("owner")
    created = owner.post("/api/family/invitations", json={"email": "r@family.test", "display_name": "R", "role": "viewer"}).json()
    token = created["invite_path"].removeprefix("/invite/")
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
    token = created["invite_path"].removeprefix("/invite/")
    client.post("/api/auth/invitations/accept", json={"token": token, "password": DEFAULT_PASSWORD})
    db.expire_all()
    assert db.get(FamilyMember, mid).user_id is not None
    user = db.query(User).filter_by(email="g@family.test").one()
    login(client, user.email)
