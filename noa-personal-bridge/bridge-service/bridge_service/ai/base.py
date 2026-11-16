"""CONTRACT FILE (Agent 04). The boundary between the HTTP layer and the AI layer.

The API team calls `DraftEngine.draft(...)`; the AI team implements engines behind it.
Engines are tool-free by construction: they return text and never perform side effects.
"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class InboundMessage:
    text: str
    sent_at: int  # epoch millis


@dataclass(frozen=True)
class DraftInput:
    request_id: str
    conversation_ref: str  # opaque sha256 hex; never a phone number
    sender_display_name: str | None
    messages: tuple[InboundMessage, ...]
    locale: str = "he"


@dataclass(frozen=True)
class SafetyReport:
    injection_suspected: bool = False
    sensitive_request: bool = False
    notes: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class DraftOutput:
    draft_text: str
    safety: SafetyReport
    engine: str


class EngineError(Exception):
    """The engine could not produce a draft. `retryable` hints the client whether to retry later."""

    def __init__(self, message: str, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class DraftEngine(Protocol):
    name: str

    async def draft(self, data: DraftInput) -> DraftOutput: ...

    async def aclose(self) -> None: ...
