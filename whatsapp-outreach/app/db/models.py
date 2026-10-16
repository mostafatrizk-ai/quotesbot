"""نماذج قاعدة البيانات — SQLAlchemy 2.0 (skill: sqlalchemy/sqlalchemy)."""
from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Boolean, JSON, Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
import enum

def utcnow(): return datetime.now(timezone.utc)

class Base(DeclarativeBase): pass

class CampaignStatus(str, enum.Enum):
    draft = "draft"; scheduled = "scheduled"; running = "running"
    completed = "completed"; paused = "paused"; failed = "failed"

class MessageStatus(str, enum.Enum):
    queued = "queued"; sending = "sending"; sent = "sent"
    delivered = "delivered"; read = "read"; failed = "failed"; opt_out = "opt_out"

class Contact(Base):
    __tablename__ = "contacts"
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)  # حقول التخصيص
    opted_out: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class Template(Base):
    __tablename__ = "templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    body: Mapped[str] = mapped_column(Text)          # Jinja2: "مرحبا {{name}}"
    header: Mapped[str] = mapped_column(String(255), default="")
    footer: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class Campaign(Base):
    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"))
    status: Mapped[CampaignStatus] = mapped_column(SAEnum(CampaignStatus), default=CampaignStatus.draft)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    contact_ids: Mapped[list] = mapped_column(JSON, default=list)
    total: Mapped[int] = mapped_column(Integer, default=0)
    sent: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    messages: Mapped[list["Message"]] = relationship(back_populates="campaign", cascade="all, delete-orphan")
    template: Mapped[Template] = relationship()

class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"), index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"))
    status: Mapped[MessageStatus] = mapped_column(SAEnum(MessageStatus), default=MessageStatus.queued, index=True)
    rendered_body: Mapped[str] = mapped_column(Text, default="")
    provider_message_id: Mapped[str] = mapped_column(String(120), default="", index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    retries: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    campaign: Mapped[Campaign] = relationship(back_populates="messages")
    contact: Mapped[Contact] = relationship()

class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str] = mapped_column(String(40))  # delivery_status | message_received
    wa_message_id: Mapped[str] = mapped_column(String(120), index=True, default="")
    phone: Mapped[str] = mapped_column(String(20), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class InboxMessage(Base):
    __tablename__ = "inbox"
    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(20), index=True)
    text: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
