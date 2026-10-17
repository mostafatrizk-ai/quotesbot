"""مسارات Webhook لـ WhatsApp Cloud API (بدون API key — تحقق بـ verify token)."""
import hashlib
from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request
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


@router.post("/evolution/{instance}")
async def receive_evolution(instance: str, request: Request,
                            x_evolution_token: str = Header(default=""),
                            db: Session = Depends(get_db)):
    """Webhook خاص بـ Evolution API v2.

    في إعدادات الـ webhook بالسيرفر ضع:
      url: https://<host>/webhooks/evolution/<instance>
      bearerSecretKey (أو header): قيمة EVOLUTION_WEBHOOK_TOKEN
    """
    if settings.evolution_webhook_token:
        import hmac
        expected = settings.evolution_webhook_token.encode()
        got = x_evolution_token.encode()
        if not hmac.compare_digest(expected, got):
            raise HTTPException(403, "invalid evolution webhook token")
    payload = await request.json()
    result = process_webhook(db, payload)
    result["instance"] = instance
    return result
