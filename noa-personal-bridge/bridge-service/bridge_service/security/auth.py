"""FastAPI dependencies: kill switch, bearer-token auth, replay guard, client IP."""

from __future__ import annotations

import logging

from fastapi import Request
from starlette.concurrency import run_in_threadpool

from bridge_service.api.errors import ApiError
from bridge_service.api.state import BridgeState
from bridge_service.security.replay import ReplayVerdict
from bridge_service.security.tokens import MAX_TOKEN_CHARS, sha256_hex, token_matches
from bridge_service.storage.db import Device

logger = logging.getLogger("bridge_service.security")


def get_state(request: Request) -> BridgeState:
    return request.app.state.bridge


def require_enabled(request: Request) -> None:
    if not get_state(request).is_enabled():
        raise ApiError("disabled")


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token or len(token) > MAX_TOKEN_CHARS:
        return None
    return token


async def require_device(request: Request) -> Device:
    """Authenticates the bearer token (401) and then enforces timestamp/nonce (409)."""
    state = get_state(request)
    token = _bearer_token(request)
    if token is None:
        raise ApiError("unauthorized")
    device = await run_in_threadpool(state.db.get_device_by_token_hash, sha256_hex(token))
    if device is None or not token_matches(token, device.token_sha256) or device.revoked:
        raise ApiError("unauthorized")
    request.state.device_id = device.id

    verdict = state.replay.check(
        device.id,
        request.headers.get("x-bridge-timestamp"),
        request.headers.get("x-bridge-nonce"),
    )
    if verdict is ReplayVerdict.STORE_FULL:
        logger.warning("nonce store full", extra={"event": "nonce_store_full"})
        raise ApiError("rate_limited", headers={"Retry-After": "60"})
    if verdict is not ReplayVerdict.OK:
        logger.info("replay rejected", extra={"event": "replay_rejected", "error": verdict.value})
        raise ApiError("replay")

    await run_in_threadpool(state.db.touch_device, device.id)
    return device


def client_ip(request: Request, trust_proxy_headers: bool) -> str:
    """Peer address, or the last X-Forwarded-For hop when a trusted proxy appends it.

    The *last* hop is the address the proxy itself saw; earlier hops are client-controlled.
    """
    if trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            last = forwarded.split(",")[-1].strip()
            if last:
                return last[:64]
    return request.client.host if request.client else "unknown"
