"""scripts/_configure_live.py — enables only the verified flags, never prints secrets, refuses unsafe files."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "_configure_live.py"
spec = importlib.util.spec_from_file_location("configure_live", SCRIPT)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

TEST_TOKEN = "duffel_test_SECRETVALUE123456"


def write(tmp_path: Path, body: str, *, bom: bool = False, crlf: bool = False) -> Path:
    p = tmp_path / ".env"
    text = body.replace("\n", "\r\n") if crlf else body
    p.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
    return p


def run(tmp_path: Path, env: Path, capsys) -> tuple[int, str]:
    code = mod.main(str(env), str(tmp_path / "backups"))
    return code, capsys.readouterr().out


def test_happy_path_sets_flags_keeps_everything_else_and_never_prints_the_token(tmp_path, capsys):
    env = write(tmp_path, f"ORI_ENV=development\nORI_DATA_KEY=abc=\nORI_DUFFEL_ACCESS_TOKEN={TEST_TOKEN}\n"
                          "ORI_LIVE_PROVIDERS_ENABLED=false\n", crlf=True, bom=True)
    code, out = run(tmp_path, env, capsys)
    assert code == 0
    assert "SECRETVALUE" not in out
    raw = env.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf")  # written back without BOM
    text = raw.decode("utf-8")
    assert "\r\n" in text  # line endings preserved
    values = mod.parse(text)
    assert values["ORI_LIVE_PROVIDERS_ENABLED"] == "true" and values["ORI_FX_LIVE_ENABLED"] == "true"
    assert values["ORI_DUFFEL_ACCESS_TOKEN"] == TEST_TOKEN and values["ORI_DATA_KEY"] == "abc="
    assert text.count("ORI_LIVE_PROVIDERS_ENABLED") == 1
    backups = list((tmp_path / "backups").glob("env-*.bak"))
    assert len(backups) == 1 and b"ORI_LIVE_PROVIDERS_ENABLED=false" in backups[0].read_bytes()
    # Idempotent
    code, _ = run(tmp_path, env, capsys)
    assert code == 0 and env.read_text(encoding="utf-8").count("ORI_FX_LIVE_ENABLED") == 1


@pytest.mark.parametrize(
    ("body", "needle"),
    [
        ("ORI_ENV=development\n", "חסר"),
        ("ORI_DUFFEL_ACCESS_TOKEN=duffel_live_SECRETVALUE123456\n", "טוקן חי"),
        ("ORI_DUFFEL_ACCESS_TOKEN=something-else\n", "אינו בפורמט"),
        (f"ORI_DUFFEL_ACCESS_TOKEN={TEST_TOKEN}\nORI_BOOKING_LIVE_EXECUTION=true\n", "ביצוע הזמנות חי"),
        (f"ORI_DUFFEL_ACCESS_TOKEN={TEST_TOKEN}\nORI_AI_ALLOW_PAID=true\n", "AI בתשלום"),
        (f"ORI_DUFFEL_ACCESS_TOKEN={TEST_TOKEN}\nORI_VIATOR_API_KEY=k\n", "ORI_VIATOR_API_KEY"),
    ],
)
def test_unsafe_or_incomplete_files_are_left_untouched(tmp_path, capsys, body, needle):
    env = write(tmp_path, body)
    before = env.read_bytes()
    code, out = run(tmp_path, env, capsys)
    assert code == 1 and needle in out
    assert "SECRETVALUE" not in out
    assert env.read_bytes() == before
    assert not (tmp_path / "backups").exists()


def test_missing_file(tmp_path, capsys):
    code, out = run(tmp_path, tmp_path / "nope.env", capsys)
    assert code == 1 and "לא נמצא" in out
