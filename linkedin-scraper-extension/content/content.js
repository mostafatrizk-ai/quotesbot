/* ============================================================
   Content Script — يتحكم في وضع السكراب داخل صفحات لينكدإن
   يدعم: Profile فردي / نتائج بحث / Connections / People Also Viewed
   ============================================================ */
(function () {
  'use strict';

  const P = window.LI_Parser;
  let state = {
    running: false,
    mode: null,          // 'single' | 'list'
    queue: [],           // روابط البروفيلات المراد زيارتها
    results: [],         // تجميع البيانات
    settings: defaultSettings(),
    currentTabId: null
  };

  function defaultSettings() {
    return {
      delayMin: 2500,
      delayMax: 6000,
      maxProfiles: 100,
      autoScroll: true,
      openContactView: true,   // فتح نافذة Contact info لاستخراج الإيميل المخفي
      alsoPeopleViewed: true   // استخراج قائمة "People also viewed" من السايدبار
    };
  }

  // ---------- رسائل من البوب أب / الباك جراوند ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.action) {
      case 'START':
        chrome.storage.local.get(['liSettings'], (r) => {
          state.settings = Object.assign(defaultSettings(), r.liSettings || {});
          // وضع "الصفحة الحالية": استخراج فوري شامل بدون تنقل
          if (msg.mode === 'page') {
            state.running = true;
            state.mode = 'page';
            scrapePageWide().then(() => {
              state.running = false;
              sendResponse({ ok: true });
            });
            return;
          }
          start(msg.mode);
          sendResponse({ ok: true });
        });
        return true;

      case 'STOP':
        stop();
        sendResponse({ ok: true });
        break;

      case 'PING':
        sendResponse({ running: state.running, mode: state.mode, done: state.results.length });
        break;

      case 'GET_RESULTS':
        sendResponse({ results: state.results });
        break;

      case 'CLEAR_RESULTS':
        state.results = [];
        persistResults();
        sendResponse({ ok: true });
        break;

      case 'SCRAPE_NOW':
        // الباك جراوند طلب استخراج فوري بعد تحميل صفحة بروفايل جديدة
        chrome.storage.local.get(['liSettings', 'liScrapeResults'], (r) => {
          state.settings = Object.assign(defaultSettings(), r.liSettings || {});
          state.running = true;
          state.results = r.liScrapeResults || [];
          scrapeCurrentPage().then(() => sendResponse({ ok: true }));
        });
        return true;
    }
  });

  function notifyPopup(event, data) {
    chrome.runtime.sendMessage({ event, data }, () => void chrome.runtime.lastError);
  }

  // ---------- بدء السكرب ----------
  async function start(mode) {
    if (state.running) return;
    state.running = true;
    state.mode = mode;
    state.results = [];

    const url = location.href;

    if (/\/search\/people/.test(url) || /\/in\/[^/]+\/connections/.test(url)) {
      // صفحة قائمة: نجمع كل الروابط ثم نزور واحداً واحداً
      await collectListAndQueue();
    } else if (/\/in\/[^/?#]+/.test(url)) {
      // بروفايل واحد فقط
      state.queue = [url];
      processNext();
    } else if (/\/(pub|company)\//.test(url)) {
      scrapeCurrentPage();
    } else {
      // أي صفحة لينكدإن أخرى: نجرب نستخرج اللي بنلقاه
      await collectListAndQueue();
    }
  }

  function stop() {
    state.running = false;
    state.queue = [];
    chrome.storage.local.set({ liSession: { running: false } });
    notifyPopup('stopped');
    updateOverlay('⏹ تم الإيقاف');
  }

  // ---------- وضع "الصفحة الحالية": استخراج شامل بدون تنقل ----------
  // ياخد كل اللي في الصفحة: بروفايل مفتوح + أي قوائم أشخاص + نص الصفحة كاملاً (إيميلات/أرقام)
  async function scrapePageWide() {
    updateOverlay('📄 جاري استخراج كل البيانات الظاهرة في الصفحة...');
    await sleep(500);

    const bodyText = document.body ? document.body.innerText : '';
    const pageEmails = P.extractEmails(bodyText);
    const pagePhones = P.extractPhones(bodyText).map(p => ({ number: p, type: P.classifyPhone(bodyText, p), complete: true }));
    // الأرقام المقنعة جزئياً في نص الصفحة
    const pageMasked = P.extractMaskedPhones(bodyText)
      .filter(mp => !pagePhones.some(p => p.number.replace(/\D/g, '').includes(mp.visibleDigits)))
      .map(mp => ({ number: mp.number, type: 'Phone', complete: false }));
    for (const mp of pageMasked) pagePhones.push(mp);

    let record = null;
    if (/\/in\/[^/?#]+/.test(location.pathname)) {
      // صفحة بروفايل — استخدم المحرك الكامل
      tryRevealContactInfo();
      await sleep(1500);
      const data = P.parseProfileDocument(document);
      record = makeRecord(data, {});
    } else {
      // صفحة قائمة/بيت — سجل الصفحة نفسها كسجل واحد بكل ما فيها
      record = {
        fullName: (document.querySelector('h1')?.textContent || '').trim(),
        headline: '',
        location: '',
        currentCompany: '',
        profileUrl: location.href.split('?')[0],
        linkedinId: '',
        photoUrl: '',
        emails: pageEmails,
        phones: pagePhones,
        peopleFound: P.parsePeopleList(document).length,
        scrapedAt: new Date().toISOString()
      };
    }

    // دمج أي إيميلات/أرقام إضافية ظهرت في نص الصفحة مع بيانات البروفايل
    const emailSet = new Set([...(record.emails || []), ...pageEmails]);
    record.emails = [...emailSet];
    const phoneSeen = new Set((record.phones || []).map(p => p.number));
    for (const ph of pagePhones) if (!phoneSeen.has(ph.number)) record.phones.push(ph);

    state.results = [record];
    persistResults();
    notifyPopup('profile-done', record);
    updateOverlay(`✅ من هذه الصفحة: ${record.emails.length} إيميل، ${record.phones.length} رقم`);
    notifyPopup('finished', { total: 1 });
  }

  function makeRecord(data, meta) {
    return {
      fullName: clean(data.fullName) || (meta && meta.fullName) || '',
      headline: clean(data.headline) || (meta && meta.headline) || '',
      location: data.location || (meta && meta.location) || '',
      currentCompany: data.currentCompany || '',
      profileUrl: data.profileUrl || location.href.split('?')[0],
      linkedinId: data.linkedinId || (meta && meta.linkedinId) || '',
      photoUrl: data.photoUrl || (meta && meta.photoUrl) || '',
      emails: data.emails,
      phones: data.phones,
      authWall: !!data.authWall,
      scrapedAt: new Date().toISOString()
    };
  }

  // ---------- جمع قائمة الأشخاص من الصفحة الحالية + التمرير اللانهائي ----------
  async function collectListAndQueue() {
    updateOverlay('🔍 جاري جمع روابط الملفات...');
    const map = new Map();

    const grab = () => {
      P.parsePeopleList(document).forEach(p => {
        if (p.profileUrl && !map.has(p.profileUrl)) map.set(p.profileUrl, p);
      });
    };

    grab();

    if (state.settings.autoScroll) {
      // تمرير تدريجي لتحميل نتائج إضافية (LinkedIn يحمّل lazy)
      let stableRounds = 0;
      let lastCount = map.size;
      for (let i = 0; i < 40 && map.size < state.settings.maxProfiles; i++) {
        if (!state.running) return;
        window.scrollBy({ top: window.innerHeight * 1.5, behavior: 'smooth' });
        await sleep(1800);
        grab();
        if (map.size === lastCount) stableRounds++; else stableRounds = 0;
        lastCount = map.size;
        if (stableRounds >= 4) break; // وصلت آخر الصفحة
      }
    }

    state.queue = [...map.values()].slice(0, state.settings.maxProfiles).map(p => p.profileUrl);
    state.listMeta = [...map.values()];
    // حفظ الجلسة فوراً حتى يعرف الـ background/content أنه شغال بعد أول navigation
    chrome.storage.local.set({ liSession: { running: true, listMeta: state.listMeta } });
    notifyPopup('queued', { count: state.queue.length });
    updateOverlay(`📋 تم رصد ${state.queue.length} ملف — بدء الزيارة...`);
    processNext();
  }

  // ---------- زيارة البروفيلات واحداً تلو الآخر ----------
  async function processNext() {
    if (!state.running) return;
    if (!state.queue.length) {
      finish();
      return;
    }

    const nextUrl = state.queue[0];

    // إذا كنا بالفعل على نفس الصفحة → استخرج هنا
    if (location.href.split('?')[0] === nextUrl.split('?')[0]) {
      await scrapeCurrentPage();
      state.queue.shift();
      // العودة للصفحة السابقة ثم التالي (نمط back-forward navigation مثل SignalHire)
      navigateToNextViaHistory();
      return;
    }

    // التنقل إلى الرابط التالي — الـ background سيعيد حقننا بعد التحميل
    notifyPopup('navigating', { url: nextUrl, remaining: state.queue.length });
    updateOverlay(`➡️ الانتقال لملف جديد (${state.results.length}/${state.settings.maxProfiles})...`);
    chrome.runtime.sendMessage({ action: 'NAVIGATE', url: nextUrl }, () => {
      location.href = nextUrl; // fallback
    });
  }

  async function navigateToNextViaHistory() {
    if (!state.running) return;
    if (!state.queue.length) { finish(); return; }
    const nextUrl = state.queue[0];
    updateOverlay(`➡️ الانتقال للتالي... متبقي ${state.queue.length}`);
    await sleep(rand(state.settings.delayMin, state.settings.delayMax));
    location.href = nextUrl;
  }

  // ---------- استخراج بيانات الصفحة الحالية ----------
  async function scrapeCurrentPage() {
    if (!state.running) return;
    updateOverlay('⏳ قراءة الملف الشخصي...');

    // LinkedIn SPA — يستحسن ننتظر ظهور عناصر البروفايل قبل التحليل
    await waitForProfile();

    // محاولة فتح نافذة Contact Info (هناك يظهر الإيميل الشخصي غالباً)
    if (state.settings.openContactView) {
      tryRevealContactInfo();
      await sleep(1500);
    } else {
      await sleep(800); // مهلة بسيطة حتى يتريتم المحتوى المتأخر
    }

    const data = P.parseProfileDocument(document);

    // دمج مع بيانات القائمة إن وجدت (name/headline/location)
    const meta = (state.listMeta || []).find(m => m.profileUrl === location.href.split('?')[0]);
    const record = makeRecord(data, meta || {});

    if (record.authWall && !record.emails.length && !record.phones.length) {
      updateOverlay(`🚫 ${record.profileUrl}: LinkedIn Auth Wall — تخطي هذا الملف`);
      notifyPopup('authwall', { url: record.profileUrl });
    }

    state.results.push(record);
    persistResults();
    notifyPopup('profile-done', record);
    updateOverlay(`✅ ${record.fullName}: ${record.emails.length} إيميل، ${record.phones.length} رقم`);

    // استخراج "People also viewed" كروابط إضافية للطابور
    if (state.settings.alsoPeopleViewed) {
      P.parsePeopleList(document).forEach(p => {
        if (p.profileUrl && p.profileUrl !== record.profileUrl &&
            !state.queue.includes(p.profileUrl) &&
            !state.results.some(r => r.profileUrl === p.profileUrl)) {
          if (state.queue.length + state.results.length < state.settings.maxProfiles) {
            state.queue.push(p.profileUrl);
          }
        }
      });
    }

    state.queue.shift();
    await sleep(rand(state.settings.delayMin, state.settings.delayMax));
    navigateToNextViaHistory();
  }

  // ---------- كشف معلومات الاتصال المختفية ----------
  // يفتح Contact info modal + يضغط Show all + يحاول إظهار أي عناصر مخفية CSS/ARIA
  function tryRevealContactInfo() {
    const clickIfFound = (els, re) => {
      for (const el of els) {
        if (re.test((el.textContent || '').trim())) { el.click(); return true; }
      }
      return false;
    };

    const links = [...document.querySelectorAll('a, button')];
    // 1) فتح نافذة Contact Info (يظهر فيها الإيميل الشخصي غالباً)
    clickIfFound(links, /^(contact info|معلومات الاتصال|عرض معلومات الاتصال)/i) ||
      links.find(el => /contact\s*info/i.test(el.textContent))?.click();

    setTimeout(() => {
      // 2) زر "Show all / عرض الكل" لإظهار كل الأرقام والإيميلات المختصرة
      const modal = document.querySelector('.artdeco-modal, .pv-contact-info');
      if (modal) {
        clickIfFound([...modal.querySelectorAll('button, a')], /show all|view all|عرض الكل/i);
      }
      // 3) فك إخفاء أي عنصر محتجب بـ aria-hidden أو display:none داخل أقسام التواصل
      const contactAreas = document.querySelectorAll('.pv-contact-info, #contact, [data-section="Contact"], section.artdecl-card');
      contactAreas.forEach(area => {
        area.querySelectorAll('[aria-hidden="true"], .visually-hidden, [style*="display: none"]').forEach(h => {
          h.removeAttribute('aria-hidden');
          h.classList.remove('visually-hidden');
          h.style.display = '';
        });
      });
    }, 700);

    // 4) تمرير خفيف لأقسام التواصل — لينكدإن يرندر محتواها عند الظهور (lazy render)
    const contactSection = document.querySelector('#contact, .pv-contact-info, [data-section="Contact"]');
    if (contactSection) {
      try { contactSection.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
    }
  }

  // ---------- انتظار ظهور بيانات البروفايل (SPA lazy render) ----------
  async function waitForProfile(maxMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const ready = document.querySelector('h1') ||
                    document.querySelector('meta[property="og:title"]') ||
                    document.querySelector('[class*="topcard"]') ||
                    document.querySelector('.pv-top-card');
      if (ready) return true;
      await sleep(500);
    }
    return false;
  }

  function finish() {
    state.running = false;
    notifyPopup('finished', { total: state.results.length });
    updateOverlay(`🎉 انتهى! تم جمع ${state.results.length} ملف`);
    setTimeout(hideOverlay, 5000);
  }

  function persistResults() {
    chrome.storage.local.set({ liScrapeResults: state.results.slice(-2000) });
  }

  // ---------- Overlay للمتابعة البصرية ----------
  let overlayEl = null;
  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'li-scraper-overlay';
    document.documentElement.appendChild(overlayEl);
    return overlayEl;
  }
  function updateOverlay(text) {
    const el = ensureOverlay();
    el.textContent = text;
    el.style.display = 'block';
  }
  function hideOverlay() { if (overlayEl) overlayEl.style.display = 'none'; }

  // ---------- أدوات ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();

  // عند تحميل أي صفحة بروفايل أثناء تشغيل السكرب (بعد navigation) نستأنف تلقائياً
  chrome.storage.local.get(['liSession'], (r) => {
    if (r.liSession && r.liSession.running && /\/in\/[^/?#]+$/.test(location.pathname)) {
      state.running = true;
      state.settings = Object.assign(defaultSettings(), r.liSettings || {});
      state.queue = [location.href.split('?')[0]];
      state.results = r.liScrapeResults || [];
      state.listMeta = r.liSession.listMeta || [];
      scrapeCurrentPage();
    }
  });

  // حفظ حالة الجلسة ليتم استئنافها بعد كل transition
  const origNotify = notifyPopup;
  notifyPopup = function (event, data) {
    if (event === 'navigating' || event === 'profile-done' || event === 'queued') {
      chrome.storage.local.set({
        liSession: { running: state.running, listMeta: state.listMeta || [] }
      });
    }
    if (event === 'finished' || event === 'stopped') {
      chrome.storage.local.set({ liSession: { running: false } });
    }
    origNotify(event, data);
  };
})();
