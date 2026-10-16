import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# قاعدة بيانات اختبار منفصلة + إعدادات سريعة قبل استيراد التطبيق
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["PROVIDER"] = "mock"
os.environ["JITTER_SECONDS"] = "0"
os.environ["WARMUP_ENABLED"] = "false"
os.environ["MESSAGES_PER_MINUTE"] = "6000"
