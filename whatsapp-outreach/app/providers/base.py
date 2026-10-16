"""واجهة موحدة لمزودي واتساب — نمط Strategy."""
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class SendResult:
    success: bool
    provider_message_id: str = ""
    error: str = ""

class WhatsAppProvider(ABC):
    name: str = "base"
    @abstractmethod
    def send_text(self, phone: str, text: str) -> SendResult: ...
    @abstractmethod
    def is_available(self) -> bool: ...
