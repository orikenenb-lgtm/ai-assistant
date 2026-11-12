"""Shared test fixtures.

Each test gets a fresh in-memory SQLite database and a fresh app instance.

Helpers:
    make_user(role="adult", email=None, password=DEFAULT_PASSWORD, attested=True) -> User
    login(client, email, password) -> dict (session body); sets X-CSRF-Token header on client
    auth_client(role="owner") -> TestClient already logged in (CSRF header set)
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
from cryptography.fernet import Fernet

os.environ["ORI_ENV"] = "test"
# Default: in-memory SQLite. Set ORI_TEST_DATABASE_URL to run the suite against
# PostgreSQL (parity check), e.g. postgresql+psycopg://postgres@127.0.0.1:5432/ori_test
os.environ["ORI_DATABASE_URL"] = os.environ.get("ORI_TEST_DATABASE_URL", "sqlite://")
os.environ["ORI_SERVE_WEB"] = "false"
os.environ["ORI_ALLOWED_HOSTS"] = "localhost,127.0.0.1,testserver"
os.environ["ORI_DATA_KEY"] = Fernet.generate_key().decode()
os.environ["ORI_AI_PROVIDER"] = "none"
os.environ["ORI_LIVE_PROVIDERS_ENABLED"] = "false"
for _k in list(os.environ):
    # Never let real provider credentials leak into tests
    if _k.startswith("ORI_") and any(s in _k for s in ("TOKEN", "API_KEY", "SECRET", "CLIENT_ID")):
        del os.environ[_k]

# Tests must never read the developer's apps/api/.env: it can hold real provider tokens and local
# switches (ORI_FX_LIVE_ENABLED, ORI_AI_PROVIDER, ...) that would change results or reach the network.
from app.core.config import Settings  # noqa: E402

Settings.model_config["env_file"] = None

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core import db as db_module  # noqa: E402
from app.core.config import reset_settings_cache  # noqa: E402
from app.core.ratelimit import limiter  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models import Base, FamilyMember, User  # noqa: E402

DEFAULT_PASSWORD = "Test-Password-123"
_counter = {"n": 0}


@pytest.fixture(autouse=True)
def _fresh_db() -> Iterator[None]:
    reset_settings_cache()
    db_module.reset_engine()
    engine = db_module.get_engine()
    Base.metadata.create_all(engine)
    limiter.reset()
    _reset_provider_state()
    yield
    _reset_provider_state()
    Base.metadata.drop_all(engine)
    db_module.reset_engine()


def _reset_provider_state() -> None:
    """Undo per-test adapter overrides and cached health results."""
    from app.modules.providers import registry
    from app.modules.providers import service as provider_service

    registry.reset_registry()
    provider_service.reset_health_cache()


@pytest.fixture
def db() -> Iterator[Session]:
    session = db_module.get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def app():
    from app.main import create_app

    return create_app()


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def make_user(db: Session) -> Callable[..., User]:
    def _make(
        role: str = "adult",
        email: str | None = None,
        password: str = DEFAULT_PASSWORD,
        attested: bool = True,
        display_name: str | None = None,
        with_member: bool = True,
    ) -> User:
        _counter["n"] += 1
        email = email or f"user{_counter['n']}@family.test"
        user = User(
            email=email.lower(),
            display_name=display_name or f"משתמש {_counter['n']}",
            role=role,
            password_hash=hash_password(password),
            legal_adult_attested=attested if role != "viewer" else False,
            is_active=True,
        )
        db.add(user)
        db.flush()
        if with_member:
            db.add(FamilyMember(display_name=user.display_name, user_id=user.id, age_group="adult"))
        db.commit()
        db.refresh(user)
        return user

    return _make


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> dict:
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    body = res.json()
    client.headers["X-CSRF-Token"] = body["csrf_token"]
    return body


@pytest.fixture
def auth_client(app, make_user) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def _make(role: str = "owner", **kwargs) -> TestClient:
        user = make_user(role=role, **kwargs)
        c = TestClient(app)
        c.__enter__()
        clients.append(c)
        login(c, user.email, kwargs.get("password", DEFAULT_PASSWORD))
        c.user = user  # type: ignore[attr-defined]
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)
