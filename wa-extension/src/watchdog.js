/* ============================================================
   WA Outreach Pro — Watchdog حي
   1) يفحص DOM كل فترة عن أي نص حظر/قيود → E-STOP فوري
   2) يرصد الرسائل الواردة في المحادثة المفتوحة → opt-out + تصنيف AI
   3) يلتقط حالة ticks (delivered/read) بعد كل إرسال ويسجلها
   ============================================================ */
(function (global) {
  'use strict';

  class Watchdog {
    /**
     * @param {{wa, safety, engine, ai, onEvent}} deps
     */
    constructor(deps) {
      this.wa = deps.wa;
      this.safety = deps.safety;
      this.engine = deps.engine;
      this.ai = deps.ai;
      this.onEvent = deps.onEvent || (() => {});
      this._timers = [];
      this._lastSeenIncoming = '';
      this.replies = []; // {phone?, text, label, source, t}
    }

    start(intervalMs = 5000) {
      this.stop();
      const t1 = setInterval(() => this._riskCheck(), intervalMs);
      const t2 = setInterval(() => this._incomingCheck(), 3500);
      this._timers.push(t1, t2);
      this._emit('watch', 'المراقب الذكي شغال 👀');
    }

    stop() { this._timers.forEach(clearInterval); this._timers = []; }

    _riskCheck() {
      try {
        const hit = this.wa.riskScan();
        if (hit) {
          this.engine.emergencyStop('ظهر تحذير واتساب: "' + hit + '"');
          this._emit('danger', '🚨 ' + hit);
          if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ wao_estop_reason: hit });
          }
        }
      } catch (e) { /* تجاهل أخطاء الفحص */ }
    }

    _incomingCheck() {
      try {
        const txt = this.wa.lastIncomingText();
        if (!txt || txt === this._lastSeenIncoming) return;
        this._lastSeenIncoming = txt;
        this._handleIncoming(txt);
      } catch (e) { /* */ }
    }

    async _handleIncoming(text) {
      const S = this.safety;
      // opt-out فوري بالكلمات (بدون انتظار AI)
      if (S.isOptOut(text)) {
        const phone = this._currentChatPhone();
        if (phone) {
          this.engine.guard.block(phone);
          this._emit('optout', `🛑 انسحاب مؤكد: ${phone} أُضيف للقائمة السلبية`);
        }
        this.replies.push({ text, label: 'opt_out', source: 'keyword', t: Date.now() });
        return;
      }
      // تصنيف ذكي للردود الأخرى
      let cls = { label: 'other', source: 'offline' };
      if (this.ai && this.ai.available) {
        cls = await this.ai.classifyReply(text, this.engine.template);
      } else {
        cls = { label: this.ai ? this.ai._keywordClassify(text) : 'other', source: 'offline' };
      }
      this.replies.push({ text, label: cls.label, source: cls.source, t: Date.now() });
      this._emit('reply', `💬 رد [${cls.label}]: ${text.slice(0, 60)}`);
      // لو مهتم → نفتح تذكير للمستخدم برد مقترح
      if (cls.label === 'interested' && this.ai && this.ai.available) {
        const sug = await this.ai.suggestReply(text, this.engine.template, {});
        if (sug) this._emit('ai-suggest', '🤖 رد مقترح: ' + sug.slice(0, 80));
      }
    }

    /** يحاول استخراج الرقم من عنوان المحادثة المفتوحة */
    _currentChatPhone() {
      try {
        const title = document.querySelector('[data-testid="cell-frame-title"], [title]');
        const raw = (title && (title.getAttribute('title') || title.textContent)) || '';
        const m = raw.match(/(\+?\d[\d\s\-()]{7,}\d)/);
        return m ? this.safety.normPhone(m[0]) : null;
      } catch (e) { return null; }
    }

    /** تسجيل ack لآخر رسالة مرسلة (يستدعيه الـ UI بعد الإرسال بفترة) */
    recordAck() {
      const ack = this.wa.lastAck();
      if (ack !== 'unknown') this._emit('ack', 'حالة التسليم: ' + ack);
      return ack;
    }

    _emit(type, text) { this.onEvent({ type, text }); }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { Watchdog };
  global.WAO = global.WAO || {};
  global.WAO.watchdog = { Watchdog };
})(typeof window !== 'undefined' ? window : globalThis);
