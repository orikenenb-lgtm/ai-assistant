"""Family members (people) and their traveler profiles.

A *family member* is a person in the family (may or may not have a login).
A *traveler profile* holds the travel-document data for that person. All
identifying fields are encrypted at rest (see ``app.core.crypto``); only
non-identifying preferences are stored in clear text.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models._common import JSONType, created_at_col, pk, updated_at_col


class FamilyMember(Base):
    __tablename__ = "family_members"

    id: Mapped[str] = pk()
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    # free text relation, e.g. "אבא", "בת"
    relation: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # Age group used for search occupancy defaults: adult / child / infant
    age_group: Mapped[str] = mapped_column(String(16), nullable=False, default="adult")
    is_minor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    traveler_profile: Mapped[TravelerProfile | None] = relationship(
        back_populates="family_member",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )


class TravelerProfile(Base):
    __tablename__ = "traveler_profiles"

    id: Mapped[str] = pk()
    family_member_id: Mapped[str] = mapped_column(
        ForeignKey("family_members.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # ---- encrypted (ciphertext strings "v1:<fernet token>") ----
    legal_first_name_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    legal_last_name_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    date_of_birth_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    passport_number_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    passport_expiry_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    frequent_flyer_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ---- non-identifying preferences (clear text) ----
    nationality: Mapped[str | None] = mapped_column(String(2), nullable=True)  # ISO-3166 alpha-2
    gender: Mapped[str | None] = mapped_column(String(16), nullable=True)
    seat_preference: Mapped[str | None] = mapped_column(String(16), nullable=True)
    meal_preference: Mapped[str | None] = mapped_column(String(32), nullable=True)  # e.g. kosher
    kosher_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    accessibility_needs: Mapped[list[str]] = mapped_column(JSONType, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    family_member: Mapped[FamilyMember] = relationship(back_populates="traveler_profile")
