"""Money helpers. Amounts are Decimal in code, integer minor units in the DB.

Never use float for money.
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal

# ISO 4217 minor-unit exponents for currencies we expect to see.
CURRENCY_EXPONENTS: dict[str, int] = {
    "ILS": 2,
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "CHF": 2,
    "CAD": 2,
    "AUD": 2,
    "CZK": 2,
    "HUF": 2,
    "PLN": 2,
    "RON": 2,
    "SEK": 2,
    "NOK": 2,
    "DKK": 2,
    "TRY": 2,
    "AED": 2,
    "THB": 2,
    "GEL": 2,
    "CNY": 2,
    "INR": 2,
    "JPY": 0,
    "KRW": 0,
}

SUPPORTED_CURRENCIES = frozenset(CURRENCY_EXPONENTS)

CURRENCY_SYMBOLS = {"ILS": "₪", "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥"}


class UnsupportedCurrencyError(ValueError):
    pass


def exponent(currency: str) -> int:
    try:
        return CURRENCY_EXPONENTS[currency.upper()]
    except KeyError as exc:
        raise UnsupportedCurrencyError(currency) from exc


def to_minor(amount: Decimal | str | int, currency: str) -> int:
    d = Decimal(str(amount))
    q = Decimal(1).scaleb(-exponent(currency))
    return int((d.quantize(q, rounding=ROUND_HALF_EVEN) * (10 ** exponent(currency))).to_integral_value())


def from_minor(amount_minor: int, currency: str) -> Decimal:
    e = exponent(currency)
    return (Decimal(amount_minor) / (10**e)).quantize(Decimal(1).scaleb(-e))


def quantize(amount: Decimal, currency: str) -> Decimal:
    return amount.quantize(Decimal(1).scaleb(-exponent(currency)), rounding=ROUND_HALF_EVEN)
