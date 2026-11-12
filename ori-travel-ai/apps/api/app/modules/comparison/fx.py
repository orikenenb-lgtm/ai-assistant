"""DEMO foreign-exchange reference table.

* Clearly labeled ``mode="DEMO"`` with a fixed ``as_of`` timestamp and source.
* Used ONLY for (a) labeled display conversions (``ConvertedAmount``) and
  (b) letting DEMO adapters quote synthetic prices in the requested currency.
* NEVER used silently in ranking: ``score_offers`` compares cost only within
  the same currency and marks mixed-currency sets ``comparable=False``.

Optional LIVE source (display only): when ``ORI_FX_LIVE_ENABLED=true`` the ECB's official daily
reference-rate XML is fetched (6h cache, size-limited, DOCTYPE/entities rejected), cross rates are
computed via EUR and labeled ``mode="LIVE"``. On ANY failure — or for a currency the ECB does not
publish (e.g. AED, GEL) — the DEMO table is used and labeled as such, with a Hebrew warning. The
feed's URL is from prior knowledge (see docs/integrations/provider-api-notes.md §8), unverified.
"""

from __future__ import annotations

import logging
import threading
import time
import xml.etree.ElementTree as ET  # noqa: S405 - input is size-limited and DOCTYPE/ENTITY are rejected first
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

import httpx

from app.core.config import get_settings
from app.core.money import SUPPORTED_CURRENCIES, quantize
from app.schemas.common import ApiModel, DataMode, DecimalStr, Money
from app.schemas.offers import ConvertedAmount

FX_MODE: DataMode = "DEMO"
FX_BASE = "USD"
FX_SOURCE = "טבלת הדגמה סטטית"
FX_AS_OF = datetime(2026, 1, 1, tzinfo=UTC)
FX_NOTE = "שערי הדגמה קבועים לצורכי תצוגה בלבד — אינם שערים אמיתיים ואינם משמשים לדירוג או לחישוב מחיר"

# Units of currency per 1 USD (rounded, illustrative DEMO values — NOT market data).
DEMO_USD_RATES: dict[str, Decimal] = {
    "USD": Decimal("1"),
    "ILS": Decimal("3.65"),
    "EUR": Decimal("0.92"),
    "GBP": Decimal("0.79"),
    "CHF": Decimal("0.88"),
    "CAD": Decimal("1.37"),
    "AUD": Decimal("1.52"),
    "CZK": Decimal("23.2"),
    "HUF": Decimal("360"),
    "PLN": Decimal("3.95"),
    "RON": Decimal("4.6"),
    "SEK": Decimal("10.5"),
    "NOK": Decimal("10.7"),
    "DKK": Decimal("6.85"),
    "TRY": Decimal("34"),
    "AED": Decimal("3.6725"),
    "THB": Decimal("35.5"),
    "GEL": Decimal("2.7"),
    "CNY": Decimal("7.2"),
    "INR": Decimal("84"),
    "JPY": Decimal("150"),
    "KRW": Decimal("1380"),
}

assert set(DEMO_USD_RATES) == set(SUPPORTED_CURRENCIES), "DEMO FX table must cover every supported currency"

RATE_PRECISION = Decimal("0.00000001")


class FxUnavailableError(ValueError):
    pass


class FxRatesOut(ApiModel):
    mode: DataMode
    source: str
    as_of: datetime
    base: str
    rates: dict[str, DecimalStr]
    note: str
    # Hebrew warning, e.g. when live rates were requested but unavailable (DEMO table shown instead)
    warning: str | None = None


