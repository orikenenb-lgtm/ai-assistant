"""
יצירת לקוחות Supabase.

שלושה סוגים:
- anon client      — לפעולות auth (login/signup/refresh).
- user client      — client עם ה-JWT של המשתמש: כל query עובר דרך RLS! (שכבת הגנה 1)
- service client   — עוקף RLS. לשימוש מערכת בלבד (sync, audit) — לעולם לא עם קלט משתמש גולמי.
"""
from supabase import Client, ClientOptions, create_client

from app.config import get_settings


def get_anon_client() -> Client:
    """Client ציבורי — לפעולות אימות בלבד."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)


def get_user_client(access_token: str) -> Client:
    """
    Client הפועל בזהות המשתמש: ה-JWT מוצמד לכל בקשה ולכן RLS נאכף ב-DB.
    נוצר מופע חדש לכל בקשה כדי למנוע זליגת טוקן בין בקשות מקביליות.
    """
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=ClientOptions(headers={"Authorization": f"Bearer {access_token}"}),
    )


def get_service_client() -> Client:
    """Client מערכת (service role) — עוקף RLS. שימוש פנימי בלבד!"""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
