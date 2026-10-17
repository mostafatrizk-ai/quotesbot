/* ============================================================
   WA Outreach Pro — WhatsApp Web DOM Adapter
   كل ملامسة الـ DOM معزولة هنا. Selectors موثقة ومقاومة للتغير:
   لو selector فشل نرمي خطأ واضحًا بدل صمت.
   ============================================================ */
(function (global) {
  'use strict';

  // selectors حسب بنية web.whatsapp.com الحالية (data-testid هي الأساس)
  const SEL = {
    chatList: '[data-testid="chat-list"]',
    searchInput: '[data-testid="chat-search-input"], [data-testid="input-chat-search"]',
    panelFooter: '[data-testid="panel-footer"], [data-testid="composing-box"]',
    inputBox: '[data-testid="conversation-input-box-text"], div[contenteditable="true"][data-tab="10"]',
    sendBtn: '[data-testid="send"], [data-testid="composed-send-btn"] button, button[aria-label="Send"]',
    lastMsg: '[data-testid="last-read"] span.selectable-text, div[data-testid="msg-container"] span.selectable-text',
    statusTicks: '[data-testid="status-clocks"], [data-testid="msg-dblclick-ack"], [data-testid="ack"]',
    connBanner: '#app-wrapper [role="alert"], [data-testid="offline-banner"]',
    blockedText: '#mount_point'
  };

  function q(sel, root) { return (root || document).querySelector(sel); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function mustEl(sel, what) {
    const el = q(sel);
    if (!el) throw new Error('WA DOM change? مفشيش على: ' + what + ' (' + sel + ')');
    return el;
  }

  /** فتح/إنشاء محادثة مع رقم عبر wa.me style search داخل واتساب ويب */
  async function ensureChat(phone, name) {
    await waitReady();
    // نستخدم رابط داخلي: https://web.whatsapp.com/send?phone= → أسلم طريقة للرقم الجديد
    const url = location.origin + '/send?phone=' + phone + '&text=%20';
    // نتجنب reload كامل: نفتح عن طريق history API ثم نضغط بحث
    try {
      const input = mustEl(SEL.searchInput, 'صندوق البحث');
      input.focus();
      setNativeValue(input, '');
      await sleep(300);
      setNativeValue(input, name || phone);
      await sleep(rand(800, 1500));
      // لو الاسم مش موجود نجرب الرقم
      let row = findContactRow(name || phone);
      if (!row && name) {
        setNativeValue(input, phone);
        await sleep(rand(900, 1600));
        row = findContactRow(phone);
      }
      if (!row) throw new Error('المحادثة غير موجودة للرقم ' + phone);
      row.click();
      await sleep(rand(900, 1700));
      return true;
    } catch (e) {
      // fallback: تنقل مباشر (أبطأ لكنه أدق للأرقام الجديدة)
      location.href = url;
      await waitReady();
      await sleep(1500);
      return true;
    }
  }

  function findContactRow(term) {
    const nodes = document.querySelectorAll('[data-testid="cell-frame-container"], [role="listitem"]');
    for (const n of nodes) {
      const t = n.textContent || '';
      if (t.includes(String(term)) || t.replace(/\D/g, '').includes(String(term).replace(/\D/g, ''))) return n;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** كتابة تدريجية حرف بحرف داخل صندوق المحادثة */
  async function typeHuman(text, perCharMs = 70) {
    const box = mustEl(SEL.inputBox, 'صندوق الكتابة');
    box.focus();
    await sleep(rand(200, 500));
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n') {
        insertChar(box, '\u000A');
      } else {
        insertChar(box, ch);
      }
      await sleep(perCharMs + rand(-25, 45)); // jitter حول السرعة الأساسية
      if (Math.random() < 0.015) await sleep(rand(400, 1200)); // توقفات تفكير عشوائية
    }
    await sleep(rand(300, 800));
  }

  function insertChar(box, ch) {
    const ok = document.execCommand('insertText', false, ch);
    if (!ok) {
      // fallback لبعض builds
      const dt = new DataTransfer();
      box.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: ch }));
      box.textContent += ch;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    }
  }

  async function pressSend() {
    const btn = q(SEL.sendBtn) || null;
    if (btn) { btn.click(); await sleep(rand(400, 900)); return; }
    // Enter كخطة بديلة
    const box = mustEl(SEL.inputBox, 'صندوق الكتابة');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(rand(400, 900));
  }

  /** آخر حالة tick لآخر رسالة في المحادثة المفتوحة: sent/delivered/read */
  function lastAck() {
    const conts = document.querySelectorAll('[data-testid="msg-container"]');
    if (!conts.length) return 'unknown';
    const last = conts[conts.length - 1];
    if (last.querySelector('[data-testid="msg-dblclick-ack-read"], span[data-icon="status-checkmark-read"], [data-icon="done-tick"]')) return 'read';
    if (last.querySelector('[data-testid="msg-dblclick-ack-double"], span[data-icon="status-dblcheck"]')) return 'delivered';
    if (last.querySelector('span[data-icon="status-check"], span[data-icon="status-dblcheck"]')) return 'sent';
    return 'unknown';
  }

  /** نص آخر رسالة واردة في المحادثة المفتوحة (للووتشدج) */
  function lastIncomingText() {
    const rows = document.querySelectorAll('[data-testid="msg-in"], [data-testid="row-out"]');
    const incoming = Array.from(document.querySelectorAll('.message-in span.selectable-text'));
    if (!incoming.length) return null;
    return incoming[incoming.length - 1].textContent || null;
  }

  async function waitReady(timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (q(SEL.chatList) || q(SEL.searchInput)) return true;
      await sleep(500);
    }
    throw new Error('واتساب ويب لسه ما جهّزش بعد — تأكد إنك مسجل دخول');
  }

  /** فحص وجود بانر حظر/قيود في الصفحة كلها */
  function riskScan() {
    const S = global.WAO && global.WAO.safety ? global.WAO.safety.RISK_PHRASES : [];
    const body = (document.body && document.body.innerText || '').toLowerCase();
    for (const p of S) if (body.includes(p.toLowerCase())) return p;
    return null;
  }

  function rand(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }

  const api = { SEL, ensureChat, typeHuman, pressSend, lastAck, lastIncomingText, waitReady, riskScan, findContactRow, sleep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.WAO = global.WAO || {};
  global.WAO.wa = api;
})(typeof window !== 'undefined' ? window : globalThis);
