"""Baileys Provider — تكامل مع WhiskeySockets/Baileys (Node sidecar).
الاتصال عبر HTTP محلي لجسر Node يشغّل Baileys (websocket غير متاح داخل بايثون).
"""
import httpx
from app.providers.base import WhatsAppProvider, SendResult

SIDECAR_URL = "http://127.0.0.1:3100/send"

class BaileysProvider(WhatsAppProvider):
    name = "baileys"
    def send_text(self, phone: str, text: str) -> SendResult:
        try:
            r = httpx.post(SIDECAR_URL, json={"phone": phone, "text": text}, timeout=20)
            if r.status_code == 200:
                return SendResult(True, provider_message_id=r.json().get("key", {}).get("id", ""))
            return SendResult(False, error=f"sidecar HTTP {r.status_code}")
        except httpx.HTTPError:
            return SendResult(False, error="baileys sidecar unavailable")
    def is_available(self) -> bool:
        try:
            return httpx.get("http://127.0.0.1:3100/health", timeout=3).status_code == 200
        except httpx.HTTPError:
            return False
