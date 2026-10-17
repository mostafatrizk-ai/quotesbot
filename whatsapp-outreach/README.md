# 📡 WhatsApp Outreach System

نظام واتساب أوت ريتش كامل ومتطور — مبني وفق خطة `PLAN.md` بمهارات ومكتبات معتمدة من GitHub:
FastAPI (tiangolo/fastapi) · SQLAlchemy 2 (sqlalchemy/sqlalchemy) · Jinja2 (pallets/jinja) ·
httpx (encode/httpx) · Tenacity (jd/tenacity) · APScheduler (agronholm/apscheduler) ·
WhatsApp Cloud API (Meta/facebook) · Baileys (WhiskeySockets/Baileys) · pytest (pytest-dev/pytest).

## ✨ المزايا
- **إرسال جماعي ذكي** عبر طابور داخلي (قابل للتبديل إلى Celery+Redis)
- **Anti-Ban**: Token-bucket rate limiting + Jitter عشوائي + Warm-up تدريجي + Retry/backoff (Tenacity)
- **قوالب ديناميكية** بصيغة Jinja2: `مرحبا {{name}}! خصم {{discount}}%` مع Preview واستخراج المتغيرات
- **استيراد CSV** لجهات الاتصال مع تنظيف الأرقام دوليًا (E.164) وحقول تخصيص إضافية
- **جدولة الحملات** (APScheduler): بدء فوري / مجدولة / إيقاف مؤقت / استئناف
- **Webhooks رسمية**: تقارير DLR (sent/delivered/read/failed) + استقبال الردود في Inbox
- **Opt-out تلقائي** عند إرسال كلمة `stop` / `إيقاف` + قائمة منع永不 إرسال لهم
- **لوحة تحكم Admin** عربية RTL على `/` مع إحصائيات لحظية
- **REST API** موثّق تلقائيًا على `/docs` — محمي بمفتاح `X-API-Key`
- **مزودون قابلون للتبديل**: `mock` (تجربة)، `cloud_api` (Meta رسمي)، `baileys` (عبر Node sidecar)

## 🚀 التشغيل
```bash
pip install -r requirements.txt
cp .env.example .env        # عدّل المفاتيح
python run.py               # http://localhost:8000  (Admin) | /docs (API)
```
أو Docker:
```bash
docker compose up --build
```

## 🔒 وضع الإنتاج
1. اضبط `PROVIDER=cloud_api` مع `WA_CLOUD_TOKEN` و `WA_CLOUD_PHONE_NUMBER_ID`.
2. عيّن `WEBHOOK_VERIFY_TOKEN` وسجّل رابط `https://your-domain/webhooks/whatsapp` في Meta App.
3. غيّر `API_KEY` وقاعدة البيانات إلى Postgres عبر `DATABASE_URL`.
4. التزم بسياسات Meta: رسائل قالب معتمدة + فترة نافذة 24 ساعة للردود.

## 🧪 الاختبارات
```bash
python -m pytest -q   # 8 اختبارات تغطي التدفق الكامل
```

## 📖 أهم الـ Endpoints
| Method | Path | الوظيفة |
|---|---|---|
| POST | /api/v1/templates | إنشاء قالب (+ /preview) |
| POST | /api/v1/contacts, /bulk, /import-csv | إدارة جهات الاتصال |
| POST | /api/v1/campaigns | إنشاء حملة فورية أو مجدولة |
| POST | /api/v1/campaigns/{id}/start·pause | التحكم بالإرسال |
| GET | /api/v1/campaigns/{id} | تتبيل كل رسالة وحالتها |
| GET/POST | /webhooks/whatsapp | تحقق Meta + DLR/ردود |
| GET | /api/v1/inbox · /stats | الردود والإحصائيات |

## 🚀 النشر (Deploy) على Manus / Render
1. ارفع هذا المجلد على GitHub (فرع `main`).
2. في Manus: اطلب نشر المشروع — Manus ينشر تلقائيًا عبر **Render** ويقرأ ملف `render.yaml` الموجود هنا (Docker + فحص صحة `/health`).
   - أو مباشرة من Render: New Web Service → Connect repo → Runtime: Docker.
3. المتغيرات المهمة: `API_KEY`, `WEBHOOK_VERIFY_TOKEN`, `PROVIDER`, `WA_CLOUD_TOKEN`, `WA_CLOUD_PHONE_NUMBER_ID`.
4. لتخزين دائم: أضف Persistent Disk بمسار `/data` (أو اشترك في Postgres وحدّث `DATABASE_URL`).
5. بعد النشر: لوحة الأدمن على `https://<your-app>.onrender.com/` والـ API docs على `/docs`.
> ملاحظة: وضع `baileys` لا يعمل على استضافة بدون Node sidecar؛ استخدم `cloud_api` للإنتاج.

## 🛡️ طبقة الحماية من الحظر (Anti-Ban Guard) — v2
وحدة جديدة `app/services/safety.py` موصولة بمحرك الإرسال وWebhooks:
- **حد يومي** لإجمالي الرسائل (`MAX_DAILY_MESSAGES=500`) — عند بلوغه تُعاد جدولة الرسائل تلقائيًا لليوم التالي
- **Deduplication**: منع إرسال رقم لنفس الجهة خلال `DEDUP_WINDOW_SECONDS=3600` (يحمي من تداخل حملتين)
- **Opt-out موسّع**: stop / optout / unsubscribe / إيقاف / إلغاء / قفي / خروج — عربي وإنجليزي، مع تطابق بداية الجملة ("stop now")
- **حالة الحارس ظاهرة في `/health`**: `{"guard": {"sent_today": 42, "daily_cap": 500, ...}}`
