"""
הגדרות המערכת — כל הסודות נטענים ממשתני סביבה בלבד (קובץ .env מקומי).
אסור בשום אופן לכתוב כאן ערכים אמיתיים — רק ברירות מחדל בטוחות לפיתוח.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # סביבת ריצה: dev | production
    environment: str = "dev"

    # Supabase — יתמלא ב-Phase 1 (חיבור DB + Auth)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    # Rivhit — יתמלא ב-Phase 2 (סנכרון). הטוקן חי רק בבקנד!
    rivhit_api_token: str = ""
    rivhit_api_base_url: str = "https://online.rivhit.co.il/api/v3"

    # התראות — יתמלא ב-Phase 5
    resend_api_key: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # CORS — בפרודקשן מצמצמים לדומיין האמיתי בלבד
    allowed_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def origins_list(self) -> list[str]:
        """רשימת הדומיינים המורשים ל-CORS, מופרדים בפסיקים."""
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """מופע יחיד של ההגדרות (cache) — נטען פעם אחת בעליית השרת."""
    return Settings()
