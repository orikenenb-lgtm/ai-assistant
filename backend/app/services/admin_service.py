"""לוגיקה טהורה של פעולות אדמין — ניתנת לבדיקה בלי DB."""
from datetime import datetime, timezone

from app.schemas.admin import OrderUpdateRequest

# סטטוס → עמודת חותמת הזמן שמתמלאת אוטומטית במעבר אליו
STATUS_TIMESTAMPS = {
    "quoted": "quoted_at",
    "confirmed": "confirmed_at",
    "shipped": "shipped_at",
    "closed": "closed_at",
}

# מעברי סטטוס חוקיים — מונע דילוגים לא הגיוניים (למשל closed → pending).
# מ-quoted אין חזרה אחורה: מסמך כבר קיים ב-Rivhit, ולכן רק אישור או ביטול.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"reviewed", "quoted", "cancelled"},
    "reviewed": {"quoted", "cancelled", "pending"},
    "quoted": {"confirmed", "cancelled"},
    "confirmed": {"shipped", "cancelled"},
    "shipped": {"closed"},
    "closed": set(),
    "cancelled": set(),
}


class StatusTransitionError(Exception):
    """מעבר סטטוס לא חוקי."""


def build_order_update(
    current_status: str,
    update: OrderUpdateRequest,
    now: datetime | None = None,
) -> dict:
    """
    בונה את שדות העדכון להזמנה: סטטוס (עם ולידציית מעבר), חותמות זמן, הערות.
    """
    now = now or datetime.now(timezone.utc)
    fields: dict = {}

    if update.status is not None and update.status != current_status:
        allowed = ALLOWED_TRANSITIONS.get(current_status, set())
        if update.status not in allowed:
            raise StatusTransitionError(
                f"אי אפשר לעבור מ-'{current_status}' ל-'{update.status}'")
        fields["status"] = update.status
        timestamp_column = STATUS_TIMESTAMPS.get(update.status)
        if timestamp_column:
            fields[timestamp_column] = now.isoformat()

    if update.admin_notes is not None:
        fields["admin_notes"] = update.admin_notes

    if update.final_total is not None:
        fields["final_total"] = update.final_total

    return fields
