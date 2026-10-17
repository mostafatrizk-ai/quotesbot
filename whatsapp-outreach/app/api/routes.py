"""REST API — FastAPI (skill: tiangolo/fastapi). كل المسارات تحت X-API-Key."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models import (Campaign, CampaignStatus, Contact, InboxMessage, Message,
                           Template, WebhookEvent)
from app.db.session import get_db
from app.services import contacts as contact_svc, templating
from app.services.messenger import outreach_queue, build_messages
from app.services.scheduler import schedule_campaign
from app.services.webhooks import process_webhook

router = APIRouter(prefix="/api/v1")

def require_key(x_api_key: str = Header(default="")):
    if x_api_key != settings.api_key:
        raise HTTPException(401, "invalid API key")

# ---------- Schemas ----------
class TemplateIn(BaseModel):
    name: str; body: str; header: str = ""; footer: str = ""
class ContactIn(BaseModel):
    phone: str; name: str = ""; attributes: dict = Field(default_factory=dict)
class BulkContactsIn(BaseModel):
    items: list[ContactIn]
class CampaignIn(BaseModel):
    name: str; template_id: int; contact_ids: list[int]
    scheduled_at: datetime | None = None
class SendNowIn(BaseModel):
    phone: str; text: str

# ---------- Templates ----------
@router.post("/templates", dependencies=[Depends(require_key)])
def create_template(data: TemplateIn, db: Session = Depends(get_db)):
    try: templating.validate(data.body)
    except ValueError as e: raise HTTPException(422, str(e))
    if db.query(Template).filter_by(name=data.name).first():
        raise HTTPException(409, "template name exists")
    t = Template(**data.model_dump()); db.add(t); db.commit(); db.refresh(t)
    return {"id": t.id, "variables": templating.extract_variables(t.body)}

@router.get("/templates")
def list_templates(db: Session = Depends(get_db)):
    return [{"id": t.id, "name": t.name, "body": t.body}
            for t in db.query(Template).all()]

@router.post("/templates/preview")
def preview_template(data: TemplateIn):
    try: templating.validate(data.body)
    except ValueError as e: raise HTTPException(422, str(e))
    sample = {"name": "أحمد", "phone": "+201000000000"}
    try: rendered = templating.render(data.body, sample)
    except ValueError as e: rendered = f"[missing vars] {e}"
    return {"variables": templating.extract_variables(data.body), "rendered": rendered}

# ---------- Contacts ----------
@router.post("/contacts", dependencies=[Depends(require_key)])
def add_contact(data: ContactIn, db: Session = Depends(get_db)):
    phone = contact_svc.normalize_phone(data.phone)
    if not contact_svc.is_valid_phone(phone): raise HTTPException(422, "invalid phone")
    c = db.query(Contact).filter_by(phone=phone).first()
    if c: c.attributes = data.attributes; c.name = data.name or c.name
    else: c = Contact(phone=phone, name=data.name, attributes=data.attributes); db.add(c)
    db.commit(); return {"id": c.id, "phone": c.phone}

@router.post("/contacts/bulk", dependencies=[Depends(require_key)])
def bulk_contacts(data: BulkContactsIn, db: Session = Depends(get_db)):
    return {"added": contact_svc.bulk_add(db, [i.model_dump() for i in data.items])}

@router.post("/contacts/import-csv", dependencies=[Depends(require_key)])
async def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = (await file.read()).decode("utf-8-sig")
    try: return contact_svc.import_csv(db, content)
    except ValueError as e: raise HTTPException(422, str(e))

@router.get("/contacts")
def list_contacts(limit: int = 200, offset: int = 0, db: Session = Depends(get_db)):
    q = db.query(Contact).offset(offset).limit(limit)
    return [{"id": c.id, "phone": c.phone, "name": c.name,
             "opted_out": c.opted_out} for c in q.all()]

@router.post("/contacts/{cid}/opt-out", dependencies=[Depends(require_key)])
def opt_out(cid: int, db: Session = Depends(get_db)):
    c = db.get(Contact, cid)
    if not c: raise HTTPException(404)
    c.opted_out = True; db.commit(); return {"ok": True}

# ---------- Campaigns ----------
@router.post("/campaigns", dependencies=[Depends(require_key)])
def create_campaign(data: CampaignIn, db: Session = Depends(get_db)):
    tpl = db.get(Template, data.template_id)
    if not tpl: raise HTTPException(422, "template not found")
    valid_ids = [c.id for c in db.query(Contact).filter(Contact.id.in_(data.contact_ids),
                 Contact.opted_out == False).all()]   # noqa: E712
    if not valid_ids: raise HTTPException(422, "no eligible contacts")
    camp = Campaign(name=data.name, template_id=tpl.id, contact_ids=valid_ids)
    if data.scheduled_at:
        when = data.scheduled_at
        if when.tzinfo is None: when = when.replace(tzinfo=timezone.utc)
        if when <= datetime.now(timezone.utc): raise HTTPException(422, "scheduled time in past")
        camp.status = CampaignStatus.scheduled
        camp.scheduled_at = when
        db.add(camp); db.commit(); db.refresh(camp)
        schedule_campaign(camp.id, when)
        return {"id": camp.id, "status": "scheduled", "recipients": len(valid_ids)}
    camp.status = CampaignStatus.draft
    db.add(camp); db.commit(); db.refresh(camp)
    n = build_messages(db, camp, tpl)
    return {"id": camp.id, "status": "draft", "messages_queued": n}

@router.post("/campaigns/{cid}/start", dependencies=[Depends(require_key)])
def start_campaign(cid: int, db: Session = Depends(get_db)):
    camp = db.get(Campaign, cid)
    if not camp: raise HTTPException(404)
    if camp.status not in (CampaignStatus.draft, CampaignStatus.paused):
        raise HTTPException(409, f"cannot start from {camp.status.value}")
    outreach_queue.enqueue_campaign(camp.id)
    return {"id": cid, "status": "queued"}

@router.post("/campaigns/{cid}/pause", dependencies=[Depends(require_key)])
def pause_campaign(cid: int, db: Session = Depends(get_db)):
    camp = db.get(Campaign, cid)
    if not camp: raise HTTPException(404)
    camp.status = CampaignStatus.paused; db.commit()
    return {"id": cid, "status": "paused"}

@router.get("/campaigns")
def list_campaigns(db: Session = Depends(get_db)):
    return [{"id": c.id, "name": c.name, "status": c.status.value,
             "total": c.total, "sent": c.sent, "failed": c.failed,
             "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None}
            for c in db.query(Campaign).all()]

@router.get("/campaigns/{cid}")
def campaign_detail(cid: int, db: Session = Depends(get_db)):
    camp = db.get(Campaign, cid)
    if not camp: raise HTTPException(404)
    msgs = db.query(Message).filter_by(campaign_id=cid).all()
    return {"id": camp.id, "name": camp.name, "status": camp.status.value,
            "total": camp.total, "sent": camp.sent, "failed": camp.failed,
            "messages": [{"id": m.id, "contact_id": m.contact_id,
                          "status": m.status.value, "error": m.error,
                          "wa_id": m.provider_message_id} for m in msgs]}

# ---------- Single send ----------
@router.post("/send", dependencies=[Depends(require_key)])
def send_single(data: SendNowIn, db: Session = Depends(get_db)):
    from app.providers.registry import get_provider
    phone = contact_svc.normalize_phone(data.phone)
    res = get_provider().send_text(phone, data.text)
    if not res.success: raise HTTPException(502, res.error)
    return {"ok": True, "message_id": res.provider_message_id}

# ---------- Inbox & DLR ----------
@router.get("/inbox")
def inbox(unread_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(InboxMessage)
    if unread_only: q = q.filter_by(is_read=False)
    return [{"id": i.id, "phone": i.phone, "text": i.text, "read": i.is_read}
            for i in q.order_by(InboxMessage.id.desc()).limit(200).all()]

@router.post("/inbox/{iid}/read", dependencies=[Depends(require_key)])
def mark_read(iid: int, db: Session = Depends(get_db)):
    i = db.get(InboxMessage, iid)
    if not i: raise HTTPException(404)
    i.is_read = True; db.commit(); return {"ok": True}

@router.get("/webhook-events")
def webhook_events(db: Session = Depends(get_db)):
    return [{"type": e.event_type, "wa_id": e.wa_message_id, "phone": e.phone}
            for e in db.query(WebhookEvent).order_by(WebhookEvent.id.desc()).limit(100).all()]

@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    from sqlalchemy import func
    by_status = dict(db.query(Message.status, func.count()).group_by(Message.status).all())
    return {"contacts": db.query(func.count(Contact.id)).scalar(),
            "campaigns": db.query(func.count(Campaign.id)).scalar(),
            "messages_by_status": {k.value if hasattr(k, "value") else str(k): v
                                   for k, v in by_status.items()},
            "unread_inbox": db.query(func.count(InboxMessage.id)).filter_by(is_read=False).scalar()}
