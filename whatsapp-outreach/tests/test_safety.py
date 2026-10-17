"""اختبارات طبقة Anti-Ban Guard (safety.py)."""
import time
from app.services import safety
from app.core.config import settings


def test_opt_out_words_arabic_and_english():
    assert safety.is_opt_out_text("stop")
    assert safety.is_opt_out_text("STOP")
    assert safety.is_opt_out_text("إيقاف")
    assert safety.is_opt_out_text("unsubscribe now".split()[0])  # unsubscribe
    assert not safety.is_opt_out_text("hello")
    assert not safety.is_opt_out_text("stopwatch")  # يجب ألا تنطلي ككلمة مركبة


def test_duplicate_window_blocks_second_send():
    g = safety.DailyGuard()
    ok, _ = g.can_send("+201000000001")
    assert ok
    g.record_send("+201000000001")
    ok2, reason = g.can_send("+201000000001")
    assert not ok2 and "duplicate" in reason
    # رقم مختلف مسموح
    ok3, _ = g.can_send("+201000000002")
    assert ok3


def test_daily_cap_enforced():
    g = safety.DailyGuard()
    orig = settings.max_daily_messages
    settings.max_daily_messages = 3
    try:
        for i in range(3):
            ok, _ = g.can_send(f"+2010000099{i}")
            assert ok, f"send {i} should pass"
            g.record_send(f"+2010000099{i}")
        ok, reason = g.can_send("+20100000999")
        assert not ok and "daily cap" in reason
    finally:
        settings.max_daily_messages = orig


def test_guard_stats_shape():
    s = safety.stats()
    assert set(s) == {"sent_today", "daily_cap", "dedup_window_s", "numbers_tracked"}
