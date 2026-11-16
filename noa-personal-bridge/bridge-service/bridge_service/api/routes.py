"""Endpoints of API_CONTRACT.md v1. No endpoint can send messages or trigger side effects."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from bridge_service import __version__
from bridge_service.ai.base import DraftInput, DraftOutput, EngineError, InboundMessage
from bridge_service.api.errors import MESSAGE_REQUEST_ID_REUSED, ApiError
from bridge_service.api.models import (
    MAX_TOTAL_CHARS,
    DraftRequest,
    PairRequest,
    is_oversize_error,
)
from bridge_service.api.state import PAIR_FAILURES_KEY, BridgeState
from bridge_service.security.auth import client_ip, get_state, require_device, require_enabled
from bridge_service.security.pairing import hash_pairing_code, normalize_pairing_code
from bridge_service.security.tokens import generate_device_id, generate_device_token, sha256_hex
from bridge_service.storage.db import Device

logger = logging.getLogger("bridge_service.api")

router = APIRouter()

DEFAULT_DEVICE_NAME = "Android"
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]")


def _sanitize_device_name(name: str | None) -> str:
    cleaned = _CONTROL_CHARS.sub("", name or "").strip()
    return cleaned[:60] or DEFAULT_DEVICE_NAME


async def _parse(request: Request, model: type, *, size_limits: bool) -> Any:
    raw = await request.body()
    try:
        return model.model_validate_json(raw)
    except ValidationError as exc:
        # Never include exc details in the response or logs: they may contain input values.
        if size_limits and is_oversize_error(exc):
            raise ApiError("too_large") from None
        raise ApiError("invalid_request") from None


@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    state = get_state(request)
    return {
        "ok": True,
        "enabled": state.is_enabled(),
        "engine": state.engine_name,
        "version": __version__,
    }


def _pair_failed(state: BridgeState) -> ApiError:
    state.pair_failures.record(PAIR_FAILURES_KEY)
    return ApiError("invalid_pairing_code")


@router.post("/v1/pair", dependencies=[Depends(require_enabled)])
async def pair(request: Request) -> JSONResponse:
    state = get_state(request)
    # Global cap first (security review L-2): too many failures across ALL IPs in the last hour
    # → every attempt is refused, whatever its IP and even with a valid code.
    retry_after = state.pair_failures.blocked(PAIR_FAILURES_KEY)
    if retry_after is not None:
        logger.warning("pairing globally rate limited", extra={"event": "pair_global_rate_limited"})
        raise ApiError("rate_limited", headers={"Retry-After": str(retry_after)})
    ip = client_ip(request, state.settings.trust_proxy_headers)
    retry_after = state.pair_limiter.hit(("pair", ip))
    if retry_after is not None:
        logger.warning("pairing rate limited", extra={"event": "pair_rate_limited"})
        raise ApiError("rate_limited", headers={"Retry-After": str(retry_after)})

    body: PairRequest = await _parse(request, PairRequest, size_limits=False)
    code = normalize_pairing_code(body.pairing_code)
    if code is None:
        raise _pair_failed(state)

    device_id = generate_device_id()
    token = generate_device_token()
    ok = await run_in_threadpool(
        state.db.redeem_pairing_code,
        hash_pairing_code(code, state.pairing_pepper),
        device_id,
        sha256_hex(token),
        _sanitize_device_name(body.device_name),
    )
    if not ok:
        logger.info("pairing failed", extra={"event": "pair_failed"})
        raise _pair_failed(state)
    request.state.device_id = device_id
    logger.info("device paired", extra={"event": "device_paired"})
    return JSONResponse({"device_id": device_id, "device_token": token})


def canonical_body_sha256(body: DraftRequest) -> str:
    """SHA-256 of the validated request in canonical JSON (sorted keys, no whitespace, request_id
    lower-cased, unknown fields dropped). Formatting / key order never changes the hash; any
    change to conversation_ref, sender, messages or locale does. Kept in memory only."""
    data = body.model_dump(mode="json")
    data["request_id"] = str(data["request_id"]).lower()
    canonical = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _to_draft_input(body: DraftRequest) -> DraftInput:
    return DraftInput(
        request_id=body.request_id.lower(),
        conversation_ref=body.conversation_ref,
        sender_display_name=body.sender_display_name or None,
        messages=tuple(InboundMessage(text=m.text, sent_at=m.sent_at) for m in body.messages),
        locale=body.locale,
    )


def _render(request_id: str, output: DraftOutput) -> dict[str, Any]:
    if not isinstance(output, DraftOutput) or not isinstance(output.draft_text, str):
        raise TypeError("engine returned an invalid DraftOutput")
    if not output.draft_text.strip():
        raise ValueError("engine returned an empty draft")
    safety = output.safety
    return {
        "request_id": request_id,
        "draft_text": output.draft_text,
        "safety": {
            "injection_suspected": bool(safety.injection_suspected),
            "sensitive_request": bool(safety.sensitive_request),
            "notes": [str(n) for n in safety.notes],
        },
        "engine": str(output.engine),
    }


async def _call_engine(state: BridgeState, data: DraftInput, request_id: str) -> dict[str, Any]:
    async def run() -> DraftOutput:
        assert state.engine_slots is not None
        async with state.engine_slots:
            return await state.engine.draft(data)

    try:
        output = await asyncio.wait_for(run(), timeout=state.settings.engine_timeout_seconds)
        return _render(request_id, output)
    except TimeoutError:
        logger.warning("engine timeout", extra={"event": "engine_timeout", "error": "timeout"})
    except EngineError as exc:
        logger.warning(
            "engine error",
            extra={"event": "engine_error", "exc_type": type(exc).__name__},
        )
    except Exception as exc:  # noqa: BLE001 - any engine bug is a 502, never a crash
        logger.error(
            "engine failure",
            extra={"event": "engine_failure", "exc_type": type(exc).__name__},
        )
    raise ApiError("engine_error")


@router.post("/v1/drafts", dependencies=[Depends(require_enabled)])
async def create_draft(request: Request, device: Device = Depends(require_device)) -> JSONResponse:
    state = get_state(request)
    body: DraftRequest = await _parse(request, DraftRequest, size_limits=True)
    if body.total_chars() > MAX_TOTAL_CHARS:
        raise ApiError("too_large")
    request.state.request_id = body.request_id.lower()

    key = (device.id, body.request_id.lower())
    body_hash = canonical_body_sha256(body)
    async with state.idempotency_locks.hold(key):
        cached = state.idempotency.get(key)
        if cached is not None:
            cached_hash, cached_response = cached
            if not hmac.compare_digest(cached_hash, body_hash):
                # Same request_id, different body: never hand one conversation's draft to another.
                logger.warning("request_id reused with another body", extra={"event": "idempotency_conflict"})
                raise ApiError("invalid_request", message=MESSAGE_REQUEST_ID_REUSED)
            logger.info("idempotent replay", extra={"event": "idempotent_hit"})
            return JSONResponse(cached_response)

        retry_after = state.draft_limiter.hit(device.id)
        if retry_after is not None:
            raise ApiError("rate_limited", headers={"Retry-After": str(retry_after)})

        response = await _call_engine(state, _to_draft_input(body), body.request_id)
        # Memory only (never disk): the cache is what makes client retries free and safe.
        state.idempotency.set(key, (body_hash, response), state.settings.idempotency_ttl_seconds)
        return JSONResponse(response)


@router.post("/v1/devices/revoke", status_code=204)
async def revoke_device(request: Request, device: Device = Depends(require_device)) -> Response:
    """Works even when the service is disabled: disconnecting must always be possible."""
    state = get_state(request)
    await run_in_threadpool(state.db.revoke_device, device.id)
    state.idempotency.delete_where(lambda k: isinstance(k, tuple) and k[0] == device.id)
    state.draft_limiter.forget(device.id)
    logger.info("device revoked", extra={"event": "device_revoked"})
    return Response(status_code=204)
