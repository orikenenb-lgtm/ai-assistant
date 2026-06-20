"""
הגדרות המערכת — כל הסודות נטענים ממשתני סביבה בלבד (קובץ .env מקומי).
אסור בשום אופן לכתוב כאן ערכים אמיתיים — רק ברירות מחדל בטוחות לפיתוח.
"""
from functools import lru_cache

from pydantic import model_validator
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

    # ⚠️ מפסק בטיחות: כתיבה ל-Rivhit (יצירת מסמכים) מושבתת כברירת מחדל.
    # מדליקים רק בפרודקשן, אחרי אישור מפורש של אורי.
    rivhit_write_enabled: bool = False

    # סוג מסמך "הצעת מחיר" ב-Rivhit (לאימות מול התיעוד בחשבון האמיתי)
    rivhit_quote_document_type: int = 1

    # סנכרון אוטומטי (cron) — מופעל רק בפרודקשן
    sync_enabled: bool = False
    sync_interval_hours: int = 4

    # שכבת CRM (אדיטיבי) — כבוי כברירת מחדל; ה-router נטען רק כשדלוק.
    enable_crm: bool = True

    # קטלוג רווחית (קריאה בלבד, אדיטיבי) — כבוי כברירת מחדל (staging).
    # טוקן נפרד לחלוטין מ-RIVHIT_API_TOKEN האמיתי: מתחילים על הדמו בלבד.
    enable_catalog: bool = True
    # ברירת מחדל = טוקן הדמו הציבורי של רווחית (לא סוד; מופיע בתיעוד הרשמי).
    # לטוקן האמיתי: מגדירים CATALOG_RIVHIT_TOKEN ב-env (גובר) — רק אחרי אישור.
    catalog_rivhit_token: str = "DECD03E5-E35C-41E8-84F7-FBA2FB483928"
    catalog_rivhit_base_url: str = "https://api.rivhit.co.il/online/RivhitOnlineAPI.svc"

    # התראות — יתמלא ב-Phase 5
    resend_api_key: str = ""
    email_from: str = "Kerem Orders <onboarding@resend.dev>"
    admin_notification_email: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # CORS — ALLOWED_ORIGINS ב-env גובר על ברירת המחדל. לעולם לא "*":
    # wildcard עם allow_credentials=True גם לא נשלח על ידי Starlette וגם מסוכן.
    allowed_origins: str = (
        "https://ai-assistant-seven-theta.vercel.app,"
        "http://localhost:5173,http://localhost:3000"
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @model_validator(mode="after")
    def _require_critical_settings_in_production(self) -> "Settings":
        """בפרודקשן — קונפיג חסר מפיל את השרת בעלייה, לא באמצע בקשה."""
        if self.environment == "production":
            missing = [name for name in
                       ("supabase_url", "supabase_anon_key", "supabase_service_role_key")
                       if not getattr(self, name)]
            if missing:
                raise ValueError(
                    f"חסרים משתני סביבה קריטיים לפרודקשן: {', '.join(missing).upper()}")
        return self

    @property
    def origins_list(self) -> list[str]:
        """רשימת הדומיינים המורשים ל-CORS, מופרדים בפסיקים."""
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """מופע יחיד של ההגדרות (cache) — נטען פעם אחת בעליית השרת."""
    return Settings()
