import uuid

import pytest

from bridge_service.security.ratelimit import SlidingWindowLimiter
from bridge_service.security.replay import ReplayGuard, ReplayVerdict


class Clock:
    def __init__(self, t: float = 1000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def make_guard(now_ms=1_000_000_000, max_entries=1000):
    holder = {"now": now_ms}
    guard = ReplayGuard(300, max_entries, wall_clock_ms=lambda: holder["now"])
    return guard, holder


def test_replay_ok_then_reused():
    guard, h = make_guard()
    n = str(uuid.uuid4())
    assert guard.check("dev_a", str(h["now"]), n) is ReplayVerdict.OK
    assert guard.check("dev_a", str(h["now"]), n) is ReplayVerdict.NONCE_REUSED
    assert guard.check("dev_a", str(h["now"]), n.upper()) is ReplayVerdict.NONCE_REUSED
    assert guard.check("dev_b", str(h["now"]), n) is ReplayVerdict.OK


@pytest.mark.parametrize("delta", [-300_001, 300_001])
def test_replay_window(delta):
    guard, h = make_guard()
    assert guard.check("d", str(h["now"] + delta), str(uuid.uuid4())) is ReplayVerdict.STALE_OR_FUTURE


@pytest.mark.parametrize("delta", [-300_000, 0, 300_000])
def test_replay_window_edges_accepted(delta):
    guard, h = make_guard()
    assert guard.check("d", str(h["now"] + delta), str(uuid.uuid4())) is ReplayVerdict.OK


@pytest.mark.parametrize(
    "ts,nonce",
    [(None, "x"), ("1", None), ("abc", str(uuid.uuid4())), ("1", "nope"), ("1" * 30, str(uuid.uuid4()))],
)
def test_replay_bad_headers(ts, nonce):
    guard, _ = make_guard()
    assert guard.check("d", ts, nonce) is ReplayVerdict.BAD_HEADERS


def test_replay_store_full_fails_closed():
    guard, h = make_guard(max_entries=2)
    assert guard.check("d", str(h["now"]), str(uuid.uuid4())) is ReplayVerdict.OK
    assert guard.check("d", str(h["now"]), str(uuid.uuid4())) is ReplayVerdict.OK
    assert guard.check("d", str(h["now"]), str(uuid.uuid4())) is ReplayVerdict.STORE_FULL


def test_rate_limiter_minute_and_day():
    clock = Clock()
    lim = SlidingWindowLimiter([(3, 60.0), (5, 86_400.0)], clock=clock)
    assert [lim.hit("k") for _ in range(3)] == [None, None, None]
    retry = lim.hit("k")
    assert retry == 60
    clock.t += 30
    assert lim.hit("k") == 30
    clock.t += 31
    assert lim.hit("k") is None
    assert lim.hit("k") is None
    assert lim.hit("k") > 60  # 5/day reached
    assert lim.hit("other") is None


def test_rate_limiter_rejected_hits_do_not_count():
    clock = Clock()
    lim = SlidingWindowLimiter([(1, 10.0)], clock=clock)
    assert lim.hit("k") is None
    for _ in range(5):
        assert lim.hit("k") is not None
    clock.t += 10.5
    assert lim.hit("k") is None


def test_rate_limiter_bounded_keys():
    lim = SlidingWindowLimiter([(1, 60.0)], max_keys=3, clock=Clock())
    for i in range(10):
        lim.hit(i)
    assert len(lim._hits) == 3


def test_client_ip_ignores_forwarded_header_by_default():
    from starlette.requests import Request

    from bridge_service.security.auth import client_ip

    scope = {
        "type": "http",
        "headers": [(b"x-forwarded-for", b"6.6.6.6, 7.7.7.7")],
        "client": ("10.0.0.5", 1234),
    }
    req = Request(scope)
    assert client_ip(req, trust_proxy_headers=False) == "10.0.0.5"
    assert client_ip(req, trust_proxy_headers=True) == "7.7.7.7"
