"""
בדיקת חיבור read-only ל-Rivhit (Item.List + Customer.List) — לא כותב כלום.
מריצים אחרי שהרשת פתוחה לדומיין Rivhit: .venv/bin/python scripts/rivhit_probe.py
הפלט לא מדפיס את הטוקן לעולם.
"""
import json
import sys

sys.path.insert(0, ".")

from app.config import get_settings  # noqa: E402
from app.services.rivhit_service import RivhitClient, RivhitError  # noqa: E402


def main() -> None:
    settings = get_settings()
    print(f"בודק מול: {settings.rivhit_api_base_url}")
    client = RivhitClient()

    for name, fetch in [("מוצרים", client.get_products), ("לקוחות", client.get_customers)]:
        try:
            rows = fetch()
            print(f"✅ {name}: {len(rows)} רשומות")
            if rows:
                # לא מדפיסים פרטים אישיים של לקוחות (אימייל/טלפון) ללוג
                sample = dict(rows[0])
                sample.pop("email", None)
                sample.pop("phone", None)
                print("   דוגמה:", json.dumps(sample, ensure_ascii=False)[:400])
        except RivhitError as exc:
            print(f"❌ {name}: {exc}")


if __name__ == "__main__":
    main()
