import hashlib

from bridge_service.security.pairing import (
    PAIRING_ALPHABET,
    PAIRING_CODE_LENGTH,
    generate_pairing_code,
    hash_pairing_code,
    normalize_pairing_code,
)
from bridge_service.security.tokens import (
    generate_device_id,
    generate_device_token,
    sha256_hex,
    token_matches,
)


def test_device_token_is_32_bytes_urlsafe():
    token = generate_device_token()
    assert len(token) == 43
    assert set(token) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    assert len({generate_device_token() for _ in range(100)}) == 100


def test_sha256_and_constant_time_match():
    token = generate_device_token()
    stored = sha256_hex(token)
    assert stored == hashlib.sha256(token.encode()).hexdigest()
    assert token_matches(token, stored)
    assert not token_matches(token + "x", stored)


def test_device_id_format():
    did = generate_device_id()
    assert did.startswith("dev_") and len(did) == 20


def test_pairing_code_format():
    for _ in range(200):
        code = generate_pairing_code()
        assert len(code) == PAIRING_CODE_LENGTH
        assert set(code) <= set(PAIRING_ALPHABET)
    assert not set("0O1I") & set(PAIRING_ALPHABET)


def test_normalize_pairing_code():
    assert normalize_pairing_code(" abcd-2345 ") == "ABCD2345"
    assert normalize_pairing_code("ABCD 2345") == "ABCD2345"
    assert normalize_pairing_code("ABCD234") is None
    assert normalize_pairing_code("ABCD23450") is None
    assert normalize_pairing_code("OOOO1111") is None
    assert normalize_pairing_code("ABCD234!") is None


def test_pairing_hash_is_domain_separated():
    pepper = b"p" * 32
    assert hash_pairing_code("ABCD2345", pepper) != sha256_hex("ABCD2345")
    assert hash_pairing_code("ABCD2345", pepper) != sha256_hex("pairing:ABCD2345")


def test_settings_repr_hides_secrets(tmp_path):
    from bridge_service.config import Settings

    s = Settings(
        db_path=str(tmp_path / "x.db"), anthropic_api_key="sk-SECRET-1", noa_engine_api_key="SECRET-2"
    )
    assert "SECRET" not in repr(s) and "SECRET" not in str(s)
    assert s.anthropic_api_key == "sk-SECRET-1"  # still readable by the factory
    assert s.enabled is False and s.engine == "stub" and s.engine_timeout_seconds == 25
