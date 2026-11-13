from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.common import ApiModel, EmailAddress

AgeGroup = Literal["adult", "child", "infant"]
Role = Literal["owner", "adult", "viewer"]


class MemberUserOut(ApiModel):
    id: str
    email: str
    role: str
    is_active: bool


class MemberOut(ApiModel):
    id: str
    display_name: str
    relation: str | None = None
    age_group: str
    is_minor: bool
    has_traveler_profile: bool
    user: MemberUserOut | None = None


class MemberCreate(ApiModel):
    display_name: str = Field(..., min_length=1, max_length=120)
    relation: str | None = Field(None, max_length=60)
    age_group: AgeGroup
    is_minor: bool | None = None

    @model_validator(mode="after")
    def _consistent(self):
        if self.is_minor is not None and self.is_minor != (self.age_group != "adult"):
            raise ValueError("קבוצת הגיל וסימון הקטין אינם עקביים")
        return self

    @field_validator("display_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("שם אינו יכול להיות ריק")
        return v


class MemberUpdate(ApiModel):
    display_name: str | None = Field(None, min_length=1, max_length=120)
    relation: str | None = Field(None, max_length=60)
    age_group: AgeGroup | None = None
    is_minor: bool | None = None

    @field_validator("display_name")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("שם אינו יכול להיות ריק")
        return v


class UserUpdate(ApiModel):
    role: Role | None = None
    is_active: bool | None = None
    legal_adult_attested: bool | None = None


class InvitationCreate(ApiModel):
    email: EmailAddress
    display_name: str = Field(..., min_length=1, max_length=120)
    role: Role
    legal_adult_attested: bool = False
    family_member_id: str | None = Field(None, max_length=32)

    @model_validator(mode="after")
    def _check(self):
        self.display_name = self.display_name.strip()
        if not self.display_name:
            raise ValueError("שם אינו יכול להיות ריק")
        return self


class InvitationOut(ApiModel):
    id: str
    email: str
    display_name: str
    role: str
    legal_adult_attested: bool
    status: Literal["pending", "accepted", "expired", "revoked"]
    family_member_id: str | None = None
    created_at: datetime
    expires_at: datetime


class InvitationCreated(ApiModel):
    invitation: InvitationOut
    invite_path: str
