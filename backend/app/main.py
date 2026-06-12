"""
Kerem Orders — שרת ה-API הראשי.
מערכת ניהול הזמנות לסיטונאות צעצועים, מחוברת ל-Rivhit Online.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Kerem Orders API",
    description="מערכת ניהול הזמנות — סיטונאות צעצועים",
    version="0.1.0",
)

# CORS — רק הדומיינים שהוגדרו ב-env מורשים לגשת
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check() -> dict:
    """בדיקת חיים — משמשת את בדיקות העשן ואת ה-health check של Railway."""
    return {
        "status": "ok",
        "service": "kerem-orders-api",
        "environment": settings.environment,
    }