# ------------------------------------------------------------ ECB (LIVE) ----

ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
ECB_SOURCE = "European Central Bank reference rates"
ECB_NOTE = "שערי ייחוס יומיים של הבנק המרכזי האירופי — לתצוגה בלבד; אינם שערי עסקה ואינם משמשים לדירוג או לחישוב מחיר"
ECB_FALLBACK_WARNING = "שערי ה-ECB החיים אינם זמינים כרגע — מוצגים שערי הדגמה קבועים (לא שערי שוק)"
ECB_TTL_SECONDS = 6 * 3600
ECB_FAILURE_TTL_SECONDS = 300  # do not hammer a failing feed (each attempt can wait for the timeout)
ECB_MAX_BYTES = 64 * 1024
ECB_MAX_CURRENCIES = 100

log = logging.getLogger("ori.fx")


class FxParseError(ValueError):
    pass


@dataclass(frozen=True)
class EcbRates:
    as_of: datetime
    rates: dict[str, Decimal]  # units of currency per 1 EUR (includes EUR = 1)


def parse_ecb_xml(data: bytes) -> EcbRates:
    """Parse the ECB daily reference XML. Rejects oversized input, DOCTYPE and entity declarations."""
    if len(data) > ECB_MAX_BYTES:
        raise FxParseError("xml too large")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise FxParseError("xml must be utf-8") from None
    lowered = text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise FxParseError("DOCTYPE/ENTITY declarations are not allowed")
    try:
        root = ET.fromstring(data)  # noqa: S314  # nosec B314 - DOCTYPE/ENTITY rejected above, size-limited, trusted ECB host only
    except ET.ParseError:
        raise FxParseError("malformed xml") from None
    day: date | None = None
    rates: dict[str, Decimal] = {"EUR": Decimal(1)}
    for cube in root.iter():
        if not cube.tag.endswith("Cube"):
            continue
        t = cube.attrib.get("time")
        if t:
            try:
                day = date.fromisoformat(t)
            except ValueError:
                raise FxParseError("invalid date") from None
            continue
        cur, val = cube.attrib.get("currency"), cube.attrib.get("rate")
        if cur is None or val is None:
            continue
        if len(cur) != 3 or not cur.isascii() or not cur.isupper():
            raise FxParseError("invalid currency code")
        try:
            rate_value = Decimal(val)
        except InvalidOperation:
            raise FxParseError("invalid rate") from None
        if not rate_value.is_finite() or rate_value <= 0:
            raise FxParseError("invalid rate")
        rates[cur] = rate_value
        if len(rates) > ECB_MAX_CURRENCIES:
            raise FxParseError("too many currencies")
    if day is None or len(rates) < 2:
        raise FxParseError("no rates found")
    return EcbRates(as_of=datetime(day.year, day.month, day.day, tzinfo=UTC), rates=rates)


def fetch_ecb_rates(transport: httpx.BaseTransport | None = None) -> EcbRates:
    """Download + parse the ECB feed (https only, no redirects, size-limited)."""
    timeout = max(0.5, float(get_settings().fx_timeout_seconds))
    with (
        httpx.Client(timeout=timeout, transport=transport, follow_redirects=False,
                     headers={"User-Agent": "OriTravelAI/0.1 (display-only FX)"}) as client,
        client.stream("GET", ECB_URL) as resp,
    ):
        if resp.status_code != 200:
            raise FxParseError(f"unexpected status {resp.status_code}")
        buf = bytearray()
        for chunk in resp.iter_bytes():
            buf.extend(chunk)
            if len(buf) > ECB_MAX_BYTES:
                raise FxParseError("xml too large")
    return parse_ecb_xml(bytes(buf))


_lock = threading.Lock()
_cache: dict[str, object] = {"rates": None, "fetched": 0.0, "failed": 0.0}
_transport: httpx.BaseTransport | None = None


def set_fx_transport(transport: httpx.BaseTransport | None) -> None:
    """Test hook: route ECB requests through a mock transport."""
    global _transport
    _transport = transport


def reset_fx_cache() -> None:
    with _lock:
        _cache.update(rates=None, fetched=0.0, failed=0.0)


