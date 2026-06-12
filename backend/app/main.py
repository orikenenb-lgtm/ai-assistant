"""
Kerem Orders — שרת ה-API הראשי.
מערכת ניהול הזמנות לסיטונאות צעצועים, מחוברת ל-Rivhit Online.
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.rate_limit import limiter
from app.routers import admin_sync, auth, orders, products
from app.scheduler import sync_loop

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """בעליית השרת: מפעיל את לולאת הסנכרון האוטומטי (אם SYNC_ENABLED)."""
    task: asyncio.Task | None = None
    if settings.sync_enabled:
        task = asyncio.create_task(sync_loop())
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="Kerem Orders API",
    description="מערכת ניהול הזמנות — סיטונאות צעצועים",
    version="0.1.0",
    lifespan=lifespan,
)

# הגבלת קצב — מוצמדת לאפליקציה כדי שה-decorators ב-routers יעבדו
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — רק הדומיינים שהוגדרו ב-env מורשים לגשת
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin_sync.router)
app.include_router(products.router)
app.include_router(orders.router)


@app.get("/health")
def health_check() -> dict:
    """בדיקת חיים — משמשת את בדיקות העשן ואת ה-health check של Railway."""
    return {
        "status": "ok",
        "service": "kerem-orders-api",
        "environment": settings.environment,
    }
