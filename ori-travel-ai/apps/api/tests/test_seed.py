from __future__ import annotations

from app.models import FamilyMember, TravelerProfile, User
from app.seed import seed_demo


def test_seed_idempotent_and_non_identifying(db):
    msg = seed_demo(db)
    assert "4" in msg
    assert db.query(FamilyMember).count() == 4
    assert db.query(TravelerProfile).count() == 4
    assert db.query(User).count() == 0
    again = seed_demo(db)
    assert again != msg
    assert db.query(FamilyMember).count() == 4 and db.query(TravelerProfile).count() == 4

    groups = {m.display_name: (m.age_group, m.is_minor) for m in db.query(FamilyMember)}
    assert groups["נועה (דמו)"] == ("child", True) and groups["איתי (דמו)"] == ("infant", True)
    for p in db.query(TravelerProfile):
        for col in ("legal_first_name_enc", "legal_last_name_enc", "date_of_birth_enc", "passport_number_enc",
                    "passport_expiry_enc", "frequent_flyer_enc"):
            assert getattr(p, col) is None
        assert p.kosher_required is True


def test_seeded_members_visible_via_api(auth_client, db):
    seed_demo(db)
    viewer = auth_client("viewer")
    names = [m["display_name"] for m in viewer.get("/api/family/members").json()]
    assert "אבא (דמו)" in names
    lst = viewer.get("/api/travelers").json()
    assert len(lst) == 4 and all(i["has_passport"] is False for i in lst)
