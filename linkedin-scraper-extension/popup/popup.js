/* ============================================================
   Popup Logic — التحكم، المتابعة الحية، العرض، التصدير
   ============================================================ */
(function () {
  'use strict';

  let activeTab = null;
  let results = [];
  let queueTotal = 0;

  const $ = (s) => document.querySelector(s);
  const statusBox = $('#status-box');
  const progress = $('#progress');
  const badge = $('#count-badge');

  // ---------- تبويبات ----------
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'results') renderResults();
    });
  });

  // ---------- تحميل التاب النشط ----------
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    activeTab = tabs[0];
    if (!activeTab.url || !/linkedin\.com/.test(activeTab.url)) {
      setStatus('⚠️ افتح صفحة لينكدإن الأول (يجب أن تكون مسجل دخولك)', 'warn');
    } else {
      setStatus('✅ متصل بـ: ' + shortUrl(activeTab.url), 'ok');
    }
    // استعادة النتائج المحفوظة
    chrome.storage.local.get(['liScrapeResults'], (r) => {
      results = r.liScrapeResults || [];
      updateBadge();
    });
    // معرفة هل السكراب شغال
    pingContent();
  });

  function pingContent() {
    if (!activeTab) return;
    chrome.tabs.sendMessage(activeTab.id, { action: 'PING' }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      if (res.running) setRunningUI(true, res.done);
    });
  }

  // ---------- بدء / إيقاف ----------
  $('#btn-start').addEventListener('click', () => {
    if (!activeTab || !/linkedin\.com/.test(activeTab.url || '')) {
      setStatus('⚠️ لازم تكون على صفحة linkedin.com أولاً', 'warn');
      return;
    }
    saveSettings(() => {
      chrome.runtime.sendMessage({ action: 'SET_TAB', tabId: activeTab.id });
      const mode = document.querySelector('input[name="mode"]:checked').value;
      // content يقرر المسار حسب الـ URL (auto/single) — وpage ياخد مسار الاستخراج الشامل الفوري
      const sendStart = () =>
        chrome.tabs.sendMessage(activeTab.id, { action: 'START', mode }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) {
            // الكوننت سكريبت مش محقون — حقنه يدوياً ثم ابدأ
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['content/parser.js', 'content/content.js']
            }, () => {
              chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: ['styles/content.css'] }, () => {
                chrome.tabs.sendMessage(activeTab.id, { action: 'START', mode });
              });
            });
          }
        });

      if (mode === 'page') {
        // استخراج لحظي من الصفحة الحالية بدون تنقل — لا يحتاج liSession
        sendStart();
        setStatus('📄 جاري استخراج بيانات الصفحة الحالية...', 'ok');
        setTimeout(() => { pingContent(); renderResults(); }, 4000);
        return;
      }

      chrome.storage.local.set({ liSession: { running: true, listMeta: [] } });
      sendStart();
      setRunningUI(true, 0);
      setStatus('🏁 بدأ الاستخراج... لا تغلق التاب', 'ok');
    });
  });

  $('#btn-stop').addEventListener('click', () => {
    if (activeTab) chrome.tabs.sendMessage(activeTab.id, { action: 'STOP' });
    chrome.storage.local.set({ liSession: { running: false } });
    setRunningUI(false, results.length);
    setStatus('⏹ تم الإيقاف', 'warn');
  });

  // ---------- استخراج من رابط ملصوق ----------
  $('#btn-scrape-url').addEventListener('click', () => {
    const raw = $('#profile-url').value.trim();
    // يقبل "username" أو رابط كامل أو رابط بـ query params
    const url = /^https?:\/\//.test(raw) ? raw : (/^[a-zA-Z0-9%_-]+$/.test(raw) ? `https://www.linkedin.com/in/${raw}/` : raw);
    if (!/https?:\/\/(www\.)?linkedin\.com\/in\//.test(url)) {
      setStatus('⚠️ الصق رابط بروفايل صحيح: linkedin.com/in/... أو اكتب اليوزرنيم فقط', 'warn');
      return;
    }
    saveSettings(() => {
      chrome.runtime.sendMessage({ action: 'SET_TAB', tabId: activeTab.id });
      chrome.storage.local.set({ liSession: { running: true, listMeta: [] } });
      chrome.tabs.update(activeTab.id, { url }, () => {
        setRunningUI(true, 0);
        setStatus('➡️ فتح الرابط... الـ background هيستخرج تلقائياً بعد التحميل', 'ok');
      });
    });
  });

  // ---------- رسائل حية من الكوننت سكريبت ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.event === 'queued') {
      queueTotal = msg.data.count;
      progress.max = queueTotal;
      setStatus(`📋 في الطابور ${queueTotal} ملف`, 'ok');
    }
    if (msg.event === 'navigating') {
      setStatus(`➡️ الانتقال لملف جديد... متبقي ${msg.data.remaining}`, 'info');
    }
    if (msg.event === 'profile-done') {
      results.push(msg.data);
      persist();
      progress.value = results.length;
      updateBadge();
      setStatus(`✅ ${msg.data.fullName}: ${msg.data.emails.length} إيميل، ${msg.data.phones.length} رقم`, 'ok');
    }
    if (msg.event === 'finished') {
      setRunningUI(false, results.length);
      setStatus(`🎉 اكتمل! عدد الملفات: ${msg.data.total}`, 'ok');
    }
    if (msg.event === 'authwall') {
      setStatus(`🚫 LinkedIn Auth Wall على: ${shortUrl(msg.data.url)} — جرّب تكبّر فترات الانتظار`, 'warn');
    }
    if (msg.event === 'stopped') {
      setRunningUI(false, results.length);
    }
  });

  function setRunningUI(running, done) {
    $('#btn-start').disabled = running;
    $('#btn-stop').disabled = !running;
    if (done != null && queueTotal) progress.value = done;
  }

  function setStatus(text, kind) {
    statusBox.textContent = text;
    statusBox.className = 'status ' + (kind || '');
  }

  function shortUrl(u) {
    return u.length > 60 ? u.slice(0, 57) + '...' : u;
  }

  // ---------- عرض النتائج ----------
  function renderResults() {
    const list = $('#results-list');
    if (!results.length) {
      list.innerHTML = '<p class="empty">لا توجد نتائج بعد</p>';
      return;
    }
    list.innerHTML = results.slice().reverse().map(r => `
      <div class="result-card">
        <div class="rc-head">
          ${r.photoUrl ? `<img src="${esc(r.photoUrl)}" alt="" />` : '<div class="avatar-fallback"></div>'}
          <div>
            <b>${esc(r.fullName) || '(بدون اسم)'}</b>
            <small>${esc(r.headline)}</small><br/>
            <a href="${esc(r.profileUrl)}" target="_blank" rel="noopener" class="li-link">LinkedIn</a>
            ${r.authWall ? '<span class="chip none">🚫 Auth Wall</span>' : ''}
          </div>
        </div>
        <div class="rc-contacts">
          ${(r.emails || []).map(e => `<span class="chip email">✉️ ${esc(e)}</span>`).join('')}
          ${(r.phones || []).map(p => `<span class="chip phone${p.complete === false ? ' masked' : ''}">📞 ${esc(p.number)} (${p.type}${p.complete === false ? ' — مخفي جزئياً' : ''})</span>`).join('')}
          ${(!r.emails?.length && !r.phones?.length) ? '<span class="chip none">لا توجد بيانات ظاهرة</span>' : ''}
        </div>
      </div>
    `).join('');
  }

  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function updateBadge() {
    badge.textContent = results.length;
  }

  function persist() {
    chrome.storage.local.set({ liScrapeResults: results.slice(-2000) });
    updateBadge();
  }

  // ---------- تصدير CSV ----------
  $('#btn-csv').addEventListener('click', () => {
    if (!results.length) return flash('مفيش نتائج تتصدر');
    const headers = [
      'Full Name', 'Headline', 'Current Company', 'Location',
      'Email(s)', 'Phone(s)', 'Phone Type(s)', 'Phone Status',
      'LinkedIn URL', 'LinkedIn ID', 'Photo URL', 'Scraped At'
    ];
    const rows = results.map(r => ([
      r.fullName || '', r.headline || '', r.currentCompany || '', r.location || '',
      (r.emails || []).join('; '),
      (r.phones || []).map(p => p.number).join('; '),
      (r.phones || []).map(p => p.type).join('; '),
      (r.phones || []).map(p => p.complete === false ? 'MASKED' : 'COMPLETE').join('; '),
      r.profileUrl || '', r.linkedinId || '', r.photoUrl || '', r.scrapedAt || ''
    ]));
    const csv = '\uFEFF' + [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const encoder = new TextEncoder();
    downloadViaBackground(encoder.encode(csv).buffer, `linkedin_contacts_${Date.now()}.csv`, 'text/csv;charset=utf-8');
  });

  // ---------- تصدير Excel ----------
  $('#btn-excel').addEventListener('click', async () => {
    if (!results.length) return flash('مفيش نتائج تتصدر');
    const rows = results.map(r => ({
      'Full Name': r.fullName,
      'Headline': r.headline,
      'Company': r.currentCompany,
      'Location': r.location,
      'Email(s)': (r.emails || []).join('; '),
      'Phone(s)': (r.phones || []).map(p => p.number).join('; '),
      'Phone Type': (r.phones || []).map(p => p.type).join('; '),
      'Phone Status': (r.phones || []).map(p => p.complete === false ? 'MASKED' : 'COMPLETE').join('; '),
      'LinkedIn URL': r.profileUrl,
      'LinkedIn ID': r.linkedinId,
      'Scraped At': r.scrapedAt
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadViaBackground(out, `linkedin_contacts_${Date.now()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  // ---------- تصدير JSON ----------
  $('#btn-json').addEventListener('click', async () => {
    if (!results.length) return flash('مفيش نتائج تتصدر');
    const text = JSON.stringify(results, null, 2);
    const encoder = new TextEncoder();
    downloadViaBackground(encoder.encode(text).buffer, `linkedin_contacts_${Date.now()}.json`, 'application/json');
  });

  // إرسال ArrayBuffer للـ background worker الذي يحوّله لـ DataURL وينزّله
  // (kأن MV3 service worker ما بيرفعش Blob URLs — وأيضاً البوب أب بيموت لو اتقفل أثناء التنزيل)
  function downloadViaBackground(buffer, filename, mime) {
    chrome.runtime.sendMessage({ action: 'DOWNLOAD_BLOB', buffer, filename, mime }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        setStatus('⚠️ فشل التنزيل — جرّب إعادة المحاولة', 'warn');
      } else {
        setStatus(`⬇️ جارٍ تنزيل ${filename}`, 'ok');
      }
    });
  }

  // ---------- مسح ----------
  $('#btn-clear').addEventListener('click', () => {
    results = [];
    persist();
    renderResults();
    progress.value = 0;
    if (activeTab) chrome.tabs.sendMessage(activeTab.id, { action: 'CLEAR_RESULTS' }, () => void chrome.runtime.lastError);
  });

  function flash(t) { setStatus('⚠️ ' + t, 'warn'); }

  // ---------- الإعدادات ----------
  const SETTING_FIELDS = {
    maxProfiles: '#set-max', delayMin: '#set-delaymin', delayMax: '#set-delaymax',
    autoScroll: '#set-scroll', openContactView: '#set-contact', alsoPeopleViewed: '#set-pav'
  };

  chrome.storage.local.get(['liSettings'], (r) => {
    const s = r.liSettings || {};
    for (const [k, sel] of Object.entries(SETTING_FIELDS)) {
      if (s[k] === undefined) continue;
      const el = $(sel);
      if (el.type === 'checkbox') el.checked = s[k]; else el.value = s[k];
      syncLabels();
    }
  });

  function syncLabels() {
    $('#val-max').textContent = $('#set-max').value;
    $('#val-min').textContent = $('#set-delaymin').value;
    $('#val-maxd').textContent = $('#set-delaymax').value;
  }
  ['#set-max', '#set-delaymin', '#set-delaymax'].forEach(sel => $(sel).addEventListener('input', syncLabels));

  function collectSettings() {
    const s = {};
    for (const [k, sel] of Object.entries(SETTING_FIELDS)) {
      const el = $(sel);
      s[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
    }
    return s;
  }

  function saveSettings(cb) {
    chrome.storage.local.set({ liSettings: collectSettings() }, cb);
  }

  $('#btn-save-settings').addEventListener('click', () => {
    saveSettings(() => setStatus('💾 تم حفظ الإعدادات', 'ok'));
  });
})();
