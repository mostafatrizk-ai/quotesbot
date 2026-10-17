"""WhatsApp Cloud API Provider — وفق توثيق Meta الرسمي (github.com/facebook).
POST https://graph.facebook.com/{version}/{phone_number_id}/messages
"""
import httpx
from app.core.config import settings
from app.providers.base import WhatsAppProvider, SendResult

class CloudApiProvider(WhatsAppProvider):
    name = "cloud_api"
    def __init__(self):
        self.base_url = f"https://graph.facebook.com/{settings.wa_cloud_version}"
        self.headers = {"Authorization": f"Bearer {settings.wa_cloud_token}",
                        "Content-Type": "application/json"}
    def send_text(self, phone: str, text: str) -> SendResult:
        payload = {"messaging_product": "whatsapp", "to": phone.lstrip("+"),
                   "type": "text", "text": {"preview_url": False, "body": text}}
        url = f"{self.base_url}/{settings.wa_cloud_phone_number_id}/messages"
        try:
            r = httpx.post(url, json=payload, headers=self.headers, timeout=15)
            if r.status_code == 200:
                return SendResult(True, provider_message_id=r.json()["messages"][0]["id"])
            if r.status_code in (429, 500, 503):  # قابل لإعادة المحاولة
                return SendResult(False, error=f"retryable HTTP {r.status_code}")
            return SendResult(False, error=f"HTTP {r.status_code}: {r.text[:200]}")
        except httpx.HTTPError as e:
            return SendResult(False, error=f"network: {e}")
    def is_available(self) -> bool:
        return bool(settings.wa_cloud_token and settings.wa_cloud_phone_number_id)
