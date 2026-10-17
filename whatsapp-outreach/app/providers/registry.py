from app.core.config import settings
from app.providers.base import WhatsAppProvider
from app.providers.mock import MockProvider
from app.providers.cloud_api import CloudApiProvider
from app.providers.baileys import BaileysProvider
from app.providers.evolution import EvolutionProvider

_providers: dict[str, WhatsAppProvider] = {}

def get_provider(name: str | None = None) -> WhatsAppProvider:
    name = name or settings.provider
    if name not in _providers:
        _providers[name] = {"mock": MockProvider, "cloud_api": CloudApiProvider,
                            "baileys": BaileysProvider,
                            "evolution": EvolutionProvider}[name]()
    return _providers[name]
