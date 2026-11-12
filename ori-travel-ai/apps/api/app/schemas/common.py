"""Shared API schema primitives."""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PlainSerializer, field_validator, model_validator

from app.core.money import SUPPORTED_CURRENCIES, quantize

Category = Literal["flight", "hotel", "car", "activity"]
DataMode = Literal["DEMO", "LIVE", "CACHED"]

# Decimal serialised as a string in JSON to avoid float rounding.
DecimalStr = Annotated[Decimal, PlainSerializer(lambda v: format(v, "f"), return_type=str, when_used="json")]

CurrencyCode = Annotated[str, Field(min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")]

_EMAIL_RE = re.compile(r"^[^@\s<>\"']{1,64}@[A-Za-z0-9.-]{1,252}\.[A-Za-z]{2,24}$")


def _validate_email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 254 or not _EMAIL_RE.match(v) or ".." in v:
        raise ValueError("כתובת אימייל אינה תקינה")
    return v


# Lenient, offline e-mail validation (no DNS lookups; allows private family domains)
EmailAddress = Annotated[str, AfterValidator(_validate_email)]


def _strip_nul(value: Any, depth: int = 0) -> Any:
    """Remove NUL characters from all incoming strings (PostgreSQL rejects them in text)."""
    if depth > 20:
        return value
    if isinstance(value, str):
        return value.replace("\x00", "") if "\x00" in value else value
    if isinstance(value, dict):
        return {(_strip_nul(k, depth + 1)): _strip_nul(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_nul(v, depth + 1) for v in value]
    return value


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def _no_nul_chars(cls, data: Any) -> Any:
        return _strip_nul(data) if isinstance(data, (dict, list, str)) else data


# Largest accepted money amount (any currency); far above any real travel price.
MAX_MONEY_AMOUNT = Decimal("1000000000000")


class Money(ApiModel):
    amount: DecimalStr = Field(..., description="Decimal amount as string in JSON, e.g. '123.45'")
    currency: CurrencyCode

    @field_validator("currency")
    @classmethod
    def _supported(cls, v: str) -> str:
        if v not in SUPPORTED_CURRENCIES:
            raise ValueError(f"Unsupported currency {v}")
        return v

    @field_validator("amount")
    @classmethod
    def _bounded(cls, v: Decimal) -> Decimal:
        # Stored as BIGINT minor units: reject non-finite, absurd or over-precise amounts
        # with a 422 instead of overflowing the database (release audit RA-03).
        if not v.is_finite():
            raise ValueError("סכום אינו תקין")
        if abs(v) >= MAX_MONEY_AMOUNT:
            raise ValueError("הסכום גדול מדי")
        exponent = v.as_tuple().exponent
        if isinstance(exponent, int) and exponent < -6:
            raise ValueError("יותר מדי ספרות אחרי הנקודה העשרונית")
        return v

    def quantized(self) -> Money:
        return Money(amount=quantize(self.amount, self.currency), currency=self.currency)


T = TypeVar("T")


class Page(ApiModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class PageParams(ApiModel):
    page: int = Field(1, ge=1, le=10_000)
    page_size: int = Field(20, ge=1, le=100)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


class OkResponse(ApiModel):
    ok: bool = True
