/* ============================================================
   Background Service Worker (MV3)
   - يدير التنقل بين البروفيلات في نفس التاب
   - يعيد حقن سكربتات الاستخراج بعد كل transition
   - يحمّل النتائج ويصدّرها CSV / Excel
   ============================================================ */

let scrapeTabId = null;

// ---------- استقبال رسائل من content / popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case 'NAVIGATE': {
      // الانتقال لرابط البروفايل التالي في تاب السكراب
      const tabId = sender.tab ? sender.tab.id : scrapeTabId;
      if (tabId != null) {
        scrapeTabId = tabId;
        chrome.tabs.update(tabId, { url: msg.url });
      }
      sendResponse({ ok: true });
      return true;
    }

    case 'SET_TAB':
      // البوب أب يخبرنا بالتاب الذي سيُستخدم للسكراب
      scrapeTabId = msg.tabId;
      sendResponse({ ok: true });
      return true;

    case 'EXPORT_CSV':
      exportData(msg.results, 'csv');
      sendResponse({ ok: true });
      return true;

    case 'EXPORT_EXCEL':
      // الإكسل يتم توليده داخل popup باستخدام xlsx lib — نكتفي بتنزيل DataURL المرسل
      downloadDataURL(msg.dataUrl, msg.filename);
      sendResponse({ ok: true });
      return true;

    case 'DOWNLOAD_BLOB': {
      // MV3 service worker لا يملك URL.createObjectURL — البوب أب يرسل ArrayBuffer هنا
      const bytes = new Uint8Array(msg.buffer);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      const dataUrl = `data:${msg.mime || 'application/octet-stream'};base64,${btoa(binary)}`;
      downloadDataURL(dataUrl, msg.filename);
      sendResponse({ ok: true });
      return true;
    }

    default:
      // أحداث مثل profile-done / finished تمر للـ popup مباشرة
      break;
  }
});

// ---------- متابعة تحميل الصفحات لإعادة حقن الاستخراج ----------
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  chrome.storage.local.get(['liSession'], (r) => {
    const session = r.liSession || {};
    if (!session.running) return;
    // لا نتعامل إلا مع تاب السكراب المسجل، أو أي تاب لينكدإن إن لمُسجل بعد
    if (scrapeTabId !== null && tabId !== scrapeTabId) return;

    // صفحة بروفايل جديدة تم تحميلها أثناء الجلسة → اطلب استخراج فوري
    if (/linkedin\.com\/in\/[^/?#]+$/.test(tab.url)) {
      scrapeTabId = tabId;
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { action: 'SCRAPE_NOW' }, () => {
          if (chrome.runtime.lastError) {
            // الكوننت سكريبت غير محقون (مثلاً بعد reload) — نحققه يدوياً
            chrome.scripting.executeScript({
              target: { tabId },
              files: ['content/parser.js', 'content/content.js']
            }).then(() => {
              chrome.scripting.insertCSS({ target: { tabId }, files: ['styles/content.css'] });
              chrome.tabs.sendMessage(tabId, { action: 'SCRAPE_NOW' });
            }).catch(() => {});
          }
        });
      }, 2500 + Math.random() * 2000); // مهلة عشوائية إضافية ضد الحظر
    }
  });
});

// ---------- تصدير CSV ----------
function exportData(results, format) {
  if (!results || !results.length) return;

  const headers = [
    'Full Name', 'Headline', 'Current Company', 'Location',
    'Email(s)', 'Phone(s)', 'Phone Type(s)',
    'LinkedIn URL', 'LinkedIn ID', 'Photo URL', 'Scraped At'
  ];

  const rows = results.map(r => ([
    r.fullName || '',
    r.headline || '',
    r.currentCompany || '',
    r.location || '',
    (r.emails || []).join('; '),
    (r.phones || []).map(p => p.number).join('; '),
    (r.phones || []).map(p => p.type).join('; '),
    r.profileUrl || '',
    r.linkedinId || '',
    r.photoUrl || '',
    r.scrapedAt || ''
  ]));

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  // BOM عربي صحيح للـ Excel
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const reader = new FileReader();
  reader.onload = () => downloadDataURL(reader.result, filename('csv'));
  reader.readAsDataURL(blob);
}

function filename(ext) {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `linkedin_contacts_${stamp}.${ext}`;
}

function downloadDataURL(dataUrl, name) {
  chrome.downloads.download({
    url: dataUrl,
    filename: name,
    saveAs: true
  });
}

// أيقونة نشطة أثناء السكراب
chrome.storage.onChanged.addListener((changes) => {
  if (changes.liSession) {
    const running = changes.liSession.newValue?.running;
    chrome.action.setBadgeText({ text: running ? 'ON' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#0A66C2' });
  }
});
