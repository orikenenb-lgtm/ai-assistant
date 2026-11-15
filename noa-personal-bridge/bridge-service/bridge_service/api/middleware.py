"""Pure-ASGI middleware: request log line, security headers, body-size limit, catch-all 500."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from bridge_service.api.errors import STATUS_CODES, error_body
from bridge_service.logging_setup import device_prefix

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

logger = logging.getLogger("bridge_service.access")

SECURITY_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"cache-control", b"no-store"),
    (b"pragma", b"no-cache"),
    (b"referrer-policy", b"no-referrer"),
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cross-origin-resource-policy", b"same-origin"),
)
_SECURITY_HEADER_NAMES = frozenset(name for name, _ in SECURITY_HEADERS)


async def _send_error(send: Send, code: str) -> None:
    body = json.dumps(error_body(code), ensure_ascii=False).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": STATUS_CODES[code],
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BridgeMiddleware:
    """Outermost middleware. Never logs bodies, headers or query strings."""

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        state: dict[str, Any] = scope.setdefault("state", {})
        status_holder = {"status": 500, "started": False}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                status_holder["started"] = True
                headers = [
                    (k, v) for k, v in message.get("headers", []) if k.lower() not in _SECURITY_HEADER_NAMES
                ]
                headers.extend(SECURITY_HEADERS)
                message["headers"] = headers
            await send(message)

        try:
            body_receive = await self._buffer_body(scope, receive)
            if body_receive is None:
                await _send_error(send_wrapper, "too_large")
            else:
                await self.app(scope, body_receive, send_wrapper)
        except Exception as exc:  # noqa: BLE001 - last line of defence, content-free
            logger.error(
                "unhandled error",
                extra={"event": "unhandled_error", "exc_type": type(exc).__name__},
            )
            if not status_holder["started"]:
                await _send_error(send_wrapper, "internal_error")
        finally:
            logger.info(
                "request",
                extra={
                    "event": "request",
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status_holder["status"],
                    "latency_ms": round((time.perf_counter() - started) * 1000, 1),
                    "device": device_prefix(state.get("device_id")),
                    "request_id": state.get("request_id"),
                },
            )

    async def _buffer_body(self, scope: Scope, receive: Receive) -> Receive | None:
        """Reads the whole body (bounded). Returns a replaying ``receive`` or None if too large."""
        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > self.max_body_bytes:
                        return None
                except ValueError:
                    return None
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                # Client went away; let the app see the disconnect.
                async def disconnected() -> Message:
                    return message

                return disconnected
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_body_bytes:
                return None
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body = b"".join(chunks)
        delivered = False

        async def replay() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return replay
