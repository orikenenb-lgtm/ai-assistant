"""Per-app runtime state (one instance per ``create_app`` call — no module globals)."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Hashable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from bridge_service.ai.base import DraftEngine
from bridge_service.config import Settings
from bridge_service.security.ratelimit import SlidingWindowLimiter
from bridge_service.security.replay import ReplayGuard
from bridge_service.storage.db import Database
from bridge_service.storage.memory import TTLStore


class KeyedLocks:
    """One asyncio.Lock per key, removed once nobody holds or waits for it."""

    def __init__(self) -> None:
        self._locks: dict[Hashable, list[Any]] = {}

    @asynccontextmanager
    async def hold(self, key: Hashable) -> AsyncIterator[None]:
        entry = self._locks.get(key)
        if entry is None:
            entry = [asyncio.Lock(), 0]
            self._locks[key] = entry
        entry[1] += 1
        try:
            async with entry[0]:
                yield
        finally:
            entry[1] -= 1
            if entry[1] == 0:
                self._locks.pop(key, None)

    def __len__(self) -> int:
        return len(self._locks)


@dataclass
class BridgeState:
    settings: Settings
    db: Database
    engine: DraftEngine
    replay: ReplayGuard
    draft_limiter: SlidingWindowLimiter
    pair_limiter: SlidingWindowLimiter
    idempotency: TTLStore[dict[str, Any]]
    idempotency_locks: KeyedLocks = field(default_factory=KeyedLocks)
    engine_slots: asyncio.Semaphore | None = None

    @classmethod
    def build(cls, settings: Settings, db: Database, engine: DraftEngine) -> BridgeState:
        cap = settings.memory_max_entries
        return cls(
            settings=settings,
            db=db,
            engine=engine,
            replay=ReplayGuard(settings.replay_window_seconds, cap),
            draft_limiter=SlidingWindowLimiter(
                [(settings.rate_limit_per_minute, 60.0), (settings.rate_limit_per_day, 86_400.0)],
                max_keys=cap,
            ),
            pair_limiter=SlidingWindowLimiter(
                [(settings.pairing_attempts_per_hour, 3_600.0)], max_keys=cap
            ),
            idempotency=TTLStore(cap),
            engine_slots=asyncio.Semaphore(settings.max_concurrent_drafts),
        )

    @property
    def engine_name(self) -> str:
        return str(getattr(self.engine, "name", self.settings.engine))

    def is_enabled(self) -> bool:
        if not self.settings.enabled:
            return False
        kill = self.settings.kill_switch_file
        return not (kill and os.path.exists(kill))
