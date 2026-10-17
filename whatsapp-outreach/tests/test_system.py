"""اختبارات شاملة للنظام — pytest (skill: pytest-dev/pytest)."""
import time
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import init_db
from app.services.templating import render, extract_variables, validate
from app.services.rate_limiter import TokenBucketRateLimiter
from app.services.contacts import normalize_phone, is_valid_phone


@pytest.fixture(scope="module")
def client():
    init_db()
    with TestClient(app) as c:
        yield c


H = {"X-API-Key": "outreach-admin-key"}


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_templating_unit():
    assert render("مرحبا {{name}}!", {"name": "أحمد"}) == "مرحبا أحمد!"
    assert extract_variables("{{a}} و {{b}} و {{a}}") == ["a", "b"]
    with pytest.raises(ValueError):
        validate("{{ unclosed")


def test_phone_helpers():
    assert normalize_phone("+20 100 111 2233") == "+201001112233"
    assert is_valid_phone("+201001112233")
    assert not is_valid_phone("123")


def test_full_campaign_flow(client):
    # 1) قالب مع متغيرات تخصيص
    r = client.post("/api/v1/templates", headers=H, json={
        "name": "promo1", "body": "عرض خاص {{name}}! خصم {{discount}}%"})
    assert r.status_code == 200 and r.json()["variables"] == ["discount", "name"]
    tpl_id = r.json()["id"]

    # 2) جهات اتصال bulk
    r = client.post("/api/v1/contacts/bulk", headers=H, json={"items": [
        {"phone": "+201000000001", "name": "سارة", "attributes": {"discount": 25}},
        {"phone": "+201000000002", "name": "خالد", "attributes": {"discount": 10}}]})
    assert r.json()["added"] == 2
    ids = [c["id"] for c in client.get("/api/v1/contacts").json()]

    # 3) حملة فورية (draft -> messages queued)
    r = client.post("/api/v1/campaigns", headers=H, json={
        "name": "Promo June", "template_id": tpl_id, "contact_ids": ids})
    cid = r.json()["id"]
    assert r.json()["messages_queued"] == 2

    # 4) بدء الإرسال عبر الطابور + Rate limiter
    r = client.post(f"/api/v1/campaigns/{cid}/start", headers=H)
    assert r.status_code == 200
    for _ in range(100):
        d = client.get(f"/api/v1/campaigns/{cid}").json()
        if d["status"] == "completed":
            break
        time.sleep(0.1)
    assert d["status"] == "completed", d
    assert d["sent"] + d["failed"] == 2
    ok_msg = [m for m in d["messages"] if m["status"] == "sent"]
    assert ok_msg, d

    # 5) Webhook DLR يحدّث الحالة إلى delivered
    wa_id = ok_msg[0]["wa_id"]
    payload = {"entry": [{"changes": [{"value": {"statuses": [
        {"id": wa_id, "status": "delivered", "recipient_id": "201000000001"}]}}]}]}
    r = client.post("/webhooks/whatsapp", json=payload)
    assert r.json()["dlr"] == 1
    detail = client.get(f"/api/v1/campaigns/{cid}").json()
    assert any(m["status"] == "delivered" for m in detail["messages"])

    # 6) رد وارد → Inbox + Opt-out تلقائي بكلمة stop
    payload = {"entry": [{"changes": [{"value": {"messages": [
        {"from": "201000000001", "id": "wamid.R1", "text": {"body": "stop"}}]}}]}]}
    r = client.post("/webhooks/whatsapp", json=payload)
    assert r.json()["received"] == 1
    inbox = client.get("/api/v1/inbox").json()
    assert any(i["text"] == "stop" for i in inbox)
    sara = [c for c in client.get("/api/v1/contacts").json()
            if c["phone"] == "+201000000001"][0]
    assert sara["opted_out"] is True


def test_csv_import(client):
    csv_data = "phone,name,discount\n+201000000009,منى,30\nbad,xx,1\n"
    r = client.post("/api/v1/contacts/import-csv", headers=H,
                    files={"file": ("c.csv", csv_data.encode())})
    body = r.json()
    assert body["created"] == 1 and body["skipped_invalid"] == 1


def test_auth_required(client):
    assert client.post("/api/v1/campaigns", json={}).status_code == 401


def test_webhook_verify(client):
    r = client.get("/webhooks/whatsapp?mode=subscribe&challenge=abc123"
                   "&token=change-me-verify-token")
    assert r.text.strip('"') == "abc123"
    bad = client.get("/webhooks/whatsapp?mode=subscribe&challenge=x&token=WRONG")
    assert bad.status_code == 403


def test_rate_limiter_unit():
    rl = TokenBucketRateLimiter(messages_per_minute=600, burst=3,
                                jitter_seconds=0, warmup_enabled=False)
    t0 = time.monotonic()
    for _ in range(5):
        rl.acquire()
    # تجاوز السعة (3) بواقع 10 رسائل/ثانية → انتظار حقيقي مطلوب
    assert time.monotonic() - t0 >= 0.05
