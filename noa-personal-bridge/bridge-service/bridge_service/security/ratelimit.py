"""Sliding-window rate limiter (in memory, bounded number of tracked keys)."""

from __future__ import annotations

import math
import time
from collections import OrderedDict, deque
from collections.abc import Callable, Hashable, Sequence


class SlidingWindowLimiter:
    """Allows at most ``n`` hits per ``window`` seconds for every (n, window) in ``limits``.

    Memory per key is O(max n). When more than ``max_keys`` keys are tracked, the least recently
    used key is forgotten (its counters reset) — acceptable for a single-user service.
    """

    def __init__(
        self,
        limits: Sequence[tuple[int, float]],
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not limits:
            raise ValueError("at least one limit is required")
        self._limits = tuple(limits)
        self._depth = max(n for n, _ in self._limits)
        self._max_keys = max_keys
        self._clock = clock
        self._hits: OrderedDict[Hashable, deque[float]] = OrderedDict()

    def hit(self, key: Hashable) -> int | None:
        """Record one hit. Returns None if allowed, else seconds to wait (Retry-After)."""
        now = self._clock()
        hits = self._hits.get(key)
        if hits is None:
            hits = deque(maxlen=self._depth)
            self._hits[key] = hits
            while len(self._hits) > self._max_keys:
                self._hits.popitem(last=False)
        else:
            self._hits.move_to_end(key)
        retry_after = 0.0
        for n, window in self._limits:
            if len(hits) >= n and hits[-n] > now - window:
                retry_after = max(retry_after, hits[-n] + window - now)
        if retry_after > 0:
            return max(1, math.ceil(retry_after))
        hits.append(now)
        return None

    def forget(self, key: Hashable) -> None:
        self._hits.pop(key, None)
