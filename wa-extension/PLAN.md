# WhatsApp Outreach — Chrome Extension (MV3) : خطة العمل

## القرار المعماري (وليه)
- **Chrome Extension MV3** يشتغل جوه `web.whatsapp.com` مباشرة → لا سيرفر، لا Evolution API، لا Meta webhook. الإرسال يتم عبر واجهة واتساب ويب نفسها (DOM automation).
- **Anti-Ban هو قلب المشروع**: Human-like typing + jitter عشوائي + warm-up تراكمي + حد يومي + dedup + opt-out + "مستكشف خطر" يوقف كل حاجة لو ظهرت بانر حظر أو captcha.
- **AI Agent اختياري** (OpenAI-compatible endpoint من المستخدم): تصنيف الردود (interested / not interested / question / opt-out)، صياغة ردود مقترحة، تحسين النصوص. المفاتيح تفضل في `chrome.storage.local` فقط ولا تغادر المتصفح إلا لـ api.openai.com.

## الوحدات
| وحدة | الملف | الوظيفة |
|---|---|---|
| Engine | `src/engine.js` | الطابور، الفترات، التسخين، Dedup، العداد اليومي، إيقاف طارئ |
| Safety | `src/safety.js` | كلمات Opt-out AR/EN، عتبات المخاطر، قرارات AI-guard |
| AI | `src/ai.js` | طبقة OpenAI-compatible قابلة للتبديل (بدون مفتاح = يعمل offline) |
| WA Adapter | `src/wa.js` | عزل كل ملامسة DOM: findChat/create/open/type/send/mark-unread |
| UI | `src/ui.js` | لوحة داخلية فوق واتساب ويب (RTL عربي، 5 تبويبات) |
| Watchdog | `src/watchdog.js` | مراقبة DOM للتحذيرات والرسائل الواردة وDLR ticks |
| Background | `src/background.js` | Service Worker: أيقونة، badge، حفظ الحالة، alarm يومي |
| Popup | `popup.html/js` | حالة سريعة + start/pause |
| Tests | `tests/*.test.js` | node:test على المنطق النقي (بدون DOM) |

## قواعد الأمان المطبقة (افتراضيات)
- الحد اليومي 80 رسالة، أقصى 25 لكل جلسة، فترة 45–120s بين الرسائل، تأخير كتابة 45–110ms/char.
- Warm-up: اليوم 1 = 20 رسالة كحد أقصى، ثم +20 يوميًا حتى السقف.
- Pause كل 10 رسائل لمدة 60–180s.
- Dedup window: 24h لنفس الرقم.
- Watchdog: أي نص تحذير في DOM (`not allowed`, `temporarily blocked`, `captcha`) → E-STOP فوري.

## المراحل
1. Scaffold + manifest + منطق نقي (safety/engine/wa) مع اختبارات node ✔
2. الواجهة اللوحة + popup + background ✔
3. watchdog حي (ردود، DLR، opt-out تلقائي من المحادثات) ✔
4. AI agent (classification + reply suggestion + guard) ✔
5. README بالعربي وطريقة التحميل unpacked + zip ✔
