/* ============================================================
   WA Outreach Pro — Engine (نقي): طابور + فترات بشرية + pause
   لا DOM هنا — adapter يُمرّر عن طريق inject(waAdapter)
   ============================================================ */
(function (global) {
  'use strict';

  const DEFAULTS = {
    dailyCap: 80,
    sessionMax: 25,          // أقصى رسائل في الجلسة الواحدة ثم توقف ذاتي
    minGapMs: 45000,         // أقل فترة بين رسالتين
    maxGapMs: 120000,        // أكبر فترة
    typingPerCharMs: [45, 110], // سرعة كتابة بشرية لكل حرف
    microPauseEvery: 10,     // استراحة كل N رسائل
    microPauseMs: [60000, 180000],
    dedupWindowMs: 24 * 3600 * 1000,
    warmupStep: 20
  };

  function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  class Engine {
    /**
     * @param {{safety: typeof import('./safety.js'), wa: object|null, settings?:object, onEvent?:fn}} deps
     */
    constructor(deps) {
      this.safety = deps.safety;
      this.wa = deps.wa || null;           // يُضبط لاحقًا عبر setWa
      this.settings = Object.assign({}, DEFAULTS, deps.settings || {});
      this.onEvent = deps.onEvent || (() => {});
      this.guard = new this.safety.Guard({
        dailyCap: this.settings.dailyCap,
        dedupWindowMs: this.settings.dedupWindowMs,
        warmupStep: this.settings.warmupStep
      });
      this.queue = [];        // [{phone, name, vars}]
      this.template = '';     // نص فيه {{name}} {{vars...}}
      this.running = false;
      this.estopped = false;
      this.sessionSent = 0;
      this.log = [];
      this._timer = null;
    }

    setWa(wa) { this.wa = wa; }

    updateSettings(patch) {
      Object.assign(this.settings, patch);
      this.guard.dailyCap = this.settings.dailyCap;
      this.guard.dedupWindowMs = this.settings.dedupWindowMs;
      this.guard.warmupStep = this.settings.warmupStep;
    }

    loadState(state) { if (state) this.guard.state = state; }
    dumpState() { return this.guard.state; }

    /** تعبئة القالب ببيانات جهة الاتصال */
    renderTemplate(contact) {
      const vars = Object.assign({ name: contact.name || '' }, contact.vars || {});
      return this.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
    }

    addContacts(list) {
      let added = 0;
      for (const c of list) {
        const p = this.safety.normPhone(c.phone);
        if (!p) continue;
        if (this.queue.some(q => q.phone === p)) continue;
        this.queue.push({ phone: p, name: c.name || '', vars: c.vars || {} });
        added++;
      }
      this._emit('queue', `أُضيف ${added} جهة، الإجمالي ${this.queue.length}`);
      return added;
    }

    importCsv(text) {
      // CSV: phone,name,custom... → الأعمدة بعد الثاني تصبح vars باسم العمود
      const lines = String(text).split(/\r?\n/).filter(Boolean);
      if (!lines.length) return 0;
      const head = lines[0].split(',').map(s => s.trim().toLowerCase());
      const out = [];
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(',');
        const rec = { phone: cells[0], name: cells[1] || '' , vars: {}};
        for (let j = 2; j < head.length; j++) if (head[j]) rec.vars[head[j]] = (cells[j] || '').trim();
        out.push(rec);
      }
      return this.addContacts(out);
    }

    clearQueue() { this.queue = []; }

    start() {
      if (!this.wa) throw new Error('wa adapter missing');
      if (!this.template.trim()) { this._emit('error', 'القالب فارغ'); return false; }
      if (!this.queue.length) { this._emit('error', 'لا توجد جهات اتصال'); return false; }
      this.running = true; this.estopped = false; this.sessionSent = 0;
      this._emit('start', `بدأت الحملة — ${this.queue.length} جهة`);
      this._scheduleNext(this._firstDelayMs ?? 2000);
      return true;
    }

    pause(reason) {
      this.running = false;
      clearTimeout(this._timer);
      this._emit('pause', reason || 'إيقاف مؤقت');
    }

    emergencyStop(reason) {
      this.estopped = true;
      this.pause('⛔ إيقاف طارئ: ' + reason);
    }

    _scheduleNext(ms) {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this._tick(), ms);
    }

    async _tick() {
      if (!this.running || this.estopped) return;
      if (this.sessionSent >= this.settings.sessionMax) {
        this.pause(`اكتملت الجلسة (${this.sessionSent}) — انتظر لبدء جلسة جديدة`);
        return;
      }
      const contact = this.queue.shift();
      if (!contact) { this.running = false; this._emit('done', 'انتهت القائمة بالكامل ✅'); return; }

      const decision = this.guard.check(contact.phone);
      if (!decision.allow) {
        if (decision.reason === 'daily_cap') {
          this.queue.unshift(contact);
          this.pause('بلوغ الحد اليومي بأمان — كمّل بكرة');
          return;
        }
        this._emit('skip', `تخطّي ${contact.phone} (${decision.reason})`);
        this._scheduleNext(1000);
        return;
      }

      try {
        const msg = this.renderTemplate(contact);
        await this._sendHuman(contact, msg);
        this.guard.recordSend(contact.phone);
        this.sessionSent++;
        this._emit('sent', `✓ ${contact.name || contact.phone} (${this.guard.stats().sent_today}/${this.guard.effectiveCap()})`);
      } catch (e) {
        this._emit('fail', `✗ ${contact.phone}: ${e.message}`);
      }

      if (this.sessionSent % this.settings.microPauseEvery === 0 && this.queue.length) {
        const [a, b] = this.settings.microPauseMs;
        const wait = randInt(a, b);
        this._emit('break', `استراحة ${Math.round(wait / 1000)} ثانية 😌`);
        this._scheduleNext(wait);
      } else {
        const [ga, gb] = [this.settings.minGapMs, this.settings.maxGapMs];
        this._scheduleNext(randInt(ga, gb));
      }
    }

    /** محاكاة بشر حقيقية: فتح محادثة → كتابة تدريجية → إرسال
     *  (الفترات الكبيرة تحدث في _scheduleNext بين الرسائل، لا هنا) */
    async _sendHuman(contact, msg) {
      const wa = this.wa;
      await wa.ensureChat(contact.phone, contact.name);
      if (wa.preSendPause) await wa.preSendPause(); // اختياري من الـ adapter نفسه
      const [tMin, tMax] = this.settings.typingPerCharMs;
      await wa.typeHuman(msg, randInt(tMin, tMax));
      await wa.pressSend();
    }

    _emit(type, text) {
      this.log.push({ t: Date.now(), type, text });
      if (this.log.length > 500) this.log.splice(0, 100);
      this.onEvent({ type, text });
    }

    stats() {
      return Object.assign(this.guard.stats(), {
        queued: this.queue.length,
        running: this.running,
        estopped: this.estopped,
        session_sent: this.sessionSent
      });
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  if (typeof module !== 'undefined' && module.exports) module.exports = { Engine, DEFAULTS, randInt, pick };
  global.WAO = global.WAO || {};
  global.WAO.engine = { Engine, DEFAULTS, randInt, pick };
})(typeof window !== 'undefined' ? window : globalThis);
