"""Replay protection: timestamp within ±window and a nonce accepted once per device.

Only called AFTER the bearer token has been validated (see ``security.auth.require_device``),
so unauthenticated requests can never fill the nonce store. Each device may additionally hold
at most ``per_device_quota`` live nonces (security review L-3): a misbehaving or compromised
device gets 429 for itself, without starving the shared store for other devices.
"""

from __future__ import annotations

import math
import time
import uuid
from collections import deque
from collections.abc import Callable
from enum import Enum

from bridge_service.storage.memory import StoreFull, TTLStore

DEFAULT_PER_DEVICE_QUOTA = 200


class ReplayVerdict(Enum):
    OK = "ok"
    BAD_HEADERS = "bad_headers"
    STALE_OR_FUTURE = "stale_or_future"
    NONCE_REUSED = "nonce_reused"
    STORE_FULL = "store_full"
    DEVICE_QUOTA = "device_quota"


class ReplayGuard:
    def __init__(
        self,
        window_seconds: int,
        max_entries: int,
        wall_clock_ms: Callable[[], int] = lambda: int(time.time() * 1000),
        per_device_quota: int = DEFAULT_PER_DEVICE_QUOTA,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.window_ms = window_seconds * 1000
        # A nonce must be remembered for as long as its timestamp could still be accepted:
        # ts ≤ now + window at insertion and accepted until ts + window → at most 2×window.
        self._ttl_seconds = 2 * window_seconds
        self._wall_clock_ms = wall_clock_ms
        self._clock = clock
        self._nonces: TTLStore[bool] = TTLStore(max_entries, clock=clock)
        self.per_device_quota = per_device_quota
        # device id → expiry times (monotonic, ascending) of that device's live nonces.
        self._per_device: dict[str, deque[float]] = {}

    def _live(self, device_id: str) -> deque[float]:
        expiries = self._per_device.get(device_id)
        if expiries is None:
            expiries = deque()
            self._per_device[device_id] = expiries
        now = self._clock()
        while expiries and expiries[0] <= now:
            expiries.popleft()
        return expiries

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
        key = (device_id, nonce_norm)
        if self._nonces.get(key) is not None:
            return ReplayVerdict.NONCE_REUSED
        expiries = self._live(device_id)
        if len(expiries) >= self.per_device_quota:
            return ReplayVerdict.DEVICE_QUOTA
        try:
            fresh = self._nonces.add_if_absent(key, True, self._ttl_seconds)
        except StoreFull:
            return ReplayVerdict.STORE_FULL
        if not fresh:  # pragma: no cover - checked above; kept for safety
            return ReplayVerdict.NONCE_REUSED
        expiries.append(self._clock() + self._ttl_seconds)
        return ReplayVerdict.OK

    def live_nonces(self, device_id: str) -> int:
        return len(self._live(device_id))

    def quota_retry_after(self, device_id: str) -> int:
        """Seconds until the device's oldest live nonce expires (≥ 1)."""
        expiries = self._live(device_id)
        if not expiries:
            return 1
        return max(1, math.ceil(expiries[0] - self._clock()))

    def forget_device(self, device_id: str) -> None:
        self._nonces.delete_where(lambda k: isinstance(k, tuple) and k[0] == device_id)
        self._per_device.pop(device_id, None)
