# WhatsApp Outreach System — خطة العمل (Planning)

## 1. الهدف
بناء نظام واتساب أوت ريتش كامل ومتطور: إرسال جماعي ذكي، قوالب رسايل،
تخصيص ديناميكي، جدولة، طوابير، Rate Limiting، DLR (تقارير التوصيل)،
Inbox للردود، Anti-Ban، Webhooks، REST API، ولوحة تحكم Admin.

## 2. الـ Skills المضافة من GitHub (مصادر ومكتبات معتمدة)
| المهارة | المصدر (GitHub) | الاستخدام |
|---|---|---|
| WhatsApp Cloud API | facebook/facebook (Graph API docs) | Provider رسمي أساسي |
| Baileys (Unofficial WA) | WhiskeySockets/Baileys | Provider بديل للواتساب ويب |
| wppconnect/wa-js | wppconnect-team/wa-js | Automation عبر المتصفح |
| FastAPI + Pydantic v2 | tiangolo/fastapi, pydantic/pydantic | REST API والتحقق |
| Celery + Redis | celery/celery, redis/redis-py | الطوابير والجدولة |
| SQLAlchemy 2.0 async | sqlalchemy/sqlalchemy ORM | قاعدة البيانات |
| APScheduler | agronholm/apscheduler | جدولة الحملات |
| httpx | encode/httpx | HTTP client للـ webhooks |
| Tenacity | jd/tenacity | Retry/backoff مضاد للحظر |
| Jinja2 | pallets/jinja | محرك قوالب الرسايل {{name}} |
| RateLimiter | bandwith-io/ratelimit | Throttle ذكي لمنع الحظر |
| pytest | pytest-dev/pytest | الاختبارات |
| Docker Compose | docker | النشر |

## 3. المعمارية
```
clients -> FastAPI (/api/v1) -> Services -> [Queue: Celery/Redis] -> Workers
                                   |                                   |
                              SQLite/Postgres                    Providers (Cloud API / Baileys mock)
                                   |                                   |
                              Templates/Campaigns                 Webhooks (DLR/Replies) -> Inbox
```

## 4. الوحدات (Modules)
1. `core/` — الإعدادات، الأمان، log
2. `db/` — النماذج: Contact, Campaign, Message, Template, WebhookEvent, InboxMessage
3. `providers/` — واجهة موحدة + CloudApiProvider + BaileysProvider (mockable)
4. `templating/` — Jinja2 مع fallback
5. `rate_limiter/` — Token bucket + jitter + warm-up
6. `queue/` — Celery (اختياري) + In-process dispatcher
7. `services/` — campaigns, contacts (CSV import), scheduler, dlr, inbox
8. `api/` — REST endpoints كاملة
9. `admin/` — لوحة تحكم HTML بسيطة
10. `tests/` — pytest

## 5. مراحل التنفيذ
- [x] المرحلة 0: البنية والإعدادات
- [x] المرحلة 1: DB models + repositories
- [x] المرحلة 2: Providers + Rate limiting + Anti-ban
- [x] المرحلة 3: القوالب والتخصيص + استيراد CSV
- [x] المرحلة 4: الحملات + الجدولة + الإرسال
- [x] المرحلة 5: Webhooks/DLR + Inbox
- [x] المرحلة 6: Admin dashboard + توثيق + اختبارات
