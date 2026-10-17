"""جدولة الحملات — APScheduler (skill: agronholm/apscheduler)."""
from apscheduler.schedulers.background import BackgroundScheduler
from app.core.logging import get_logger
from app.db.session import SessionLocal
from app.db.models import Campaign, CampaignStatus
from app.services.messenger import outreach_queue, build_messages

log = get_logger("scheduler")
_sched = BackgroundScheduler(daemon=True)

def _fire(campaign_id: int):
    db = SessionLocal()
    try:
        camp = db.get(Campaign, campaign_id)
        if not camp or camp.status != CampaignStatus.scheduled: return
        from app.db.models import Template
        build_messages(db, camp, db.get(Template, camp.template_id))
        outreach_queue.enqueue_campaign(camp.id)
        log.info(f"scheduled campaign {camp.id} fired")
    finally:
        db.close()

def schedule_campaign(campaign_id: int, when):
    if not _sched.running: _sched.start()
    _sched.add_job(_fire, "date", run_date=when, args=[campaign_id], id=f"camp-{campaign_id}")

def start_scheduler():
    if not _sched.running:
        _sched.start()
        log.info("APScheduler started")
