"""معالجة Webhooks من WhatsApp Cloud API: تقارير DLR + الردود الواردة (Inbox).
تنسيق الحمولة وفق وثائق Meta الرسمية.
"""
from sqlalchemy.orm import Session
from app.core.logging import get_logger
from app.db.models import Contact, InboxMessage, Message, MessageStatus, WebhookEvent
from app.services.safety import is_opt_out_text

log = get_logger("webhooks")

STATUS_MAP = {"sent": MessageStatus.sent, "delivered": MessageStatus.delivered,
              "read": MessageStatus.read, "failed": MessageStatus.failed}

def process_webhook(db: Session, payload: dict) -> dict:
    """تحلل بنية Cloud API webhook وتحدّث حالات الرسائل وصندوق الوارد."""
    handled = {"dlr": 0, "received": 0}
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
                    c = db.query(Contact).filter_by(phone="+" + phone.lstrip("+")).first()
                    if c:
                        c.opted_out = True
                        log.info(f"auto opt-out: {c.phone}")
    db.commit()
    return handled
