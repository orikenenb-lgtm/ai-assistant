"""AI assistant API (contract: docs/architecture/api-contract.md §3.6).

* ``GET  /api/ai/status``    — provider/availability (never returns keys).
* ``POST /api/ai/chat``      — model mode or deterministic fallback mode.
* ``POST /api/ai/parse``     — rule-based intent parser (no model needed).
* ``POST /api/ai/plan-trip`` — day-by-day plan grounded in activity search results.

All endpoints require a signed-in family member (any role); POSTs are
CSRF-checked by ``current_user``. The AI never has booking/payment functions.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user
from app.modules.ai import service
from app.modules.ai.llm import LLMClient, get_llm_client
from app.modules.ai.schemas import (
    AIStatusOut,
    ChatRequest,
    ChatResponse,
    ParseRequest,
    ParseResponse,
    PlanTripRequest,
    PlanTripResponse,
)

router = APIRouter(tags=["ai"])


@router.get("/api/ai/status", response_model=AIStatusOut)
def ai_status(ctx: AuthContext = Depends(current_user), client: LLMClient = Depends(get_llm_client)) -> AIStatusOut:
    return AIStatusOut(**client.status().as_dict())


@router.post("/api/ai/chat", response_model=ChatResponse)
def ai_chat(
    body: ChatRequest,
    request: Request,
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
    client: LLMClient = Depends(get_llm_client),
) -> ChatResponse:
    return service.chat(db, ctx.user, body, client, request=request)


@router.post("/api/ai/parse", response_model=ParseResponse)
def ai_parse(body: ParseRequest, ctx: AuthContext = Depends(current_user)) -> ParseResponse:
    return service.parse(ctx.user, body.text)


@router.post("/api/ai/plan-trip", response_model=PlanTripResponse)
def ai_plan_trip(
    body: PlanTripRequest,
    request: Request,
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
    client: LLMClient = Depends(get_llm_client),
) -> PlanTripResponse:
    return service.plan_trip(db, ctx.user, body, client, request=request)
