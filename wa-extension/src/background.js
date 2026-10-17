/* WA Outreach Pro — Service Worker (MV3)
   badge حي + حفظ آخر حالة + alarm يومي لإعادة ضبط العداد في اللوحة */
let lastStats = null;
let lastEvent = null;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'wao-event') {
    lastEvent = msg.payload;
    lastStats = msg.payload.stats || lastStats;
    updateBadge();
  }
  if (msg.type === 'wao-stats') { lastStats = msg.stats; updateBadge(); }
});

function updateBadge() {
  const s = lastStats;
  if (!s) return;
  let text = '';
  let color = '#808080';
  if (s.estopped) { text = '⛔'; color = '#d34f4f'; }
  else if (s.running) { text = String(s.sent_today); color = '#00a884'; }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// alarm يومي للاحتفاظ بالوعي (content script يعيد ضبط الحارس بنفسه عبر Guard._rollDay)
chrome.alarms.create('daily-roll', { periodInMinutes: 60 * 24 });
chrome.alarms.onAlarm.addListener(() => {
  // نبض خفيف: لو مفيش تبويب واتساب مفتوح، نطهر البادج
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    if (!tabs.length) chrome.action.setBadgeText({ text: '' });
  });
});
