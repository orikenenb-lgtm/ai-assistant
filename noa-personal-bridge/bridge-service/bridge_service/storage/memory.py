"""Bounded in-memory TTL store used for nonces and the idempotency cache.

Why memory and not SQLite: the idempotency cache necessarily contains draft text, and the
privacy invariant forbids writing drafts to disk. Nonces and rate-limit counters only need to
outlive the replay window / rate window, and the service runs as a single instance, so a
restart that forgets them is acceptable (after a restart old timestamps are still rejected by
the ±window check, so the replay exposure is limited to requests captured in the last window).
"""

from __future__ import annotations

import time
from collections import OrderedDict
from collections.abc import Callable, Hashable, Iterator
from typing import Generic, TypeVar

V = TypeVar("V")


class StoreFull(Exception):
    """Raised by ``add_if_absent`` when the store is full of unexpired entries (fail closed)."""


class TTLStore(Generic[V]):
    def __init__(
        self,
        max_entries: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max = max_entries
        self._clock = clock
        self._data: OrderedDict[Hashable, tuple[float, V]] = OrderedDict()

    def __len__(self) -> int:
        self.purge_expired()
        return len(self._data)

    def purge_expired(self) -> None:
        now = self._clock()
        # Entries are mostly inserted in expiry order (constant TTL), so stop at the first live one.
        while self._data:
            key, (expires_at, _) = next(iter(self._data.items()))
            if expires_at > now:
                break
            self._data.popitem(last=False)

    def get(self, key: Hashable) -> V | None:
        item = self._data.get(key)
        if item is None:
            return None
        expires_at, value = item
        if expires_at <= self._clock():
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: Hashable, value: V, ttl_seconds: float) -> None:
        """Insert/replace; evicts the oldest entries when full (use for caches)."""
        self.purge_expired()
        self._data.pop(key, None)
        while len(self._data) >= self._max:
            self._data.popitem(last=False)
        self._data[key] = (self._clock() + ttl_seconds, value)

    def add_if_absent(self, key: Hashable, value: V, ttl_seconds: float) -> bool:
        """Insert only if missing/expired. Never evicts live entries: raises StoreFull instead."""
        if self.get(key) is not None:
            return False
        self.purge_expired()
        if len(self._data) >= self._max:
            raise StoreFull
        self._data[key] = (self._clock() + ttl_seconds, value)
        return True

    def keys(self) -> Iterator[Hashable]:
        return iter(list(self._data.keys()))

    def delete(self, key: Hashable) -> None:
        self._data.pop(key, None)

    def delete_where(self, predicate: Callable[[Hashable], bool]) -> int:
        doomed = [k for k in self._data if predicate(k)]
        for k in doomed:
            del self._data[k]
        return len(doomed)
