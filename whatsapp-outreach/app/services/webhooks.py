"""معالجة Webhooks: تقارير DLR + الردود الواردة (Inbox).
تدعم تنسيقين:
  1) WhatsApp Cloud API (Meta) — entry/changes/values.
  2) Evolution API v2 — {event: messages.upsert|messages.update, instance, data: {...}}.
"""
from sqlalchemy.orm import Session
from app.core.logging import get_logger
from app.db.models import Contact, InboxMessage, Message, MessageStatus, WebhookEvent
from app.services.safety import is_opt_out_text

log = get_logger("webhooks")

STATUS_MAP = {"sent": MessageStatus.sent, "delivered": MessageStatus.delivered,
              "read": MessageStatus.read, "failed": MessageStatus.failed}
# حالات Baileys/Evolution numeric: 0 pending,1 sent,2 delivered,3 read,4 failed
EVO_STATUS_MAP = {0: None, 1: MessageStatus.sent, 2: MessageStatus.delivered,
                  3: MessageStatus.read, 4: MessageStatus.failed}


def _mark_optout(db: Session, phone: str) -> None:
    c = db.query(Contact).filter_by(phone="+" + phone.lstrip("+")).first()
    if c and not c.opted_out:
        c.opted_out = True
        log.info(f"auto opt-out: {c.phone}")


def _process_evolution(db: Session, payload: dict, handled: dict) -> None:
    event = payload.get("event", "")
    data = payload.get("data") or {}
    if event == "messages.update":
        # DLR من Evolution: data.key.id + data.status ('DELIVERED'/'READ'/...)
        key = data.get("key") or {}
        mid = key.get("id", "")
        st_raw = str(data.get("status", "")).lower()
        db.add(WebhookEvent(event_type="delivery_status", wa_message_id=mid,
                            phone=key.get("remoteJid", ""), payload=payload))
        m = db.query(Message).filter_by(provider_message_id=mid).first()
        if m:
            if st_raw in STATUS_MAP:
                m.status = STATUS_MAP[st_raw]
            else:
                num = data.get("statusCode")
                if isinstance(num, int) and EVO_STATUS_MAP.get(num):
                    m.status = EVO_STATUS_MAP[num]
            handled["dlr"] += 1
    elif event == "messages.upsert":
        msgs = data.get("messages") or ([data] if data.get("key") else [])
        for msg in msgs:
            key = msg.get("key") or {}
            if key.get("fromMe"):
                continue  # رسائلنا المرسلة عبر الـ instance — ليست واردة
            phone = (key.get("remoteJid") or "").split("@")[0]
            text = ((msg.get("message") or {}).get("conversation")
                    or ((msg.get("message") or {}).get("extendedTextMessage") or {}).get("text", ""))
            db.add(WebhookEvent(event_type="message_received",
                                wa_message_id=key.get("id", ""), phone=phone,
                                payload=payload))
            db.add(InboxMessage(phone=phone, text=text))
            handled["received"] += 1
            if is_opt_out_text(text):
                _mark_optout(db, phone)


def process_webhook(db: Session, payload: dict) -> dict:
    """يوجّه الحمولة للمحلل المناسب حسب بنيتها (Cloud API أو Evolution)."""
    handled = {"dlr": 0, "received": 0}
    if "entry" in payload:
        _process_meta(db, payload, handled)
    elif payload.get("event", "").startswith("messages."):
        _process_evolution(db, payload, handled)
    db.commit()
    return handled


def _process_meta(db: Session, payload: dict, handled: dict) -> None:
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            msg_id = ""
            statuses = value.get("statuses", [])
            if statuses:
                msg_id = statuses[0].get("id", "")
                db.add(WebhookEvent(event_type="delivery_status", wa_message_id=msg_id,
                                    phone=statuses[0].get("recipient_id", ""),
                                    payload=value))
                st = statuses[0].get("status")
                m = db.query(Message).filter_by(provider_message_id=msg_id).first()
                if m and st in STATUS_MAP:
                    m.status = STATUS_MAP[st]
                    if st == "failed":
                        m.error = str(statuses[0].get("errors", ""))[:500]
                    handled["dlr"] += 1
            for msg in value.get("messages", []):
                phone = msg.get("from", "")
                text = (msg.get("text") or {}).get("body", "")
                db.add(WebhookEvent(event_type="message_received",
                                    wa_message_id=msg.get("id", ""), phone=phone,
                                    payload=value))
                inbox = InboxMessage(phone=phone, text=text)
                db.add(inbox)
                handled["received"] += 1
                # Opt-out تلقائي: STOP / إيقاف (منطق موسّع في safety.is_opt_out_text)
                if is_opt_out_text(text):
                    _mark_optout(db, phone)

