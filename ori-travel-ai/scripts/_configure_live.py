"""Enable the verified provider integrations in apps/api/.env — safely, without ever printing a secret.

Usage (from scripts/enable-live-providers.ps1 or by hand):
    python scripts/_configure_live.py <path-to-.env> <backup-dir>

* Requires ORI_DUFFEL_ACCESS_TOKEN to be present AND a Duffel TEST token (duffel_test_…); a live token stops the script.
* Refuses to continue when the file would also enable a real booking flag or paid AI.
* Backs the file up first (inside the git-ignored data folder), then sets exactly two flags:
  ORI_LIVE_PROVIDERS_ENABLED=true and ORI_FX_LIVE_ENABLED=true. Every other line is kept byte-for-byte.
* Prints only key NAMES and states, never values. Exit code 0 = configured, 1 = stopped (nothing changed).
"""

from __future__ import annotations

import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

FLAGS = {"ORI_LIVE_PROVIDERS_ENABLED": "true", "ORI_FX_LIVE_ENABLED": "true"}
DANGEROUS_TRUE = {
    "ORI_BOOKING_LIVE_EXECUTION": "ביצוע הזמנות חי",
    "ORI_AI_ALLOW_PAID": "AI בתשלום",
    "ORI_AI_ANTHROPIC_SERVER_FALLBACK": "AI בתשלום (fallback בשרת)",
}
OTHER_LIVE_KEYS = ("ORI_VIATOR_API_KEY", "ORI_BOOKING_DEMAND_API_KEY", "ORI_AMADEUS_CLIENT_ID")


def parse(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main(env_path: str, backup_dir: str) -> int:
    path = Path(env_path)
    if not path.is_file():
        print(f"✗ לא נמצא קובץ {path} — הריצו קודם scripts\\setup.ps1")
        return 1
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")  # tolerate a BOM written by an editor
    values = parse(text)

    token = values.get("ORI_DUFFEL_ACCESS_TOKEN", "")
    if not token:
        print("✗ ORI_DUFFEL_ACCESS_TOKEN חסר או ריק ב-.env — לא שונה דבר")
        return 1
    if token.startswith("duffel_live_"):
        print("✗ הטוקן הוא טוקן חי (duffel_live_…) — הסקריפט מפעיל רק טוקן בדיקה. לא שונה דבר")
        return 1
    if not token.startswith("duffel_test_"):
        print("✗ ORI_DUFFEL_ACCESS_TOKEN אינו בפורמט של טוקן בדיקה של Duffel (duffel_test_…) — לא שונה דבר")
        return 1
    print("✓ ORI_DUFFEL_ACCESS_TOKEN: קיים, טוקן בדיקה (הערך לא מוצג)")

    bad = [label for key, label in DANGEROUS_TRUE.items() if values.get(key, "").lower() in ("1", "true", "yes", "on")]
    if bad:
        print(f"✗ ב-.env מופעלות הגדרות מסוכנות: {', '.join(bad)} — כבו אותן ידנית. לא שונה דבר")
        return 1
    others = [k for k in OTHER_LIVE_KEYS if values.get(k)]
    if others:
        print(f"✗ קיימים גם מפתחות לספקים חיים אחרים ({', '.join(others)}) — הם היו מופעלים יחד. "
              "הסירו אותם או הפעילו ידנית. לא שונה דבר")
        return 1

    Path(backup_dir).mkdir(parents=True, exist_ok=True)
    backup = Path(backup_dir) / f"env-{datetime.now():%Y%m%d-%H%M%S}.bak"
    shutil.copy2(path, backup)
    try:
        os.chmod(backup, 0o600)
    except OSError:
        pass
    print(f"✓ גיבוי של .env נשמר: {backup.name} (בתיקיית data\\backups, לא בגיט)")

    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines()
    done: set[str] = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
        if key in FLAGS:
            lines[i] = f"{key}={FLAGS[key]}"
            done.add(key)
    missing = [k for k in FLAGS if k not in done]
    if missing:
        lines.append("")
        lines.append("# Enabled by scripts/enable-live-providers.ps1 (Duffel sandbox + ECB rates; no bookings)")
        lines.extend(f"{k}={FLAGS[k]}" for k in missing)
    new = newline.join(lines) + newline
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(new.encode("utf-8"))  # UTF-8 without BOM, as the app expects
    os.replace(tmp, path)

    check = parse(path.read_text(encoding="utf-8"))
    if any(check.get(k) != v for k, v in FLAGS.items()) or check.get("ORI_DUFFEL_ACCESS_TOKEN") != token:
        shutil.copy2(backup, path)
        print("✗ האימות אחרי הכתיבה נכשל — הקובץ שוחזר מהגיבוי")
        return 1
    for k, v in FLAGS.items():
        print(f"✓ {k}={v}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1], sys.argv[2]))
