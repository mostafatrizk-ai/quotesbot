/* ============================================================
   LinkedIn Contact Parser — قلب الإضافة (مستقل عن DOM قدر الإمكان)
   يستخرج: الاسم، العنوان، الشركة، الموقع، الصورة، الإيميل، الهاتف
   من أي HTML/نص لصفحة لينكدإن (Profile / Search / Connections / People Also Viewed)
   ============================================================ */
(function (global) {
  'use strict';

  // ---------- أنماط الاستخراج ----------
  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

  // الشاشات المخفية في أرقام لينكدإن مثل (555) 123-4567 أو +20 100 123 4567
  const PHONE_REGEXES = [
    /(?:\+|00)\d{1,4}[\s\-\.]?(?:\(\d{1,4}\)[\s\-\.]?)?(?:\d[\s\-\.]?){6,14}\d/g,
    /\(\d{3}\)[\s\-\.]?\d{3}[\s\-\.]?\d{4}/g,
    /\b\d{3}[-\.\s]\d{3}[-\.\s]\d{4}\b/g
  ];

  const BAD_EMAILS = /(example\.com|domain\.com|email\.com|yourdomain|test@|sentry|wixpress|@linkedin|dummy)/i;

  // كلمات مفتاحية تدل على نوع الرقم
  const PHONE_LABELS = {
    mobile: /mobile|cell|phone:|موبايل|جوال|محمول/i,
    home: /home|personal|منزل|شخصي/i,
    work: /work|business|office|عمل|شغل/i
  };

  function normalizePhone(raw) {
    if (!raw) return null;
    let p = raw.trim();
    // إزالة الزوائد في البداية والنهاية
    p = p.replace(/[^\d+\-().\s]/g, '');
    const digits = p.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return p.replace(/\s+/g, ' ');
  }

  function extractEmails(text) {
    if (!text) return [];
    const found = text.match(EMAIL_REGEX) || [];
    const uniq = [...new Set(found.map(e => e.toLowerCase().replace(/\.$/, '')))];
    return uniq.filter(e => !BAD_EMAILS.test(e));
  }

  function extractPhones(text) {
    if (!text) return [];
    const results = new Set();
    for (const re of PHONE_REGEXES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const norm = normalizePhone(m[0]);
        if (norm) results.add(norm);
      }
    }
    // إزالة الأرقام الفرعية: أي رقم هو جزء من رقم أطول موجود بالفعل
    const all = [...results];
    const finalSet = all.filter(p => {
      const d = p.replace(/\D/g, '');
      return !all.some(other => {
        if (other === p) return false;
        const od = other.replace(/\D/g, '');
        return od.length > d.length && od.includes(d);
      });
    });
    return finalSet;
  }

  // تصنيف رقم حسب النص المحيط
  function classifyPhone(fullText, phone) {
    const idx = fullText.indexOf(phone);
    const ctx = idx >= 0 ? fullText.slice(Math.max(0, idx - 60), idx) : '';
    if (PHONE_LABELS.mobile.test(ctx)) return 'Mobile';
    if (PHONE_LABELS.home.test(ctx)) return 'Home';
    if (PHONE_LABELS.work.test(ctx)) return 'Work';
    return 'Phone';
  }

  // ---------- استخراج بيانات ملف شخصي من الصفحة كاملة ----------
  function parseProfileDocument(doc) {
    const out = { emails: [], phones: [], raw: {} };

    // 1) اسم الشخص من الـ meta tags أولاً (الأدق)
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    out.fullName = ogTitle
      ? ogTitle.content.split('·')[0].trim()
      : (doc.querySelector('h1')?.textContent || '').trim();

    const ogImg = doc.querySelector('meta[property="og:image"]');
    out.photoUrl = ogImg ? ogImg.content : (doc.querySelector('img.profile-photo__image')?.src || null);

    const ogDesc = doc.querySelector('meta[property="og:description"]');
    out.headline = ogDesc ? ogDesc.content.split('·')[0].trim() : '';

    // 2) المنطقة العامة Public Profile Section — أغنى مصدر للإيميلات والأرقام
    const sections = doc.querySelectorAll('.public-profile__section, section.artdecl-card, li.pv-contact-info__list-item');
    let contactText = '';
    sections.forEach(s => { contactText += '\n' + s.textContent; });

    // قسم التواصل تحديداً
    const contactSec = doc.querySelector('.pv-contact-info, #contact, .pv-text-details__left-panel');
    if (contactSec) contactText += '\n' + contactSec.textContent;

    // 3) الـ data id الخاص بالبروفايل
    const canonical = doc.querySelector('link[rel="canonical"]');
    if (canonical && canonical.href.includes('/in/')) {
      out.profileUrl = canonical.href.split('?')[0];
      out.linkedinId = out.profileUrl.split('/in/')[1]?.split('/')[0] || null;
    }

    // 4) استخراج الإيميلات والأرقام من كامل نص الصفحة (أشمل طريقة)
    const bodyText = doc.body ? doc.body.innerText : doc.textContent;
    const pool = contactText + '\n' + bodyText;

    out.emails = extractEmails(pool);
    const phonesRaw = extractPhones(pool);
    out.phones = phonesRaw.map(p => ({ number: p, type: classifyPhone(pool, p) }));

    // استبعاد الأرقام التي هي جزء من إيميل أو تواريخ
    out.phones = out.phones.filter(p => !/^\+?1?-?\d{8}$/.test(p.number) || p.number.length > 9);

    // 5) معلومات إضافية
    const companyEl = doc.querySelector('.current-position__text a, [data-section="experience"] a.ember-view');
    out.currentCompany = companyEl ? companyEl.textContent.trim() : '';
    const locEl = doc.querySelector('.text-body-small-semantic-tweak, .pv-top-card-profile-picture__form + div');
    out.location = (doc.querySelector('[class*="topcard__anti-text"], .display-flex')?.textContent || '').match(/([A-Z][a-zA-Z]+,\s*[A-Z][a-zA-Z]+.*)$/)?.[1] || '';

    return out;
  }

  // ---------- استخراج قائمة أشخاص من صفحة بحث/شبكات ----------
  // يعمل مع: /search/people, /in/xxx/connections, People Also Viewed
  function parsePeopleList(doc) {
    const people = [];
    const seen = new Set();

    // كل بطاقات النتائج المحتملة في واجهات لينكدإن المختلفة
    const selectors = [
      'li.researcher-result',                       // بحث كلاسيك
      'div[data-chameleon-result-urn]',             // بحث حديث
      'li.search-results__list-item',
      '.reusable-text',                             // connections grid
      'li.pv-invitee-item',                         // دعوات
      '.facepile-with-links_list--item',            // people also viewed sidebar
      'div.pvs-card-inner-container',
      'li[class*="result"]'
    ];

    for (const sel of selectors) {
      doc.querySelectorAll(sel).forEach(card => {
        const link = card.querySelector('a[href*="/in/"]');
        if (!link) return;
        const href = link.href.split('?')[0].split('#')[0];
        if (seen.has(href)) return;
        seen.add(href);

        const nameEl = card.querySelector('span[aria-labelledby], .entity-result__title-text, a[href*="/in/"]');
        let name = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
        name = name.split('LinkedIn')[0].trim();

        const headlineEl = card.querySelector('.entity-result__primary-subtitle, .t-14.t-black.t-normal, p.t-14');
        const locationEl = card.querySelector('.entity-result__secondary-subtitle, p.t-14.t-black--light');

        const img = card.querySelector('img');
        people.push({
          fullName: name,
          profileUrl: href,
          linkedinId: (href.split('/in/')[1] || '').split('/')[0] || null,
          headline: headlineEl ? headlineEl.textContent.trim() : '',
          location: locationEl ? locationEl.textContent.trim() : '',
          photoUrl: img ? img.src : null,
          emails: [],
          phones: []
        });
      });
      if (people.length) break; // أول selector يطابق نتائج يكفينا
    }
    return people;
  }

  // ---------- استخراج من JSON مخفي داخل الصفحة (data-li-shim-rehydration etc.) ----------
  function parseEmbeddedJson(doc) {
    const results = [];
    const scripts = doc.querySelectorAll('script[type="application/json"], script[id^="data-li"]');
    scripts.forEach(sc => {
      try {
        const data = JSON.parse(sc.textContent);
        const str = JSON.stringify(data);
        // البحث عن entities فيها profiles
        const urnMatches = str.match(/"firstName":"([^"]*)"[^}]*?"lastName":"([^"]*)"/g);
        if (urnMatches) {
          const emails = extractEmails(str);
          if (emails.length) results.push({ emails });
        }
      } catch (e) { /* تجاهل */ }
    });
    return results;
  }

  // ---------- تنظيف اسم شخص ----------
  function cleanName(raw) {
    if (!raw) return '';
    return raw
      .replace(/View .*profile/i, '')
      .replace(/LinkedIn.*$/, '')
      .replace(/Message\b.*$/, '')
      .replace(/Connect\b.*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  global.LI_Parser = {
    EMAIL_REGEX, PHONE_REGEXES,
    normalizePhone,
    extractEmails,
    extractPhones,
    classifyPhone,
    parseProfileDocument,
    parsePeopleList,
    parseEmbeddedJson,
    cleanName
  };
})(typeof window !== 'undefined' ? window : globalThis);
