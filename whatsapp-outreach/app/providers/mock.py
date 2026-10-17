"""Mock provider للتجربة والاختبار بدون حساب واتساب فعلي."""
import itertools, random
from app.providers.base import WhatsAppProvider, SendResult

class MockProvider(WhatsAppProvider):
    name = "mock"
    def __init__(self):
        self._ids = itertools.count(1)
        self.sent_log: list[tuple[str, str]] = []
    def send_text(self, phone: str, text: str) -> SendResult:
        if not phone or phone.startswith("000"):   # محاكاة رقم غير صالح
            return SendResult(False, error="invalid recipient")
        if random.random() < 0.02:                 # محاكاة فشل نادر
            return SendResult(False, error="transient network error")
        mid = f"wamid.MOCK{next(self._ids)}"
        self.sent_log.append((phone, text))
        return SendResult(True, provider_message_id=mid)
    def is_available(self) -> bool: return True