def _live_rates() -> tuple[EcbRates | None, str | None]:
    """(rates, warning). ``(None, None)`` when live FX is disabled."""
    if not get_settings().fx_live_enabled:
        return None, None
    now = time.monotonic()
    with _lock:
        cached = _cache["rates"]
        if cached is not None and now - float(_cache["fetched"]) < ECB_TTL_SECONDS:  # type: ignore[arg-type]
            return cached, None  # type: ignore[return-value]
        if _cache["failed"] and now - float(_cache["failed"]) < ECB_FAILURE_TTL_SECONDS:  # type: ignore[arg-type]
            return None, ECB_FALLBACK_WARNING
        try:
            fresh = fetch_ecb_rates(_transport)
        except (httpx.HTTPError, FxParseError, OSError) as exc:
            log.warning("ECB FX fetch failed (%s); using DEMO table", type(exc).__name__)
            _cache.update(rates=None, failed=now)
            return None, ECB_FALLBACK_WARNING
        _cache.update(rates=fresh, fetched=now, failed=0.0)
        return fresh, None


def fx_rates() -> FxRatesOut:
    live, warning = _live_rates()
    if live is not None:
        supported = {c: r for c, r in live.rates.items() if c in SUPPORTED_CURRENCIES}
        return FxRatesOut(
            mode="LIVE",
            source=ECB_SOURCE,
            as_of=live.as_of,
            base="EUR",
            rates=dict(sorted(supported.items())),
            note=ECB_NOTE,
        )
    return FxRatesOut(
        mode=FX_MODE,
        source=FX_SOURCE,
        as_of=FX_AS_OF,
        base=FX_BASE,
        rates=dict(sorted(DEMO_USD_RATES.items())),
        note=FX_NOTE,
        warning=warning,
    )


def _live_rate(from_currency: str, to_currency: str) -> tuple[Decimal, EcbRates] | None:
    live, _ = _live_rates()
    if live is None or from_currency not in live.rates or to_currency not in live.rates:
        return None
    if from_currency == to_currency:
        return Decimal(1), live
    return (live.rates[to_currency] / live.rates[from_currency]).quantize(RATE_PRECISION, rounding=ROUND_HALF_EVEN), live


def rate(from_currency: str, to_currency: str) -> Decimal:
    live = _live_rate(from_currency, to_currency)
    if live is not None:
        return live[0]
    return _demo_rate(from_currency, to_currency)


def _demo_rate(from_currency: str, to_currency: str) -> Decimal:
    try:
        src = DEMO_USD_RATES[from_currency]
        dst = DEMO_USD_RATES[to_currency]
    except KeyError as exc:
        raise FxUnavailableError(f"אין שער הדגמה עבור {exc.args[0]}") from exc
    if from_currency == to_currency:
        return Decimal(1)
    return (dst / src).quantize(RATE_PRECISION, rounding=ROUND_HALF_EVEN)


def convert(amount: Money, to_currency: str) -> ConvertedAmount:
    """Labeled conversion for display (LIVE ECB when enabled+available, else DEMO). Never replaces the price."""
    live = _live_rate(amount.currency, to_currency)
    if live is not None:
        r, data = live
        return ConvertedAmount(
            original=amount,
            converted=Money(amount=quantize(amount.amount * r, to_currency), currency=to_currency),
            rate=r,
            rate_source=ECB_SOURCE,
            rate_mode="LIVE",
            rate_timestamp=data.as_of,
        )
    r = _demo_rate(amount.currency, to_currency)
    converted = quantize(amount.amount * r, to_currency)
    return ConvertedAmount(
        original=amount,
        converted=Money(amount=converted, currency=to_currency),
        rate=r,
        rate_source=FX_SOURCE,
        rate_mode=FX_MODE,
        rate_timestamp=FX_AS_OF,
    )


def demo_usd_to(amount_usd: Decimal, currency: str) -> Decimal:
    """DEMO adapters only: express a synthetic USD price in the requested currency."""
    return quantize(Decimal(amount_usd) * DEMO_USD_RATES[currency], currency)
