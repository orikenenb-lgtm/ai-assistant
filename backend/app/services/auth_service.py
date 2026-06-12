"""
שירות אימות — כל התקשורת עם Supabase Auth עוברת כאן.
ה-routers לא מדברים עם Supabase ישירות — רק דרך השכבה הזו (קל למוקק בבדיקות).
"""
import logging

from app.schemas.auth import TokenResponse, UserOut
from app.services.supabase_client import get_anon_client, get_user_client

logger = logging.getLogger(__name__)


class AuthError(Exception):
    """שגיאת אימות — מתורגמת ל-401 בשכבת ה-router."""


def _build_token_response(session, profile: dict, email: str | None) -> TokenResponse:
    """מרכיב תשובת טוקן אחידה מ-session של Supabase + פרופיל מה-DB."""
    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
        user=UserOut(
            id=profile["id"],
            email=email,
            role=profile["role"],
            full_name=profile.get("full_name"),
            phone=profile.get("phone"),
            rivhit_customer_id=profile.get("rivhit_customer_id"),
            status=profile["status"],
        ),
    )


def fetch_profile(access_token: str, user_id: str) -> dict | None:
    """שולף את הפרופיל בזהות המשתמש עצמו — דרך RLS (שכבת הגנה 1)."""
    client = get_user_client(access_token)
    result = (
        client.from_("profiles")
        .select("*")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def signup(email: str, password: str, full_name: str, phone: str | None) -> TokenResponse:
    """הרשמה: יוצר משתמש ב-Supabase Auth; ה-trigger ב-DB יוצר profile אוטומטית."""
    client = get_anon_client()
    try:
        result = client.auth.sign_up({
            "email": email,
            "password": password,
            "options": {"data": {"full_name": full_name, "phone": phone}},
        })
    except Exception as exc:
        logger.warning("הרשמה נכשלה עבור %s: %s", email, exc)
        raise AuthError("ההרשמה נכשלה — ייתכן שהאימייל כבר רשום") from exc

    if result.session is None:
        # Supabase מוגדר לדרוש אימות אימייל — אין session עד שהמשתמש מאשר
        raise AuthError("נשלח אימייל אימות — יש לאשר אותו לפני התחברות")

    profile = fetch_profile(result.session.access_token, result.user.id)
    if profile is None:
        raise AuthError("הפרופיל לא נוצר — פנה לתמיכה")
    return _build_token_response(result.session, profile, result.user.email)


def login(email: str, password: str) -> TokenResponse:
    """התחברות עם אימייל וסיסמה → JWT + פרטי משתמש."""
    client = get_anon_client()
    try:
        result = client.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as exc:
        # הודעה אחידה בכוונה — לא חושפים אם האימייל קיים (מניעת user enumeration)
        raise AuthError("אימייל או סיסמה שגויים") from exc

    profile = fetch_profile(result.session.access_token, result.user.id)
    if profile is None:
        raise AuthError("פרופיל לא נמצא — פנה לתמיכה")
    if profile["status"] == "inactive":
        raise AuthError("החשבון אינו פעיל — פנה למנהל המערכת")
    return _build_token_response(result.session, profile, result.user.email)


def refresh(refresh_token: str) -> TokenResponse:
    """חידוש session עם refresh token."""
    client = get_anon_client()
    try:
        result = client.auth.refresh_session(refresh_token)
    except Exception as exc:
        raise AuthError("ה-session פג — יש להתחבר מחדש") from exc

    if result.session is None or result.user is None:
        raise AuthError("ה-session פג — יש להתחבר מחדש")

    profile = fetch_profile(result.session.access_token, result.user.id)
    if profile is None:
        raise AuthError("פרופיל לא נמצא")
    return _build_token_response(result.session, profile, result.user.email)


def send_reset_password_email(email: str, redirect_url: str | None = None) -> None:
    """
    שולח אימייל איפוס סיסמה. לעולם לא מדווח אם האימייל קיים או לא
    (הודעה כללית בלבד — מניעת user enumeration).
    """
    client = get_anon_client()
    try:
        options = {"redirect_to": redirect_url} if redirect_url else None
        client.auth.reset_password_for_email(email, options)
    except Exception as exc:
        # נרשם ללוג אך לא נחשף למשתמש
        logger.warning("שליחת איפוס סיסמה נכשלה עבור %s: %s", email, exc)


def get_user_by_token(access_token: str) -> UserOut | None:
    """
    אימות JWT: מאמת את הטוקן מול Supabase ושולף את הפרופיל דרך RLS.
    מחזיר None על כל כשל (טוקן פג / לא תקין / תקלה) — לעולם לא 500 למשתמש.
    """
    try:
        client = get_anon_client()
        result = client.auth.get_user(access_token)
        if result is None or result.user is None:
            return None
        profile = fetch_profile(access_token, result.user.id)
    except Exception as exc:
        # תקלה תשתיתית נרשמת ללוג; המשתמש מקבל 401 ויתבקש להתחבר שוב
        logger.warning("אימות טוקן נכשל: %s", exc)
        return None

    if profile is None:
        return None
    return UserOut(
        id=profile["id"],
        email=result.user.email,
        role=profile["role"],
        full_name=profile.get("full_name"),
        phone=profile.get("phone"),
        rivhit_customer_id=profile.get("rivhit_customer_id"),
        status=profile["status"],
    )
