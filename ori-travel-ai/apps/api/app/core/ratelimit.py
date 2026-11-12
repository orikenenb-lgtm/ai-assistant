"""Simple in-process sliding-window rate limiter.

Adequate for a single-process local family deployment. A multi-process
deployment would need a shared store (documented as a known limitation).
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from app.core.errors import RateLimitedError


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> bool:
        """Register a hit; return True when allowed, False when over the limit."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def is_blocked(self, key: str, limit: int, window_seconds: float) -> bool:
        """True when `key` already has `limit` hits in the window (does not register a hit)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window_seconds:
                q.popleft()
            return len(q) >= limit

    def check(self, key: str, limit: int, window_seconds: float, message: str | None = None) -> None:
        if not self.hit(key, limit, window_seconds):
            raise RateLimitedError(message)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
