"""نقطة الدخول — FastAPI app + Scheduler + Admin dashboard."""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from app.core.config import settings
from app.db.session import init_db
from app.api.routes import router as api_router
from app.api.webhook_router import router as webhook_router
from app.services.scheduler import start_scheduler
from app.admin.dashboard import router as admin_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    yield

app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.include_router(api_router)
app.include_router(webhook_router)
app.include_router(admin_router)

@app.get("/health")
def health(): return {"status": "ok", "provider": settings.provider}

@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)})
