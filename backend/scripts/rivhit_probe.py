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

    # allowlist בלבד — שום שדה שלא אושר מראש לא מודפס ללוג (אפס PII)
    safe_fields = {
        "מוצרים": {"rivhit_id", "sku", "name", "category", "base_price",
                    "stock_quantity", "unit"},
        "לקוחות": {"rivhit_id", "city", "price_list_id"},
    }
    for name, fetch in [("מוצרים", client.get_products), ("לקוחות", client.get_customers)]:
        try:
            rows = fetch()
            print(f"✅ {name}: {len(rows)} רשומות")
            if rows:
                sample = {k: v for k, v in rows[0].items() if k in safe_fields[name]}
                print("   דוגמה:", json.dumps(sample, ensure_ascii=False)[:400])
        except RivhitError as exc:
            print(f"❌ {name}: {exc}")


if __name__ == "__main__":
    main()
