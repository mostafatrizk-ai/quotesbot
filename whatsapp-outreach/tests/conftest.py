import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# قاعدة بيانات اختبار منفصلة + إعدادات سريعة قبل استيراد التطبيق
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["PROVIDER"] = "mock"
os.environ["JITTER_SECONDS"] = "0"
os.environ["WARMUP_ENABLED"] = "false"
os.environ["MESSAGES_PER_MINUTE"] = "6000"

import pytest
from fastapi.testclient import TestClient

@pytest.fixture(scope="session")
def client():
    from app.main import app
    from app.db.session import init_db
    init_db()
    with TestClient(app) as c:
        yield c

@pytest.fixture()
def db_session():
    from app.db.session import SessionLocal
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()
