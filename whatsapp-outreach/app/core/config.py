"""إعدادات النظام — pydantic-settings (skill: pydantic/pydantic)."""
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "WhatsApp Outreach System"
    database_url: str = "sqlite:///./data/outreach.db"
    # WhatsApp Cloud API (Meta) — github.com/facebook
    wa_cloud_token: str = ""
    wa_cloud_phone_number_id: str = ""
    wa_cloud_version: str = "v20.0"
    webhook_verify_token: str = "change-me-verify-token"
    # Rate limiting / anti-ban (skill: bandwith-io/ratelimit + jd/tenacity)
    messages_per_minute: int = 20
    max_burst: int = 5
    jitter_seconds: float = 1.5
    warmup_enabled: bool = True
    provider: str = "evolution"  # mock | cloud_api | baileys | evolution
    # Evolution API (Evolution-API/WhatsApp v2) — السيرفر الشخصي لواتساب
    evolution_base_url: str = ""          # مثال: https://evo.seyana.workers.dev أو http://host:8080
    evolution_api_key: str = ""           # global apikey من إعدادات السيرفر
    evolution_instance: str = "outreach"  # اسم الـ instance المستخدم للإرسال
    evolution_webhook_token: str = ""     # يتحقق من هيدر X-Evolution-Token في /webhooks/evolution
    api_key: str = "outreach-admin-key"
    # Anti-Ban Guard (app/services/safety.py)
    max_daily_messages: int = 500          # حد يومي إجمالي لحماية الرقم
    dedup_window_seconds: int = 3600       # لا تكرار لنفس الرقم خلال ساعة

settings = Settings()
