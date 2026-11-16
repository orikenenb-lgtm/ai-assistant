"""Request/response schemas with the limits of API_CONTRACT.md."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, ValidationError

MAX_MESSAGES = 20
MAX_TEXT_CHARS = 2000
MAX_TOTAL_CHARS = 8000
MAX_SENDER_CHARS = 80
MAX_DEVICE_NAME_CHARS = 60

UUID4_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


class _Base(BaseModel):
    # Unknown fields are ignored (forward compatible with newer clients) and never stored.
    model_config = ConfigDict(extra="ignore", frozen=True, hide_input_in_errors=True)


class PairRequest(_Base):
    pairing_code: Annotated[StrictStr, Field(min_length=1, max_length=32)]
    device_name: Annotated[StrictStr, Field(min_length=1, max_length=MAX_DEVICE_NAME_CHARS)] | None = (
        None
    )


class PairResponse(_Base):
    device_id: str
    device_token: str


class MessageIn(_Base):
    text: Annotated[StrictStr, Field(min_length=1, max_length=MAX_TEXT_CHARS)]
    sent_at: Annotated[StrictInt, Field(ge=0)]


class DraftRequest(_Base):
    request_id: Annotated[StrictStr, Field(pattern=UUID4_PATTERN)]
    conversation_ref: Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]
    sender_display_name: Annotated[StrictStr, Field(max_length=MAX_SENDER_CHARS)] | None = None
    messages: Annotated[list[MessageIn], Field(min_length=1, max_length=MAX_MESSAGES)]
    locale: Annotated[StrictStr, Field(pattern=r"^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?$")] = "he"

    def total_chars(self) -> int:
        return sum(len(m.text) for m in self.messages)


# Validation error types that mean "over a size limit" (→ 413) rather than "malformed" (→ 422).
_OVERSIZE_TYPES = frozenset({"too_long", "string_too_long"})
_OVERSIZE_LOCS = {("messages",), ("sender_display_name",)}


def is_oversize_error(exc: ValidationError) -> bool:
    """True when any error is a length/count overage on a size-limited field."""
    for err in exc.errors(include_input=False, include_url=False):
        if err["type"] not in _OVERSIZE_TYPES:
            continue
        loc = tuple(err["loc"])
        if loc in _OVERSIZE_LOCS:
            return True
        if len(loc) == 3 and loc[0] == "messages" and loc[2] == "text":
            return True
    return False
