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

    // محاولة فتح نافذة Contact Info (هناك يظهر الإيميل الشخصي غالباً)
    if (state.settings.openContactView) {
      tryRevealContactInfo();
      await sleep(1500);
    } else {
      await sleep(800); // مهلة بسيطة للانتظار حتى يت渲染
    }

    const data = P.parseProfileDocument(document);

    // دمج مع بيانات القائمة إن وجدت (name/headline/location)
    const meta = (state.listMeta || []).find(m => m.profileUrl === location.href.split('?')[0]);
    const record = {
      fullName: clean(data.fullName) || (meta && meta.fullName) || '',
      headline: clean(data.headline) || (meta && meta.headline) || '',
      location: data.location || (meta && meta.location) || '',
      currentCompany: data.currentCompany || '',
      profileUrl: data.profileUrl || location.href.split('?')[0],
      linkedinId: data.linkedinId || (meta && meta.linkedinId) || '',
      photoUrl: data.photoUrl || (meta && meta.photoUrl) || '',
      emails: data.emails,
      phones: data.phones,
      scrapedAt: new Date().toISOString()
    };

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
  function tryRevealContactInfo() {
    const showMore = document.querySelector('.pv-contact-info__contact-link, button:has-text("Contact info")');
    const links = [...document.querySelectorAll('a, button')];
    const contactLink = links.find(el => /contact\s*info/i.test(el.textContent));
    if (contactLink) contactLink.click();

    setTimeout(() => {
      // زر "Show all" لإظهار كل الأرقام والإيميلات
      const modal = document.querySelector('.artdeco-modal, .pv-contact-info');
      if (modal) {
        const showAll = [...modal.querySelectorAll('button')].find(b => /show all|عرض الكل/i.test(b.textContent));
        if (showAll) showAll.click();
      }
    }, 700);
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
