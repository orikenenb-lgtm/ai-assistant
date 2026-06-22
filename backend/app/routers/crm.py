"""
שכבת CRM — router מבודד תחת /crm. אדמין בלבד (require_admin בכל endpoint).
גישה ל-DB ב-service role (אחרי שה-API כבר אימת אדמין; ה-RLS על crm_* הוא הגנת עומק).
חישובי האנליטיקס/תובנות נעשים בשרת, לא בלקוח.
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.dependencies import require_admin

router = APIRouter(prefix="/crm", tags=["crm"])

# טבלאות מותרות + העמודות שמותר לכתוב אליהן (whitelist — מונע הזרקת שדות זרים)
ENTITIES: dict[str, set[str]] = {
    "categories": {"name", "color", "icon"},
    "customers": {"name", "phone", "email", "notes", "source"},
    "contacts": {"customer_id", "name", "role", "phone"},
    "templates": {"name", "category_id", "fields", "body"},
    "reps": {"name", "phone", "active"},
    "deals": {"customer_id", "category_id", "title", "status", "amount", "channel", "reason", "order_ref"},
    "sales": {"deal_id", "amount", "cost", "profit", "sold_at", "payment_method", "channel"},
    "leads": {"customer_id", "source", "status", "rep_id", "lost_reason", "closed_at"},
    "invoices": {"deal_id", "customer_id", "amount", "paid_amount", "due_date", "paid_at", "status"},
}


def _client():
    """service client — נטען עצלן כדי שייבוא ה-router לא ידרוש קונפיג (בדיקות)."""
    from app.services.supabase_client import get_service_client
    return get_service_client()


def _table(entity: str) -> str:
    if entity not in ENTITIES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ישות לא קיימת")
    return f"crm_{entity}"


def _clean(entity: str, body: dict) -> dict:
    """משאיר רק עמודות מותרות לכתיבה."""
    allowed = ENTITIES[entity]
    return {k: v for k, v in body.items() if k in allowed}


# ---------------- CRUD גנרי ----------------
@router.get("/{entity}")
def list_entity(entity: str, _: Any = Depends(require_admin)) -> list[dict]:
    table = _table(entity)
    res = _client().table(table).select("*").order("created_at", desc=True).execute()
    return res.data or []


@router.post("/{entity}", status_code=status.HTTP_201_CREATED)
def create_entity(entity: str, body: dict = Body(...), _: Any = Depends(require_admin)) -> dict:
    table = _table(entity)
    payload = _clean(entity, body)
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="אין שדות תקינים ליצירה")
    res = _client().table(table).insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="היצירה נכשלה")
    return res.data[0]


@router.patch("/{entity}/{row_id}")
def update_entity(entity: str, row_id: str, body: dict = Body(...), _: Any = Depends(require_admin)) -> dict:
    table = _table(entity)
    payload = _clean(entity, body)
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="אין שדות תקינים לעדכון")
    res = _client().table(table).update(payload).eq("id", row_id).execute()
    if not res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="הרשומה לא נמצאה")
    return res.data[0]


@router.delete("/{entity}/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(entity: str, row_id: str, _: Any = Depends(require_admin)) -> None:
    table = _table(entity)
    _client().table(table).delete().eq("id", row_id).execute()


# ---------------- עוזרים לאגרגציה ----------------
def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    # תאריך ללא אזור-זמן (כמו DATE "2020-01-01") — מצמידים UTC כדי שחיסור
    # מול now(tz-aware) לא יקרוס (offset-naive vs offset-aware).
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _month_key(value: Any) -> str:
    dt = _parse_dt(value)
    return dt.strftime("%Y-%m") if dt else "—"


def _in_range(value: Any, frm: str | None, to: str | None) -> bool:
    dt = _parse_dt(value)
    if dt is None:
        return False
    if frm and dt < (_parse_dt(frm) or dt):
        return False
    if to and dt > (_parse_dt(to) or dt):
        return False
    return True


def _name_map(entity: str) -> dict[str, str]:
    rows = _client().table(f"crm_{entity}").select("id,name").execute().data or []
    return {r["id"]: r.get("name") or "—" for r in rows}


# ---------------- Analytics ----------------
@router.get("/analytics/summary")
def analytics_summary(
    _: Any = Depends(require_admin),
    frm: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    category: str | None = Query(None),
    channel: str | None = Query(None),
    reason: str | None = Query(None),
) -> dict:
    """KPIs + breakdowns למכירות (group-by בשרת)."""
    sales = _client().table("crm_sales").select("*").execute().data or []
    deals = {d["id"]: d for d in (_client().table("crm_deals").select("*").execute().data or [])}
    cat_names = _name_map("categories")
    cust_names = _name_map("customers")

    def deal_of(s: dict) -> dict:
        return deals.get(s.get("deal_id"), {})

    def keep(s: dict) -> bool:
        d = deal_of(s)
        if not _in_range(s.get("sold_at"), frm, to):
            return False
        if category and d.get("category_id") != category:
            return False
        if channel and (s.get("channel") or d.get("channel")) != channel:
            return False
        if reason and d.get("reason") != reason:
            return False
        return True

    rows = [s for s in sales if keep(s)]
    num = lambda v: float(v or 0)

    total = sum(num(s.get("amount")) for s in rows)
    profit = sum(num(s.get("profit")) for s in rows)
    cost = sum(num(s.get("cost")) for s in rows)
    count = len(rows)

    # שינוי מול חודש קודם
    now = datetime.now(timezone.utc)
    cur_key = now.strftime("%Y-%m")
    prev = now.replace(day=1)
    prev_key = (prev.replace(year=prev.year - 1, month=12) if prev.month == 1
                else prev.replace(month=prev.month - 1)).strftime("%Y-%m")
    cur_total = sum(num(s.get("amount")) for s in rows if _month_key(s.get("sold_at")) == cur_key)
    prev_total = sum(num(s.get("amount")) for s in rows if _month_key(s.get("sold_at")) == prev_key)
    mom = ((cur_total - prev_total) / prev_total * 100) if prev_total else 0.0

    def group(key_fn) -> list[dict]:
        agg: dict[str, float] = defaultdict(float)
        for s in rows:
            agg[key_fn(s)] += num(s.get("amount"))
        return [{"label": k, "value": round(v, 2)} for k, v in sorted(agg.items(), key=lambda x: -x[1])]

    by_month_map: dict[str, float] = defaultdict(float)
    for s in rows:
        by_month_map[_month_key(s.get("sold_at"))] += num(s.get("amount"))
    by_month = [{"label": k, "value": round(v, 2)} for k, v in sorted(by_month_map.items())]

    profit_cost_map: dict[str, dict] = defaultdict(lambda: {"profit": 0.0, "cost": 0.0})
    for s in rows:
        mk = _month_key(s.get("sold_at"))
        profit_cost_map[mk]["profit"] += num(s.get("profit"))
        profit_cost_map[mk]["cost"] += num(s.get("cost"))

    return {
        "kpis": {
            "total_sales": round(total, 2),
            "deals": count,
            "profit": round(profit, 2),
            "cost": round(cost, 2),
            "avg_deal": round(total / count, 2) if count else 0,
            "mom_change": round(mom, 1),
        },
        "by_month": by_month,
        "by_category": group(lambda s: cat_names.get(deal_of(s).get("category_id"), "ללא קטגוריה")),
        "by_channel": group(lambda s: s.get("channel") or deal_of(s).get("channel") or "לא ידוע"),
        "by_reason": group(lambda s: deal_of(s).get("reason") or "לא צוין"),
        "top_customers": group(lambda s: cust_names.get(deal_of(s).get("customer_id"), "—"))[:7],
        "profit_vs_cost": [
            {"label": k, "profit": round(v["profit"], 2), "cost": round(v["cost"], 2)}
            for k, v in sorted(profit_cost_map.items())
        ],
    }


# ---------------- Insights: Leads ----------------
@router.get("/insights/leads")
def insights_leads(_: Any = Depends(require_admin), frm: str | None = Query(None, alias="from"),
                   to: str | None = Query(None)) -> dict:
    leads = _client().table("crm_leads").select("*").execute().data or []
    rows = [l for l in leads if _in_range(l.get("created_at"), frm, to)] if (frm or to) else leads
    total = len(rows)
    won = [l for l in rows if l.get("status") == "won"]
    lost = [l for l in rows if l.get("status") == "lost"]
    working = [l for l in rows if l.get("status") == "working"]
    new = [l for l in rows if l.get("status") == "new"]
    conv = round(len(won) / total * 100, 1) if total else 0.0

    by_source: dict[str, dict] = defaultdict(lambda: {"total": 0, "won": 0})
    for l in rows:
        src = l.get("source") or "לא ידוע"
        by_source[src]["total"] += 1
        if l.get("status") == "won":
            by_source[src]["won"] += 1
    sources = [{"label": k, "total": v["total"], "won": v["won"],
                "conv": round(v["won"] / v["total"] * 100, 1) if v["total"] else 0.0}
               for k, v in sorted(by_source.items(), key=lambda x: -x[1]["total"])]

    lost_reasons_map: dict[str, int] = defaultdict(int)
    for l in lost:
        lost_reasons_map[l.get("lost_reason") or "לא צוין"] += 1
    lost_reasons = [{"label": k, "value": v} for k, v in sorted(lost_reasons_map.items(), key=lambda x: -x[1])]

    days = [(_parse_dt(l["closed_at"]) - _parse_dt(l["created_at"])).days
            for l in won if _parse_dt(l.get("closed_at")) and _parse_dt(l.get("created_at"))]
    avg_close = round(sum(days) / len(days), 1) if days else 0.0

    best = max(sources, key=lambda s: s["conv"], default=None)
    insight = (f"המקור «{best['label']}» ממיר הכי טוב ({best['conv']}%) — שווה להשקיע שם."
               if best and best["total"] else "אין מספיק נתוני לידים לתובנה עדיין.")
    return {
        "kpis": {"total": total, "won": len(won), "lost": len(lost), "conversion": conv, "avg_close_days": avg_close},
        "funnel": [
            {"label": "חדש", "value": total},
            {"label": "בטיפול", "value": len(working) + len(won) + len(lost)},
            {"label": "נסגר", "value": len(won) + len(lost)},
            {"label": "זכייה", "value": len(won)},
        ],
        "sources": sources,
        "lost_reasons": lost_reasons,
        "new_count": len(new),
        "insight": insight,
    }


# ---------------- Insights: Reps ----------------
@router.get("/insights/reps")
def insights_reps(_: Any = Depends(require_admin)) -> dict:
    reps = _client().table("crm_reps").select("*").execute().data or []
    leads = _client().table("crm_leads").select("*").execute().data or []
    rep_names = {r["id"]: r.get("name") or "—" for r in reps}

    board: dict[str, dict] = defaultdict(lambda: {"leads": 0, "won": 0})
    for l in leads:
        rid = l.get("rep_id")
        if rid is None:
            continue
        board[rid]["leads"] += 1
        if l.get("status") == "won":
            board[rid]["won"] += 1
    leaderboard = [
        {"name": rep_names.get(rid, "—"), "leads": v["leads"], "won": v["won"],
         "conv": round(v["won"] / v["leads"] * 100, 1) if v["leads"] else 0.0}
        for rid, v in board.items()
    ]
    leaderboard.sort(key=lambda x: -x["won"])
    top = leaderboard[0] if leaderboard else None
    insight = (f"{top['name']} מוביל עם {top['won']} סגירות ({top['conv']}% המרה)."
               if top else "הוסף נציגים ולידים כדי לראות ביצועים.")
    return {"leaderboard": leaderboard, "insight": insight}


# ---------------- Insights: Collections ----------------
@router.get("/insights/collections")
def insights_collections(_: Any = Depends(require_admin)) -> dict:
    invoices = _client().table("crm_invoices").select("*").execute().data or []
    cust_names = _name_map("customers")
    num = lambda v: float(v or 0)
    now = datetime.now(timezone.utc)

    billed = sum(num(i.get("amount")) for i in invoices)
    collected = sum(num(i.get("paid_amount")) for i in invoices)
    outstanding = billed - collected
    rate = round(collected / billed * 100, 1) if billed else 0.0

    buckets = {"שוטף": 0.0, "30+": 0.0, "60+": 0.0, "90+": 0.0}
    overdue = []
    for i in invoices:
        open_amt = num(i.get("amount")) - num(i.get("paid_amount"))
        if open_amt <= 0:
            continue
        due = _parse_dt(i.get("due_date"))
        days = (now - due).days if due else 0
        bucket = "90+" if days >= 90 else "60+" if days >= 60 else "30+" if days >= 30 else "שוטף"
        buckets[bucket] += open_amt
        if days >= 1:
            overdue.append({"customer": cust_names.get(i.get("customer_id"), "—"),
                            "amount": round(open_amt, 2), "days": days})
    overdue.sort(key=lambda x: -x["amount"])

    paid = [i for i in invoices if _parse_dt(i.get("paid_at")) and _parse_dt(i.get("created_at"))]
    dso_days = [(_parse_dt(i["paid_at"]) - _parse_dt(i["created_at"])).days for i in paid]
    dso = round(sum(dso_days) / len(dso_days), 1) if dso_days else 0.0

    risk = buckets["60+"] + buckets["90+"]
    insight = (f"₪{round(risk):,} עברו 60+ יום — דורש טיפול דחוף." if risk > 0
               else "אין חובות מעל 60 יום — מצב הגבייה תקין. 👌")
    return {
        "kpis": {"billed": round(billed, 2), "collected": round(collected, 2),
                 "outstanding": round(outstanding, 2), "collection_rate": rate, "dso": dso},
        "aging": [{"label": k, "value": round(v, 2)} for k, v in buckets.items()],
        "overdue": overdue[:20],
        "insight": insight,
    }
