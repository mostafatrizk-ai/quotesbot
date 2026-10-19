# 🔗 LinkedIn Contact Finder — كروم اكستنشن سكراب

إضافة كروم (Manifest V3) لاستخراج **أرقام التليفونات والإيميلات** من لينكدإن بنفس فكرة **SignalHire** و **ContactOut**، مع دعم التطوير الشامل: تجيب الداتا من **أي حتة** — رابط بروفايل واحد، صفحة بحث كاملة، Connections، أو حتى "People also viewed".

## ✨ المميزات

| الميزة | الوصف |
|---|---|
| 👤 ملف واحد | الصق رابط `linkedin.com/in/username` وهيopenه ويستخرج منه كل بيانات الاتصال |
| 🔄 وضع القائمة (Auto) | على صفحة بحث أو Connections — يمرّ على كل الملفات واحداً تلو الآخر تلقائياً مثل SignalHire Bulk |
| 📄 الصفحة الحالية | يستخرج كل الإيميلات/الأرقام الظاهرة في أي صفحة لينكدإن مفتوحة |
| 🕵️ كشف Contact Info | يفتح نافذة "Contact info" و "Show all" أوتوماتيك لاكتشاف الإيميل الشخصي والأرقام المخفية |
| ➕ People Also Viewed | يضيف اقتراحات السايدبار للطابور تلقائياً (توسع الشبكة) |
| 🖱️ Auto-Scroll | يمرحّل نتائج البحث اللانهائية (lazy load) بالكامل قبل البدء |
| 🛡️ Anti-Ban | فترات انتظار عشوائية قابلة للضبط + مهلة إضافية عشوائية في الـ background |
| 📊 تصدير CSV / Excel / JSON | بعمود لكل حاجة: الاسم، اللقب، الشركة، الموقع، الإيميلات، الأرقام ونوعها (Mobile/Home/Work)، الرابط، ID، الصورة |
| 💾 حفظ تلقائي | النتائج تتخزن في `chrome.storage` وتتجمع حتى لو قفلت البوب أب أثناء التشغيل |

## 📁 هيكل المشروع

```
linkedin-scraper-extension/
├── manifest.json              # Manifest V3
├── background/background.js   # إدارة التنقل بين البروفيلات + إعادة الحقن + التصدير
├── content/
│   ├── parser.js              # محرك الاستخراج (Regex للإيميلات/أرقام + تحليل DOM)
│   └── content.js             # منطق السكراب: طوابير، تمرير، تنقل، overlay حي
├── popup/                     # واجهة التحكم (3 تبويبات: سكراب/نتائج/إعدادات)
├── styles/content.css         # شكل الـ overlay داخل صفحات لينكدإن
├── libs/xlsx.full.min.js      # مكتبة SheetJS لتصدير Excel (محلية بدون إنترنت)
└── icons/                     # أيقونات 16/48/128
```

## 📥 التحميل من GitHub

**الطريقة A — ملف ZIP (بدون git):**
1. افتح صفحة الريبوزيتوري على GitHub.
2. اضغط زر **Code** الأخضر ← **Download ZIP**.
3. فك ضغط الملف → ستجد مجلد `linkedin-scraper-extension` جاهزاً للتحميل في كروم.

**الطريقة B — سطر الأوامر:**
```bash
git clone <رابط-الريبوزيتوري>.git
cd <اسم-الريبوزيتوري>/linkedin-scraper-extension
```

## 🚀 طريقة التشغيل

1. افتح `chrome://extensions`
2. فعّل **Developer mode** (أعلى اليمين)
3. اضغط **Load unpacked** واختر مجلد `linkedin-scraper-extension`
4. سجّل دخولك في [linkedin.com](https://www.linkedin.com)
5. **للبحث الشامل:** افتح صفحة نتائج بحث أو Connections → اضغط أيقونة الإضافة → **▶️ بدء الاستخراج**
   **لبروفايل بالتحديد:** الصق الرابط في خانة URL → **من رابط**
6. تابع التقدم من الـ overlay فوق الصفحة أو من تبويب **النتائج**، ثم صدّر CSV/Excel

## ⚙️ أهم الإعدادات

- **maxProfiles**: أقصى عدد ملفات في الجلسة (افتراضي 100)
- **delayMin/delayMax**: فترة الانتظار العشوائية بين الصفحات (لا تقللها كثيراً!)
- **فتح Contact Info**: ضروري لإظهار الإيميل الشخصي المختفي خلف الكواليس
- **People also viewed**: يحوّل كل بروفايل لنقطة انطلاق لبروفايلات جديدة

## ⚠️ إخلاء مسؤولية قانوني وأخلاقي

هذا المشروع **لأغراض تعليمية فقط**. استخدام سكربرات على لينكدإن:

1. **يخالف شروط استخدام LinkedIn** وقد يؤدي إلى تعليق/حظر حسابك نهائياً.
2. جمع بيانات شخصية (إيميلات/هواتف) دون موافقة قد يخالف قوانين الخصوصية مثل **GDPR** وقوانين حماية البيانات المحلية.
3. لا أتحمل أي مسؤولية عن أي استخدام خاطئ. استخدم بيانات عامة فقط، احصل على موافقة أصحاب البيانات، والتزم بقوانين بلدك.

البديل الرسمي الآمن: [LinkedIn Sales Navigator API](https://learn.microsoft.com/en-us/linkedin/) والشراكات المعتمدة (Clearbit, Apollo, etc.).

## 🧪 اختبارات سريعة

```bash
node --check content/parser.js && node --check content/content.js \
&& node --check background/background.js && node --check popup/popup.js
```

ومحرك الاستخراج قابل للاختبار مباشرة في Node:

```js
global.window = global;
require('./content/parser.js');
LI_Parser.extractEmails("contact: john@acme.com");     // ['john@acme.com']
LI_Parser.extractPhones("Mobile: +20 100 555 1234");   // ['+20 100 555 1234']
```
