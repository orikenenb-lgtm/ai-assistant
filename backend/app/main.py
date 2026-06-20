"""
Kerem Orders — שרת ה-API הראשי.
מערכת ניהול הזמנות לסיטונאות צעצועים, מחוברת ל-Rivhit Online.
"""
import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.rate_limit import limiter
from app.routers import admin, admin_quotes, admin_sync, auth, orders, products
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
        # ממתינים לסיום הביטול — כיבוי נקי בלי משימות תלויות באוויר
        with suppress(asyncio.CancelledError):
            await task


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
app.include_router(admin.router)
app.include_router(admin_quotes.router)
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


# ----- הגשת הפרונט (SPA) מאותו שרת -----
# בפרודקשן ה-Dockerfile בונה את frontend/dist ומעתיק אותו ל-/app/static.
# כך אותו דומיין מגיש גם את ה-API וגם את האתר — בלי CORS ובלי אירוח נפרד.
# בבדיקות אין תיקיית static, ולכן ההגשה לא נרשמת וההתנהגות לא משתנה.
import os  # noqa: E402

from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

_STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"
)

if os.path.isdir(_STATIC_DIR):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(_STATIC_DIR, "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        """כל נתיב שאינו API — מגיש קובץ סטטי אם קיים, אחרת index.html (ניתוב צד-לקוח)."""
        candidate = os.path.join(_STATIC_DIR, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_STATIC_DIR, "index.html"))
