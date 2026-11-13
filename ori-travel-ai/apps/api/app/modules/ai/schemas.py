"""Request/response contracts for /api/ai/* (see docs/architecture/api-contract.md §3.6)."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.common import ApiModel
from app.schemas.offers import CanonicalOffer

MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_ITEMS = 20
MAX_HISTORY_CHARS = 4000
MAX_PLAN_DAYS = 21


class AIStatusOut(ApiModel):
    provider: str
    available: bool
    model: str | None = None
    paid: bool
    label: str
    message: str


class ChatHistoryItem(ApiModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=MAX_HISTORY_CHARS)


class ChatContext(ApiModel):
    trip_id: str | None = Field(None, max_length=64)


class ChatRequest(ApiModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CHARS)
    history: list[ChatHistoryItem] = Field(default_factory=list, max_length=MAX_HISTORY_ITEMS)
    context: ChatContext | None = None

    @field_validator("message")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("ההודעה ריקה")
        return v


class Grounding(ApiModel):
    ok: bool = True
    removed_claims: list[str] = Field(default_factory=list)


class ChatReply(ApiModel):
    text: str
    mode: Literal["model", "fallback"]
    cards: list[CanonicalOffer] = Field(default_factory=list)
    search_ids: list[str] = Field(default_factory=list)
    clarifying_question: str | None = None
    warnings: list[str] = Field(default_factory=list)
    grounding: Grounding = Field(default_factory=Grounding)


class ToolCallOut(ApiModel):
    name: str
    # ok | error (validation/tool failure) | rejected (unknown/forbidden tool) | skipped (over the per-turn cap)
    status: Literal["ok", "error", "rejected", "skipped"]


class ChatResponse(ApiModel):
    reply: ChatReply
    tool_calls: list[ToolCallOut] = Field(default_factory=list)


class ParseRequest(ApiModel):
    text: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CHARS)


class ParseResponse(ApiModel):
    category: str | None = None
    params: dict[str, Any] | None = None
    missing_fields: list[str] = Field(default_factory=list)
    clarifying_question: str | None = None
    understood: dict[str, Any] = Field(default_factory=dict)
    assumptions: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class PlanTripRequest(ApiModel):
    destination: str = Field(..., min_length=2, max_length=100)
    start_date: date
    end_date: date
    interests: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=10)
    adults: int = Field(2, ge=1, le=9)
    children_ages: list[Annotated[int, Field(ge=0, le=17)]] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def _dates(self) -> PlanTripRequest:
        if self.end_date < self.start_date:
            raise ValueError("תאריך הסיום חייב להיות אחרי תאריך ההתחלה")
        if (self.end_date - self.start_date).days + 1 > MAX_PLAN_DAYS:
            raise ValueError(f"ניתן לתכנן עד {MAX_PLAN_DAYS} ימים")
        return self


class PlanItem(ApiModel):
    type: Literal["activity", "free"]
    time_slot: Literal["morning", "afternoon", "evening", "flexible", "day"]
    time_slot_label: str
    title: str
    offer_id: str | None = None
    start_time: str | None = None
    duration_minutes: int | None = None
    reasons: list[str] = Field(default_factory=list)
    card: CanonicalOffer | None = None


class PlanDay(ApiModel):
    date: date
    weekday: str
    label: str
    items: list[PlanItem]


class PlanTripResponse(ApiModel):
    destination: str
    destination_code: str | None = None
    start_date: date
    end_date: date
    days: list[PlanDay]
    intro: str
    intro_mode: Literal["model", "template"]
    search_id: str | None = None
    interests: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    grounding: Grounding = Field(default_factory=Grounding)
