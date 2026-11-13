"""Shared helpers + tests for the LIVE HTTP client (all offline, httpx.MockTransport)."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.core.config import reset_settings_cache
from app.modules.providers.base import (
    ProviderError,
    ProviderNotConfiguredError,
    ProviderRateLimitedError,
    ProviderTimeoutError,
)
from app.modules.providers.live.httpclient import LiveHttp, parse_retry_after, safe_identifier

FIXTURES = Path(__file__).parent / "fixtures" / "live"


def load_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def load_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


class Recorder:
    """MockTransport handler wrapper that remembers every request (and can prove none were made)."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response] | None = None) -> None:
        self.requests: list[httpx.Request] = []
        self._handler = handler or (lambda r: httpx.Response(500))

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._handler(request)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self)


def enable_live(monkeypatch: pytest.MonkeyPatch, **env: str) -> None:
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    reset_settings_cache()


# ----------------------------------------------------------------------------- client


def _http(handler, **kw) -> LiveHttp:
    return LiveHttp(provider_label="t", base_url="https://api.example.test", headers={"X-A": "1"},
                    timeout_seconds=2, transport=httpx.MockTransport(handler), **kw)


def test_http_only_https_base_url():
    with pytest.raises(ValueError):
        LiveHttp(provider_label="t", base_url="http://api.example.test", headers={}, timeout_seconds=1)


def test_http_rejects_unsafe_paths_and_identifiers():
    rec = Recorder(lambda r: httpx.Response(200, json={}))
    with _http(rec) as http:
        for bad in ("https://evil.example/x", "//evil.example", "/a/../b", "relative"):
            with pytest.raises(ProviderError):
                http.request("GET", bad)
    assert rec.requests == []
    assert safe_identifier("off_123") == "off_123"
    for bad in ("../x", "a/b", "", None, "x" * 200, "a b"):
        with pytest.raises(ProviderError):
            safe_identifier(bad)


def test_http_redirects_are_not_followed():
    rec = Recorder(lambda r: httpx.Response(302, headers={"location": "https://evil.example/"}))
    with _http(rec) as http, pytest.raises(ProviderError):
        http.request("GET", "/x")
    assert len(rec.requests) == 1


def test_http_status_mapping():
    def run(status, **kw):
        with _http(lambda r: httpx.Response(status, **kw)) as http:
            http.request("GET", "/x")

    with pytest.raises(ProviderNotConfiguredError):
        run(401, json={})
    with pytest.raises(ProviderError) as e403:
        run(403, json={})
    assert e403.value.code == "FORBIDDEN" and not isinstance(e403.value, ProviderNotConfiguredError)
    with pytest.raises(ProviderRateLimitedError) as e429:
        run(429, json={}, headers={"retry-after": "12"})
    assert "12" in e429.value.message and e429.value.retryable
    for status in (400, 422):
        with pytest.raises(ProviderError) as e:
            run(status, json={"errors": [{"code": "bad"}]})
        assert e.value.code == "VALIDATION_ERROR" and not e.value.retryable
    with pytest.raises(ProviderError) as e500:
        run(503, text="<html>")
    assert e500.value.retryable
    with pytest.raises(ProviderError) as e404:
        run(404, json={})
    assert e404.value.code == "NOT_FOUND"


def test_http_404_allowed_and_bad_json_and_size_limit():
    with _http(lambda r: httpx.Response(404, json={})) as http:
        assert http.request("GET", "/x", allow_404=True).status == 404
    for bad in (b"not json", b"[1,2]", b"\xff\xfe"):
        with _http(lambda r, b=bad: httpx.Response(200, content=b)) as http, pytest.raises(ProviderError) as e:
            http.request("GET", "/x")
        assert e.value.code == "BAD_RESPONSE"
    with _http(lambda r: httpx.Response(200, content=b'{"data": "' + b"x" * 2000 + b'"}'), max_bytes=500) as http:
        with pytest.raises(ProviderError) as e:
            http.request("GET", "/x")
        assert e.value.code == "RESPONSE_TOO_LARGE"


def test_http_timeout_and_network_errors_are_retryable():
    def timeout(request):
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request):
        raise httpx.ConnectError("refused to https://secret-host", request=request)

    with _http(timeout) as http, pytest.raises(ProviderTimeoutError) as t:
        http.request("GET", "/x")
    assert t.value.retryable
    with _http(refused) as http, pytest.raises(ProviderError) as n:
        http.request("GET", "/x")
    assert n.value.retryable and "secret-host" not in n.value.message


def test_parse_retry_after_variants():
    now = datetime(2027, 1, 1, 12, 0, 0, tzinfo=UTC)
    assert parse_retry_after({"retry-after": "7"}) == 7
    assert parse_retry_after({"ratelimit-reset": "Fri, 01 Jan 2027 12:00:45 GMT"}, now=now) == 45
    assert parse_retry_after({"ratelimit-reset": "Fri, 01 Jan 2027 11:00:00 GMT"}, now=now) == 0
    assert parse_retry_after({"retry-after": "999999"}) == 3600
    assert parse_retry_after({"retry-after": "soon"}) is None
    assert parse_retry_after({}) is None
