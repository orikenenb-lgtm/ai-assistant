"""Israeli phone number handling."""

import re


class InvalidPhoneNumber(ValueError):
    pass


def normalize_il_number(raw: str) -> str:
    """Return an Israeli number in E.164 form (+972...).

    Accepts the ways people actually write numbers: 053-2413215, 0532413215,
    +972 53 241 3215, 972532413215, (03) 555-1234.
    """
    digits = re.sub(r"[^\d+]", "", raw or "")
    if digits.startswith("+"):
        digits = digits[1:]
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("972"):
        national = digits[3:]
    elif digits.startswith("0"):
        national = digits[1:]
    else:
        raise InvalidPhoneNumber(f"Not an Israeli number: {raw!r}")
    national = national.lstrip("0")
    # Mobile numbers have 9 national digits (5X-XXX-XXXX), landlines 8 (X-XXX-XXXX),
    # VoIP 07X numbers have 9.
    if not national.isdigit() or len(national) not in (8, 9):
        raise InvalidPhoneNumber(f"Not an Israeli number: {raw!r}")
    return f"+972{national}"


def display_il_number(e164: str) -> str:
    """+972532413215 -> 053-2413215 (for reading back to a caller or showing in the UI)."""
    national = "0" + e164.removeprefix("+972")
    if len(national) == 10:
        return f"{national[:3]}-{national[3:]}"
    return f"{national[:2]}-{national[2:]}"
