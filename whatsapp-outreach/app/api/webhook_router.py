"""مسارات Webhook لـ WhatsApp Cloud API (بدون API key — تحقق بـ verify token)."""
import hashlib
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.session import get_db
from app.services.webhooks import process_webhook

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router.get("/whatsapp")
def verify(mode: str = Query(""), challenge: str = Query(""), token: str = Query("")):
    """handshake التحقق من Meta."""
    if mode == "subscribe" and token == settings.webhook_verify_token:
        return challenge
    raise HTTPException(403, "verify token mismatch")

@router.post("/whatsapp")
async def receive(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    return process_webhook(db, payload)
