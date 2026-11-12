"""DEMO foreign-exchange reference table.

* Clearly labeled ``mode="DEMO"`` with a fixed ``as_of`` timestamp and source.
* Used ONLY for (a) labeled display conversions (``ConvertedAmount``) and
  (b) letting DEMO adapters quote synthetic prices in the requested currency.
* NEVER used silently in ranking: ``score_offers`` compares cost only within
  the same currency and marks mixed-currency sets ``comparable=False``.

A future LIVE FX source would implement the same ``fx_rates()`` / ``convert()``
shape with ``mode="LIVE"``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import ROUND_HALF_EVEN, Decimal

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


def fx_rates() -> FxRatesOut:
    return FxRatesOut(
        mode=FX_MODE,
        source=FX_SOURCE,
        as_of=FX_AS_OF,
        base=FX_BASE,
        rates=dict(sorted(DEMO_USD_RATES.items())),
        note=FX_NOTE,
    )


def rate(from_currency: str, to_currency: str) -> Decimal:
    try:
        src = DEMO_USD_RATES[from_currency]
        dst = DEMO_USD_RATES[to_currency]
    except KeyError as exc:
        raise FxUnavailableError(f"אין שער הדגמה עבור {exc.args[0]}") from exc
    if from_currency == to_currency:
        return Decimal(1)
    return (dst / src).quantize(RATE_PRECISION, rounding=ROUND_HALF_EVEN)


def convert(amount: Money, to_currency: str) -> ConvertedAmount:
    """Labeled DEMO conversion for display. Never replaces the original price."""
    r = rate(amount.currency, to_currency)
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
