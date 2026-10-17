/* ============================================================
   WA Outreach Pro — Safety module (نقي، قابل للاختبار في Node)
   Opt-out AR/EN + dedup + daily cap + warm-up + risk thresholds
   ============================================================ */
(function (global) {
  'use strict';

  const OPTOUT_WORDS = [
    // English
    'stop', 'unsubscribe', 'opt out', 'optout', 'remove me', 'dont message',
    "don't message", 'no more messages', 'block you', 'leave me alone', 'cancel',
    // Arabic (بدون تشكيل، تطابق بداية الكلمة)
    'إيقاف', 'ايقاف', 'أوقف', 'اقف', 'قفي', 'الغاء', 'إلغاء', 'خروج', 'حذف',
    'لا اريد', 'لا أريد', 'بلاش', 'كفاية', 'كفى', 'وقّف', 'وقفت', 'مش عايز'
  ];

  // نصوص تظهر في DOM عند وجود خطر على الحساب → E-STOP
  const RISK_PHRASES = [
    'not allowed on our services', 'temporarily blocked', 'this account is banned',
    'account may be banned', 'may be subject to restrictions', 'captcha',
    'suspicious activity', 'in-app support', 'تم حظر', 'موقوف مؤقتًا', 'محظور'
  ];

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670]/g, '')   // إزالة التشكيل
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')                      // الألف المقصورة → الياء
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** هل نص الرسالة الواردة يعني انسحاب المستخدم؟ */
  function isOptOut(text) {
    const t = normalize(text);
    if (!t) return false;
    for (const w of OPTOUT_WORDS) {
      const n = normalize(w);
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // تطابق كلمة كاملة في أول/وسط/آخر الجملة مع فواصل عربية وإنجليزية
      const re = new RegExp('(^|[\\s،,])(' + esc + ')($|[\\s.!?؟،,])');
      if (re.test(t)) return true;
    }
    return false;
  }

  /** تطبيع رقم الهاتف لصيغة E.164 رقمية فقط */
  function normPhone(raw) {
    let d = String(raw || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) d = d.slice(1);
    else d = d.replace(/\+/g, '');
    if (d.startsWith('00')) d = d.slice(2); // 00966... → 966...
    if (!/^\d+$/.test(d)) return null;
    return d.length >= 8 ? d : null;
  }

  /* ---- الحارس: حد يومي + نافذة تكرار + تسخين تراكمي ---- */
  class Guard {
    /**
     * @param {{dailyCap?:number, dedupWindowMs?:number, warmupStep?:number}} opts
     */
    constructor(opts = {}) {
      this.dailyCap = opts.dailyCap ?? 80;
      this.dedupWindowMs = opts.dedupWindowMs ?? 24 * 3600 * 1000;
      this.warmupStep = opts.warmupStep ?? 20; // +20 رسالة مسموحة كل يوم تشغيل
      const st = opts.state || { day: todayKey(), sentToday: 0, activeDays: 1, lastSeen: {} };
      // ترحيل الحالة القديمة التي كانت تحتوي بادئة '2' تجريبية إن وُجدت — لا شيء
      this.state = st;
      this._rollDay();
    }

    static todayKey() { return todayKey(); }

    _rollDay() {
      const k = todayKey();
      if (this.state.day !== k) {
        this.state.day = k;
        this.state.sentToday = 0;
        this.state.activeDays = Math.min(30, (this.state.activeDays || 1) + 1);
      }
    }

    /** السقف الفعلي اليوم بعد التسخين */
    effectiveCap() {
      this._rollDay();
      return Math.min(this.dailyCap, this.warmupStep * (this.state.activeDays || 1));
    }

    /**
     * قرار الإرسال: {allow:boolean, reason?:string, waitMs?:number}
     */
    check(phone, now = Date.now()) {
      this._rollDay();
      const p = normPhone(phone);
      if (!p) return { allow: false, reason: 'invalid_number' };
      if (this.state.blocked && this.state.blocked[p]) return { allow: false, reason: 'opted_out' };
      if (this.state.sentToday >= this.effectiveCap()) return { allow: false, reason: 'daily_cap' };
      const last = (this.state.lastSeen || {})[p] || 0;
      if (last && now - last < this.dedupWindowMs) return { allow: false, reason: 'dedup' };
      return { allow: true };
    }

    recordSend(phone, now = Date.now()) {
      this._rollDay();
      const p = normPhone(phone);
      this.state.sentToday = (this.state.sentToday || 0) + 1;
      this.state.lastSeen = this.state.lastSeen || {};
      this.state.lastSeen[p] = now;
      return this.state.sentToday;
    }

    block(phone) {
      const p = normPhone(phone);
      if (!p) return false;
      this.state.blocked = this.state.blocked || {};
      this.state.blocked[p] = true;
      return true;
    }

    unblock(phone) {
      const p = normPhone(phone);
      if (this.state.blocked && p) delete this.state.blocked[p];
    }

    stats() {
      return {
        sent_today: this.state.sentToday || 0,
        effective_cap: this.effectiveCap(),
        hard_cap: this.dailyCap,
        active_days: this.state.activeDays || 1,
        opted_out: Object.keys(this.state.blocked || {}).length
      };
    }
  }

  function todayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  const api = { OPTOUT_WORDS, RISK_PHRASES, normalize, isOptOut, normPhone, Guard, todayKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.WAO = global.WAO || {};
  global.WAO.safety = api;
})(typeof window !== 'undefined' ? window : globalThis);
