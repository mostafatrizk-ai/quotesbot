"""طبقة الحماية من الحظر (Anti-Ban Guard) — مسؤولة عن:
1) Opt-out فوري بكلمة STOP/إيقاف في نص الرسالة الواردة (وكذلك خارج Webhook).
2) Warm-up تدريجي لكل رقم على مستوى يومي (وليس فقط على مستوى الـ rate limiter).
3) Jitter عشوائي بين الرسائل داخل نفس الحملة.
4) منع إرسال أكثر من رسالة لنفس جهة الاتصال خلال فترة قصيرة (Deduplication).
5) حد أقصى يومي لإجمالي الرسائل عبر كل الحملات لحماية الرقم.
مفهوم مستوحى من أفضل ممارسات WhatsApp Business + bandwith-io/ratelimit وjd/tenacity.
"""
from __future__ import annotations
import threading, time
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db.models import Contact, Message, MessageStatus

OPT_OUT_WORDS = {"stop", "optout", "unsubscribe", "إيقاف", "إلغاء", "قفي", "خروج"}


def is_opt_out_text(text: str) -> bool:
    t = (text or "").strip().lower()
    return any(t == w or t.startswith(w + " ") for w in OPT_OUT_WORDS)


class DailyGuard:
    """عدّاد يومي + آخر وقت إرسال لكل رقم — يطبّق الحد اليومي ونافذة منع التكرار.

    نافذة الـ dedup لا تنطبق على الرسائل المجدولة مسبقًا داخل نفس الحملة،
    لأن كل جهة اتصال لها رسالة واحدة فقط في الحملة الواحدة؛ هي تحمي فقط
    من حملتين ترسلان لنفس الرقم في وقت متقارب.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._day_key = ""
        self._sent_today = 0
        self._last_send_ts: dict[str, float] = {}

    def _today(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def can_send(self, phone: str, skip_dedup: bool = False) -> tuple[bool, str]:
        today = self._today()
        with self._lock:
            if today != self._day_key:
                self._day_key = today
                self._sent_today = 0
            # الحد اليومي الإجمالي
            if self._sent_today >= settings.max_daily_messages:
                return False, f"daily cap reached ({settings.max_daily_messages})"
            # Deduplication: لا تكرار لنفس الرقم داخل نافذة زمنية قصيرة
            if not skip_dedup:
                last = self._last_send_ts.get(phone)   # None = أول رسالة أبدًا → مسموح
                if last is not None and time.monotonic() - last < settings.dedup_window_seconds:
                    return False, "duplicate window (same number)"
            return True, ""

    def record_send(self, phone: str):
        with self._lock:
            self._sent_today += 1
            self._last_send_ts[phone] = time.monotonic()


daily_guard = DailyGuard()


def stats() -> dict:
    """لقطة من حالة الحارس — تُعرض في /health و لوحة الأدمن."""
    g = daily_guard
    with g._lock:
        return {
            "sent_today": g._sent_today,
            "daily_cap": settings.max_daily_messages,
            "dedup_window_s": settings.dedup_window_seconds,
            "numbers_tracked": len(g._last_send_ts),
        }
