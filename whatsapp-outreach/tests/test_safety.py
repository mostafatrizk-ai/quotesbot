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


def test_evolution_webhook_dlr_and_inbox(client, db_session):
    """رسالة Evolution messages.upsert (واردة) + messages.update (DLR)."""
    from app.db.models import Campaign, CampaignStatus, Message, MessageStatus, Contact, Template
    t = Template(name="evo-tpl-" + str(__import__("uuid").uuid4().hex[:6]), body="hi {{name}}")
    db_session.add(t); db_session.commit()
    cp = Campaign(name="evo-camp", template_id=t.id, status=CampaignStatus.draft)
    db_session.add(cp); db_session.commit()
    # contact + message مزوّدة بـ provider_message_id
    c = Contact(phone="+201099887766", name="Evo Test"); db_session.add(c); db_session.commit()
    m = Message(contact_id=c.id, campaign_id=cp.id, rendered_body="x",
                status=MessageStatus.sent, provider_message_id="EVOMID123")
    db_session.add(m); db_session.commit()
    # DLR
    r = client.post("/webhooks/evolution/outreach", json={
        "event": "messages.update", "instance": "outreach",
        "data": {"key": {"id": "EVOMID123", "remoteJid": "201099887766@s.whatsapp.net"},
                 "status": "DELIVERED"}})
    assert r.status_code == 200 and r.json()["dlr"] == 1
    db_session.refresh(m); assert m.status == MessageStatus.delivered
    # inbox + opt-out عربي
    r = client.post("/webhooks/evolution/outreach", json={
        "event": "messages.upsert", "instance": "outreach",
        "data": {"key": {"id": "IN1", "remoteJid": "201099887766@s.whatsapp.net",
                         "fromMe": False},
                 "message": {"conversation": "إيقاف"}}})
    assert r.json()["received"] == 1
    db_session.refresh(c); assert c.opted_out is True


def test_evolution_provider_send(monkeypatch):
    """send_text يستدعي sendText endpoint مع apikey header وصيغة رقم بدون +."""
    from app.core.config import settings
    from app.providers.evolution import EvolutionProvider
    import httpx
    settings.evolution_base_url = "http://fake:8080"
    settings.evolution_api_key = "KEY123"
    settings.evolution_instance = "outreach"
    captured = {}
    def fake_post(url, json=None, headers=None, timeout=None):
        captured.update(url=url, body=json, headers=headers)
        class R:
            status_code = 200; content = b"{}"; text = ""
            def json(self): return {"key": {"id": "ABC"}}
        return R()
    monkeypatch.setattr(httpx, "post", fake_post)
    res = EvolutionProvider().send_text("+201012345678", "مرحبا")
    assert res.success and res.provider_message_id == "ABC"
    assert captured["url"].endswith("/message/sendText/outreach")
    assert captured["headers"]["apikey"] == "KEY123"
    assert captured["body"]["number"] == "201012345678"  # بدون +


def test_evolution_webhook_token_guard(client, monkeypatch):
    from app.core.config import settings
    settings.evolution_webhook_token = "s3cret"
    r = client.post("/webhooks/evolution/outreach", json={"event": "messages.update", "data": {}})
    assert r.status_code == 403
    r = client.post("/webhooks/evolution/outreach",
                    headers={"X-Evolution-Token": "s3cret"},
                    json={"event": "messages.update", "data": {}})
    assert r.status_code == 200
    settings.evolution_webhook_token = ""
