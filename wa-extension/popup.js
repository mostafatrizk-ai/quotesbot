/* popup — حالة سريعة + أوامر تحكم */
function findWaTab(cb) {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => cb(tabs[0] || null));
}

function render(s, estopReason) {
  const el = document.getElementById('st');
  if (!s) {
    el.innerHTML = '⚠️ افتح <a href="https://web.whatsapp.com" target="_blank">web.whatsapp.com</a> وحمّل الصفحة أولًا.';
    return;
  }
  el.innerHTML = `
    الحالة: ${s.estopped ? '⛔ E-STOP' : s.running ? '▶ شغال' : 'متوقف'}<br/>
    اليوم: <b>${s.sent_today}/${s.effective_cap}</b> (سقف صارم ${s.hard_cap})<br/>
    بالطابور: ${s.queued ?? '-'} · منسحبين: ${s.opted_out}<br/>
    ${estopReason ? '🚨 سبب الإيقاف الطارئ: ' + estopReason : ''}`;
}

findWaTab((tab) => {
  if (!tab) return render(null);
  chrome.storage.local.get(['wao_state', 'wao_estop_reason'], (r) => {
    const g = r.wao_state && r.wao_state.guard;
    let stats = null;
    if (g) {
      // إعادة حساب إحصائيات الحارس من الحالة المخزنة
      const sentToday = g.sentToday || 0;
      const days = Math.min(30, g.activeDays || 1);
      stats = {
        sent_today: sentToday, effective_cap: Math.min(80, 20 * days), hard_cap: 80,
        queued: (r.wao_state.queue || []).length, opted_out: Object.keys(g.blocked || {}).length,
        running: false, estopped: !!r.wao_estop_reason
      };
    }
    render(stats, r.wao_estop_reason);
    // طلب أحدث حالة حية من content script
    chrome.tabs.sendMessage(tab.id, { type: 'wao-cmd', cmd: 'stats-ping' }, () => {
      if (chrome.runtime.lastError) return;
    });
  });
});

// التقاط آخر إحصائية حية مرسلة من الـ SW عبر storage مشترك
chrome.storage.onChanged.addListener((ch) => {
  if (ch.wao_live_stats) {
    const s = ch.wao_live_stats.newValue;
    chrome.storage.local.get(['wao_estop_reason'], (r) => render(s, r.wao_estop_reason));
  }
});

document.getElementById('pause').onclick = () => sendCmd('pause');
document.getElementById('estop').onclick = () => sendCmd('estop');
function sendCmd(cmd) {
  findWaTab((tab) => {
    if (tab) chrome.tabs.sendMessage(tab.id, { type: 'wao-cmd', cmd });
  });
}
