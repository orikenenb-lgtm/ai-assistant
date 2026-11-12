"""Demo data: a few family members with NON-identifying preferences only.

No users, no names/dates of birth/passport numbers are ever created here.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.family import FamilyMember, TravelerProfile

DEMO_MEMBERS = [
    {"display_name": "אבא (דמו)", "relation": "אבא", "age_group": "adult", "is_minor": False,
     "prefs": {"seat_preference": "aisle", "meal_preference": "kosher", "kosher_required": True}},
    {"display_name": "אמא (דמו)", "relation": "אמא", "age_group": "adult", "is_minor": False,
     "prefs": {"seat_preference": "window", "meal_preference": "kosher", "kosher_required": True}},
    {"display_name": "נועה (דמו)", "relation": "בת", "age_group": "child", "is_minor": True,
     "prefs": {"seat_preference": "window", "meal_preference": "child", "kosher_required": True}},
    {"display_name": "איתי (דמו)", "relation": "בן", "age_group": "infant", "is_minor": True,
     "prefs": {"seat_preference": None, "meal_preference": "infant", "kosher_required": True}},
]


def seed_demo(db: Session) -> str:
    """Create the demo family members idempotently. Returns a short Hebrew summary."""
    created = 0
    profiles = 0
    for spec in DEMO_MEMBERS:
        member = db.scalar(select(FamilyMember).where(FamilyMember.display_name == spec["display_name"]))
        if member is None:
            member = FamilyMember(
                display_name=spec["display_name"],
                relation=spec["relation"],
                age_group=spec["age_group"],
                is_minor=spec["is_minor"],
            )
            db.add(member)
            db.flush()
            created += 1
        if db.scalar(select(TravelerProfile).where(TravelerProfile.family_member_id == member.id)) is None:
            db.add(TravelerProfile(family_member_id=member.id, accessibility_needs=[], **spec["prefs"]))
            profiles += 1
    db.commit()
    if created == 0 and profiles == 0:
        return "נתוני הדמו כבר קיימים — לא נוספו רשומות"
    return f"נוספו {created} בני משפחה ו-{profiles} פרופילי העדפות (נתוני דמו, ללא פרטים מזהים)"
