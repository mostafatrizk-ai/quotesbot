"""Evolution API Provider — تكامل مع Evolution-API/WhatsApp (v2).

منفذ عبر REST الرسمي للسيرفر:
  POST {base}/message/sendText/{instance}
  header: apikey: <EVOLUTION_API_KEY>
  body:   {"number": "2010...", "text": "...", "delay4s?": ...}

ملاحظة: الأرقام تُرسل بصيغة دولية بدون '+' عند Evolution.
"""
import httpx
from app.core.config import settings
from app.providers.base import WhatsAppProvider, SendResult


class EvolutionProvider(WhatsAppProvider):
    name = "evolution"

    def _headers(self) -> dict:
        return {"apikey": settings.evolution_api_key,
                "Content-Type": "application/json"}

    def _url(self, path: str) -> str:
        base = settings.evolution_base_url.rstrip("/")
        return f"{base}/{path.lstrip('/')}"

    def send_text(self, phone: str, text: str) -> SendResult:
        number = phone.replace("+", "").replace(" ", "")
        payload = {"number": number, "text": text,
                   "linkWithInPreview": False, "delay": 1000}
        url = self._url(f"message/sendText/{settings.evolution_instance}")
        try:
            r = httpx.post(url, json=payload, headers=self._headers(), timeout=30)
            if r.status_code in (200, 201):
                data = r.json() if r.content else {}
                mid = (data.get("key", {}) or {}).get("id") or \
                      (data.get("data", {}) or {}).get("key", {}).get("id", "") \
                      if isinstance(data, dict) else ""
                return SendResult(True, provider_message_id=str(mid or ""))
            return SendResult(False, error=f"evolution HTTP {r.status_code}: {r.text[:200]}")
        except httpx.HTTPError as e:
            return SendResult(False, error=f"evolution unreachable: {e}")

    def is_available(self) -> bool:
        """فحص الاتصال + حالة instance عبر /instance/fetchInstances."""
        if not settings.evolution_api_key or not settings.evolution_base_url:
            return False
        try:
            r = httpx.get(self._url("instance/connectionState/" + settings.evolution_instance),
                          headers=self._headers(), timeout=5)
            return r.status_code == 200
        except httpx.HTTPError:
            return False
