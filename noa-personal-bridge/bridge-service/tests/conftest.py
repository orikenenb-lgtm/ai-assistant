"""Shared fixtures for the HTTP/security/storage tests (Backend team).

The app is always built with an injected fake engine, so these tests never import
``bridge_service.ai.factory`` and never touch the network.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from bridge_service.ai.base import DraftInput, DraftOutput, EngineError, SafetyReport
from bridge_service.config import Settings
from bridge_service.main import create_app
from bridge_service.security.pairing import (
    generate_pairing_code,
    hash_pairing_code,
    resolve_pairing_pepper,
)
from bridge_service.storage.db import Database

MARKER = "MARKER-7f3a9c-סוד"  # unique string used to prove content never lands in logs/disk


@dataclass
class FakeEngine:
    """Implements the DraftEngine protocol. Configurable behaviour, records calls."""

    name: str = "fake"
    delay: float = 0.0
    error: Exception | None = None
    draft_text: str = "נשמע מעולה, נתראה ב־20:00"
    notes: tuple[str, ...] = ()
    calls: list[DraftInput] = field(default_factory=list)
    closed: bool = False

    async def draft(self, data: DraftInput) -> DraftOutput:
        self.calls.append(data)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return DraftOutput(
            draft_text=self.draft_text,
            safety=SafetyReport(injection_suspected=False, sensitive_request=False, notes=self.notes),
            engine=self.name,
        )

    async def aclose(self) -> None:
        self.closed = True


def make_settings(tmp_path: Path, **overrides: Any) -> Settings:
    base: dict[str, Any] = {
        "enabled": True,
        "db_path": str(tmp_path / "bridge.sqlite3"),
        "engine": "stub",
        "engine_timeout_seconds": 2.0,
    }
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def settings_factory(tmp_path: Path) -> Callable[..., Settings]:
    return lambda **kw: make_settings(tmp_path, **kw)


@pytest.fixture
def settings(settings_factory: Callable[..., Settings]) -> Settings:
    return settings_factory()


@pytest.fixture
def app(settings: Settings, engine: FakeEngine):
    return create_app(settings, engine=engine)


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def new_pairing_code(db_path: str, ttl_seconds: int = 600, pepper: str | None = None) -> str:
    """Create a code the app will accept: hashed with the same pepper the app resolves
    (BRIDGE_PAIRING_PEPPER if given, else ``pepper.key`` next to the DB)."""
    db = Database(db_path)
    db.migrate()
    code = generate_pairing_code()
    db.add_pairing_code(hash_pairing_code(code, resolve_pairing_pepper(pepper, db_path)), ttl_seconds)
    return code


@dataclass
class PairedDevice:
    device_id: str
    token: str

    def headers(self, *, nonce: str | None = None, timestamp_ms: int | None = None) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Bridge-Timestamp": str(timestamp_ms if timestamp_ms is not None else int(time.time() * 1000)),
            "X-Bridge-Nonce": nonce or str(uuid.uuid4()),
        }


def pair_device(client: TestClient, settings: Settings, name: str = "Galaxy S25 Ultra") -> PairedDevice:
    code = new_pairing_code(settings.db_path, pepper=settings.pairing_pepper)
    resp = client.post("/v1/pair", json={"pairing_code": code, "device_name": name})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    return PairedDevice(device_id=body["device_id"], token=body["device_token"])


@pytest.fixture
def device(client: TestClient, settings: Settings) -> PairedDevice:
    return pair_device(client, settings)


def draft_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "request_id": str(uuid.uuid4()),
        "conversation_ref": "a" * 64,
        "sender_display_name": "דנה",
        "messages": [{"text": "היי, מתי נפגשים?", "sent_at": 1763236800000}],
        "locale": "he",
    }
    body.update(overrides)
    return body


# Fixtures exposing the helpers (tests never import conftest directly).
@pytest.fixture
def marker() -> str:
    return MARKER


@pytest.fixture
def fake_engine_cls() -> type[FakeEngine]:
    return FakeEngine


@pytest.fixture
def make_pairing_code() -> Callable[..., str]:
    return new_pairing_code


@pytest.fixture
def pair() -> Callable[..., PairedDevice]:
    return pair_device


@pytest.fixture
def body() -> Callable[..., dict[str, Any]]:
    return draft_body


@pytest.fixture
def engine_error_cls() -> type[EngineError]:
    return EngineError
