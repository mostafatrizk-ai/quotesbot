"""محرك الإرسال: طابور داخلي + Rate limiting + Retry (tenacity) + Anti-Ban.
في الإنتاج يمكن استبداله بـ Celery+Redis — الواجهة تبقى نفسها.
"""
import queue, threading, time
from sqlalchemy.orm import Session
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError
from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import SessionLocal
from app.db.models import Campaign, CampaignStatus, Contact, Message, MessageStatus, Template
from app.providers.registry import get_provider
from app.services.rate_limiter import TokenBucketRateLimiter
from app.services import templating

log = get_logger("messenger")

class OutreachQueue:
    def __init__(self):
        self.q: "queue.Queue[int]" = queue.Queue()
        self.limiter = TokenBucketRateLimiter(
            messages_per_minute=settings.messages_per_minute,
            burst=settings.max_burst, jitter_seconds=settings.jitter_seconds,
            warmup_enabled=settings.warmup_enabled)
        self._worker: threading.Thread | None = None
        self._stop = threading.Event()

    def enqueue_campaign(self, campaign_id: int):
        self.q.put(campaign_id)
        self._ensure_worker()

    def _ensure_worker(self):
        if self._worker and self._worker.is_alive(): return
        self._stop.clear()
        self._worker = threading.Thread(target=self._run, daemon=True, name="wa-sender")
        self._worker.start()

    def stop(self): self._stop.set()

    def _run(self):
        while not self._stop.is_set():
            try:
                cid = self.q.get(timeout=1)
            except queue.Empty:
                continue
            try:
                self.process_campaign(cid)
            except Exception as e:
                log.error(f"campaign {cid} crashed: {e}")
            finally:
                self.q.task_done()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    def _send_with_retry(self, provider, phone: str, text: str):
        res = provider.send_text(phone, text)
        if not res.success and ("retryable" in res.error or "network" in res.error
                                or "transient" in res.error):
            raise RuntimeError(res.error)   # تدخ tenacity → إعادة محاولة مع backoff
        return res

    def process_campaign(self, campaign_id: int):
        db: Session = SessionLocal()
        try:
            camp = db.get(Campaign, campaign_id)
            if not camp or camp.status not in (CampaignStatus.scheduled, CampaignStatus.running,
                                               CampaignStatus.draft):
                return
            camp.status = CampaignStatus.running
            db.commit()
            provider = get_provider()
            pending = (db.query(Message).filter_by(campaign_id=campaign_id,
                       status=MessageStatus.queued).all())
            camp.total = len(pending) + camp.sent
            for msg in pending:
                if self._stop.is_set() or db.get(Campaign, campaign_id).status == CampaignStatus.paused:
                    db.commit(); return
                contact = db.get(Contact, msg.contact_id)
                if contact.opted_out:
                    msg.status = MessageStatus.opt_out; camp.failed += 1
                    db.commit(); continue
                self.limiter.acquire()
                msg.status = MessageStatus.sending; db.commit()
                try:
                    res = self._send_with_retry(provider, contact.phone, msg.rendered_body)
                except RetryError as e:
                    last = e.last_attempt.exception()
                    res = type("R", (), {"success": False, "provider_message_id": "", "error": str(last)})()
                msg.retries += 1
                if res.success:
                    msg.status = MessageStatus.sent
                    msg.provider_message_id = res.provider_message_id
                    camp.sent += 1
                    log.info(f"sent -> {contact.phone} ({res.provider_message_id})")
                else:
                    msg.status = MessageStatus.failed
                    msg.error = res.error
                    camp.failed += 1
                    log.warning(f"failed -> {contact.phone}: {res.error}")
                db.commit()
            remaining = db.query(Message).filter_by(campaign_id=campaign_id,
                        status=MessageStatus.queued).count()
            if remaining == 0:
                camp.status = CampaignStatus.completed
                db.commit()
        finally:
            db.close()

outreach_queue = OutreachQueue()

def build_messages(db: Session, campaign: Campaign, template: Template) -> int:
    """يعرض القالب لكل جهة اتصال ويهيئ رسائل الطابور."""
    count = 0
    for cid in campaign.contact_ids:
        contact = db.get(Contact, cid)
        if not contact: continue
        ctx = {"name": contact.name or "عميل", "phone": contact.phone, **contact.attributes}
        try:
            body = templating.render(template.body, ctx)
        except ValueError as e:
            body = f"[render-error] {e}"
        db.add(Message(campaign_id=campaign.id, contact_id=cid,
                       status=MessageStatus.queued, rendered_body=body))
        count += 1
    db.commit(); return count
