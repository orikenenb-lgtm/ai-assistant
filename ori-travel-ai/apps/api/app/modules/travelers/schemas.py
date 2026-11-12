from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Literal

from pydantic import Field, field_validator

from app.schemas.common import ApiModel

_PASSPORT_RE = re.compile(r"^[A-Z0-9]{5,20}$")
_FF_RE = re.compile(r"^[A-Za-z0-9 \-/]{3,40}$")
Gender = Literal["male", "female", "other"]
SeatPref = Literal["window", "aisle", "middle", "none"]


class TravelerUpsert(ApiModel):
    legal_first_name: str = Field(..., min_length=1, max_length=80)
    legal_last_name: str = Field(..., min_length=1, max_length=80)
    date_of_birth: date
    passport_number: str | None = None
    passport_expiry: date | None = None
    nationality: str | None = None
    gender: Gender | None = None
    seat_preference: SeatPref | None = None
    meal_preference: str | None = Field(None, max_length=32)
    kosher_required: bool = False
    accessibility_needs: list[str] = Field(default_factory=list)
    frequent_flyer: str | None = None
    notes: str | None = Field(None, max_length=500)

    @field_validator("legal_first_name", "legal_last_name")
    @classmethod
    def _names(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("שם אינו יכול להיות ריק")
        return v

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v: date) -> date:
        today = date.today()
        if v >= today:
            raise ValueError("תאריך הלידה חייב להיות בעבר")
        if v < today - timedelta(days=365 * 120):
            raise ValueError("תאריך הלידה אינו סביר")
        return v

    @field_validator("passport_number")
    @classmethod
    def _passport(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().replace(" ", "").upper()
        if not v:
            return None
        if not _PASSPORT_RE.match(v):
            raise ValueError("מספר הדרכון חייב להכיל 5-20 אותיות לועזיות או ספרות")
        return v

    @field_validator("passport_expiry")
    @classmethod
    def _expiry(cls, v: date | None) -> date | None:
        if v is not None and v.year > date.today().year + 30:
            raise ValueError("תאריך תפוגת הדרכון אינו סביר")
        return v

    @field_validator("nationality")
    @classmethod
    def _nat(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        v = v.strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", v):
            raise ValueError("הלאום חייב להיות קוד מדינה בן שתי אותיות (ISO 3166-1 alpha-2)")
        return v

    @field_validator("accessibility_needs")
    @classmethod
    def _acc(cls, v: list[str]) -> list[str]:
        if len(v) > 10:
            raise ValueError("ניתן לציין עד 10 צרכי נגישות")
        out = []
        for item in v:
            item = item.strip()
            if not item or len(item) > 60:
                raise ValueError("צורך נגישות חייב להיות טקסט קצר (עד 60 תווים)")
            out.append(item)
        return out

    @field_validator("frequent_flyer")
    @classmethod
    def _ff(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not _FF_RE.match(v):
            raise ValueError("מספר הטיס המתמיד אינו תקין")
        return v


class TravelerSummary(ApiModel):
    """List entry. Viewers only get the non-sensitive fields; sensitive ones are null."""

    member_id: str
    display_name: str
    has_profile: bool = True
    has_passport: bool
    kosher_required: bool = False
    seat_preference: str | None = None
    meal_preference: str | None = None
    # Owner/adult only (null for viewers):
    passport_masked: str | None = None
    passport_expiry_month: str | None = None  # "YYYY-MM"
    nationality: str | None = None
    accessibility_needs: list[str] | None = None
    updated_at: datetime


class TravelerDetail(TravelerSummary):
    detail_level: Literal["full", "masked"]
    legal_first_name: str | None = None
    legal_last_name: str | None = None
    date_of_birth: date | None = None
    passport_expiry: date | None = None
    has_frequent_flyer: bool = False
    gender: str | None = None
    notes: str | None = None
    age_group_suggestion: str | None = None


class PassportReveal(ApiModel):
    passport_number: str
