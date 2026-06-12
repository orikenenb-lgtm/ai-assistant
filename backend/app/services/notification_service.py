"""
שירות ההתראות — Email (Resend) + Telegram.

עקרונות:
- כל ערוץ עצמאי לחלוטין: כשל באימייל לא מונע טלגרם ולהפך (N2).
- כשל בהתראה לעולם לא מפיל את הפעולה העסקית — רק נרשם בלוג.
- ההתראות רצות כ-BackgroundTask — הלקוח לא מחכה להן.
"""
import logging
from dataclasses import dataclass

import requests

from app.config import get_settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
TELEGRAM_API_URL = "https://api.telegram.org"
SEND_TIMEOUT_SECONDS = 15


@dataclass
class NotifyResult:
    """תוצאת שליחה — לכל ערוץ בנפרד."""
    email_sent: bool = False
    telegram_sent: bool = False


def send_email(to: str, subject: str, html: str) -> bool:
    """שליחת אימייל דרך Resend. מחזיר הצלחה/כשל, לא זורק לעולם."""
    settings = get_settings()
    if not settings.resend_api_key or not to:
        logger.info("אימייל לא נשלח — RESEND_API_KEY או נמען חסרים")
        return False
    try:
        response = requests.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "html": html,
            },
            timeout=SEND_TIMEOUT_SECONDS,
        )
        if response.status_code in (200, 201):
            return True
        logger.warning("Resend החזיר %s: %s", response.status_code, response.text[:200])
        return False
    except requests.RequestException as exc:
        logger.warning("שליחת אימייל נכשלה: %s", exc)
        return False


def send_telegram(text: str) -> bool:
    """שליחת הודעת טלגרם לאבא. מחזיר הצלחה/כשל, לא זורק לעולם."""
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.info("טלגרם לא נשלח — TELEGRAM_BOT_TOKEN/CHAT_ID חסרים")
        return False
    try:
        response = requests.post(
            f"{TELEGRAM_API_URL}/bot{settings.telegram_bot_token}/sendMessage",
            json={"chat_id": settings.telegram_chat_id, "text": text},
            timeout=SEND_TIMEOUT_SECONDS,
        )
        if response.status_code == 200:
            return True
        logger.warning("Telegram החזיר %s: %s", response.status_code, response.text[:200])
        return False
    except requests.RequestException as exc:
        logger.warning("שליחת טלגרם נכשלה: %s", exc)
        return False


def build_new_order_message(customer_name: str, order_number: int,
                            total_estimate: float, items_count: int) -> tuple[str, str, str]:
    """בונה את תוכן ההתראה (N3): נושא, HTML לאימייל, וטקסט לטלגרם."""
    subject = f"🧸 הזמנה חדשה #{order_number} מ{customer_name}"
    total_text = f"{total_estimate:,.2f} ₪"
    html = f"""
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px;">
      <h2>🧸 הזמנה חדשה ב-Kerem Orders</h2>
      <p><b>לקוח:</b> {customer_name}</p>
      <p><b>מספר הזמנה:</b> #{order_number}</p>
      <p><b>פריטים:</b> {items_count}</p>
      <p><b>סכום משוער:</b> {total_text}</p>
      <p>היכנס לדשבורד כדי לסקור ולהפיק הצעת מחיר.</p>
    </div>
    """
    telegram_text = (
        f"🧸 הזמנה חדשה #{order_number}\n"
        f"לקוח: {customer_name}\n"
        f"פריטים: {items_count}\n"
        f"סכום משוער: {total_text}"
    )
    return subject, html, telegram_text


def notify_new_order(customer_name: str, order_number: int,
                     total_estimate: float, items_count: int) -> NotifyResult:
    """
    התראה לאבא על הזמנה חדשה (N1) — שני הערוצים, כל אחד עצמאי (N2).
    """
    settings = get_settings()
    subject, html, telegram_text = build_new_order_message(
        customer_name, order_number, total_estimate, items_count)

    result = NotifyResult()
    result.email_sent = send_email(settings.admin_notification_email, subject, html)
    result.telegram_sent = send_telegram(telegram_text)

    if not result.email_sent and not result.telegram_sent:
        logger.error("שום התראה לא נשלחה על הזמנה #%s!", order_number)
    return result
