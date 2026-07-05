#!/usr/bin/env python3
"""
בדיקת לקוחות עם הנחה קבועה ברווחית — קריאה בלבד (READ-ONLY).

מטרה: לענות על השאלה "האם יש לקוחות עם הנחה קבועה ברווחית?" בלי לגעת בשום דבר.
הסקריפט מבצע *אך ורק* Customer.List (פקודת קריאה) — שום פקודת כתיבה, לעולם.

הרצה:
    RIVHIT_API_TOKEN=... python3 check_rivhit_discounts.py
    # או:
    python3 check_rivhit_discounts.py --token <TOKEN>

הערה על סביבה: הסקריפט חייב לרוץ במקום שבו יש גישת רשת ל-api.rivhit.co.il
(מחשב מקומי / השרת ב-Railway). בסביבת ה-agent הזו הגישה ל-Rivhit חסומה,
לכן הוא נמסר כ"כלי מוכן להרצה".

הטוקן לעולם לא מודפס.
"""
from __future__ import annotations

import argparse
import os
import sys

import requests

# ---- שער ברזל: אך ורק פקודת קריאה. אסור לשנות ל-New/Update/Delete. ----
READ_ONLY_METHOD = "Customer.List"
_ALLOWED = {"Customer.List", "Customer.Get"}  # קריאה בלבד


def _assert_read_only(method: str) -> None:
    if method not in _ALLOWED:
        raise SystemExit(f"חסום: '{method}' אינה פקודת קריאה. שום דבר לא נשלח לרווחית.")


def fetch_customers(token: str, base_url: str, timeout: int = 30) -> list[dict]:
    _assert_read_only(READ_ONLY_METHOD)  # תמיד — לפני הרשת
    url = f"{base_url.rstrip('/')}/{READ_ONLY_METHOD}"
    resp = requests.post(url, json={"api_token": token}, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("error_code", 0) != 0:
        msg = payload.get("client_message") or payload.get("debug_message") or payload.get("error_code")
        raise SystemExit(f"רווחית החזירה שגיאה: {msg}")
    data = payload.get("data", {})
    if isinstance(data, dict):
        return data.get("customer_list") or data.get("customers") or []
    return data if isinstance(data, list) else []


def _to_number(v) -> float:
    """המרה בטוחה למספר; ערכים לא-מספריים -> 0."""
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return 0.0


def find_discount_fields(sample: dict) -> list[str]:
    """גילוי אוטומטי של שדות שקשורים להנחה — לא מניחים שם שדה קבוע."""
    return [k for k in sample.keys() if "discount" in k.lower()]


def customer_name(c: dict) -> str:
    for key in ("customer_name", "name"):
        if c.get(key):
            return str(c[key])
    first = c.get("first_name") or ""
    last = c.get("last_name") or ""
    full = f"{first} {last}".strip()
    return full or str(c.get("customer_id") or c.get("id") or "—")


def main() -> int:
    ap = argparse.ArgumentParser(description="בדיקת לקוחות עם הנחה קבועה ברווחית (קריאה בלבד)")
    ap.add_argument("--token", default=os.environ.get("RIVHIT_API_TOKEN"), help="טוקן רווחית (או ENV: RIVHIT_API_TOKEN)")
    ap.add_argument("--base-url", default=os.environ.get("RIVHIT_API_BASE_URL", "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc"))
    args = ap.parse_args()

    if not args.token:
        print("חסר טוקן. הגדר RIVHIT_API_TOKEN או העבר --token.", file=sys.stderr)
        return 2

    customers = fetch_customers(args.token, args.base_url)
    print(f"סה\"כ לקוחות ברווחית: {len(customers)}")
    if not customers:
        print("לא הוחזרו לקוחות.")
        return 0

    # גילוי שדות ההנחה מהרשומה הראשונה, בתוספת שדות נפוצים ידועים.
    discount_keys = find_discount_fields(customers[0]) or []
    for known in ("discount_percent", "discount", "customer_discount"):
        if known not in discount_keys:
            discount_keys.append(known)
    print(f"שדות הנחה שנבדקים: {', '.join(discount_keys)}")

    discounted: list[tuple[str, str, float, str]] = []
    price_lists: dict[str, int] = {}
    for c in customers:
        best = 0.0
        for k in discount_keys:
            best = max(best, _to_number(c.get(k)))
        pl = str(c.get("price_list_id") or c.get("price_list") or "").strip()
        if pl and pl not in ("0", ""):
            price_lists[pl] = price_lists.get(pl, 0) + 1
        if best > 0:
            cid = str(c.get("customer_id") or c.get("id") or "—")
            discounted.append((cid, customer_name(c), best, pl or "-"))

    print(f"\nלקוחות עם הנחה קבועה (>0): {len(discounted)}")
    if discounted:
        print(f"{'קוד':<10}{'הנחה%':<8}{'מחירון':<10}שם")
        for cid, name, disc, pl in sorted(discounted, key=lambda x: -x[2]):
            print(f"{cid:<10}{disc:<8g}{pl:<10}{name}")

    if price_lists:
        print("\nמחירונים אישיים בשימוש (price_list_id -> מס' לקוחות):")
        for pl, n in sorted(price_lists.items(), key=lambda x: -x[1]):
            print(f"  מחירון {pl}: {n} לקוחות")
        print("הערה: לקוח המשויך למחירון אישי מקבל תמחור מיוחד גם ללא אחוז-הנחה.")

    if not discounted and not price_lists:
        print("\nלא נמצאו לקוחות עם הנחה קבועה או מחירון אישי.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
