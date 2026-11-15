"""Replay protection: timestamp within ±window and a nonce accepted once per device."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from enum import Enum

from bridge_service.storage.memory import StoreFull, TTLStore


class ReplayVerdict(Enum):
    OK = "ok"
    BAD_HEADERS = "bad_headers"
    STALE_OR_FUTURE = "stale_or_future"
    NONCE_REUSED = "nonce_reused"
    STORE_FULL = "store_full"


class ReplayGuard:
    def __init__(
        self,
        window_seconds: int,
        max_entries: int,
        wall_clock_ms: Callable[[], int] = lambda: int(time.time() * 1000),
    ) -> None:
        self.window_ms = window_seconds * 1000
        # A nonce must be remembered for as long as its timestamp could still be accepted:
        # ts ≤ now + window at insertion and accepted until ts + window → at most 2×window.
        self._ttl_seconds = 2 * window_seconds
        self._wall_clock_ms = wall_clock_ms
        self._nonces: TTLStore[bool] = TTLStore(max_entries)

    def check(self, device_id: str, timestamp: str | None, nonce: str | None) -> ReplayVerdict:
        if not timestamp or not nonce or len(timestamp) > 20 or len(nonce) > 64:
            return ReplayVerdict.BAD_HEADERS
        try:
            ts = int(timestamp)
            nonce_norm = str(uuid.UUID(nonce))
        except ValueError:
            return ReplayVerdict.BAD_HEADERS
        if abs(self._wall_clock_ms() - ts) > self.window_ms:
            return ReplayVerdict.STALE_OR_FUTURE
        try:
            fresh = self._nonces.add_if_absent((device_id, nonce_norm), True, self._ttl_seconds)
        except StoreFull:
            return ReplayVerdict.STORE_FULL
        return ReplayVerdict.OK if fresh else ReplayVerdict.NONCE_REUSED

    def forget_device(self, device_id: str) -> None:
        self._nonces.delete_where(lambda k: isinstance(k, tuple) and k[0] == device_id)
