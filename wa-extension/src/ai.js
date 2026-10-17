/* ============================================================
   WA Outreach Pro — AI Agent (اختياري، OpenAI-compatible)
   بدون مفتاح = يعمل offline بالكامل. المفاتيح في storage.local فقط.
   الوظائف: تصنيف الردود + اقتراح رد ذكي + تحسين نص الحملة
   ============================================================ */
(function (global) {
  'use strict';

  const DEFAULTS = {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: ''
  };

  class AIAgent {
    constructor(cfg) {
      this.cfg = Object.assign({}, DEFAULTS, cfg || {});
    }

    updateConfig(patch) { Object.assign(this.cfg, patch); }

    get available() { return !!(this.cfg.enabled && this.cfg.apiKey); }

    async _chat(messages, maxTokens = 300) {
      const res = await fetch(this.cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.cfg.apiKey
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.4
        })
      });
      if (!res.ok) throw new Error('AI HTTP ' + res.status);
      const j = await res.json();
      return j.choices[0].message.content.trim();
    }

    /** تصنيف رسالة واردة → interested|not_interested|question|opt_out|other */
    async classifyReply(text, campaignContext) {
      if (!this.available) return { label: this._keywordClassify(text), source: 'offline' };
      try {
        const out = await this._chat([
          { role: 'system', content: 'صنّف رد عميل وصل بعد رسالة تسويقية عبر واتساب. أعد كلمة واحدة فقط من: interested, not_interested, question, opt_out, other' },
          { role: 'user', content: `سياق الحملة: ${campaignContext || '-'}\nرد العميل: """${text}"""` },
        ], 5);
        const label = (out || '').toLowerCase().replace(/[^a-z_]/g, '');
        const valid = ['interested', 'not_interested', 'question', 'opt_out', 'other'];
        return { label: valid.includes(label) ? label : 'other', source: 'ai' };
      } catch (e) {
        return { label: this._keywordClassify(text), source: 'offline-fallback' };
      }
    }

    _keywordClassify(text) {
      const S = global.WAO.safety;
      if (S.isOptOut(text)) return 'opt_out';
      const t = S.normalize(text);
      if (/(اسعر|سعر|كام|كم سعر|budget|price|cost|ممكن|عايز|Interested|تمام|ماشي|اوكي)/i.test(t)) return 'interested';
      if (/\?|؟|ازاي|إزاي|ليه|ليش|why|how/.test(t)) return 'question';
      if (/(مش فاضي|لأ|لا شكرا|no thanks|not now)/.test(t)) return 'not_interested';
      return 'other';
    }

    /** اقتراح رد على العميل بناءً على سياقه */
    async suggestReply(incomingText, campaignTemplate, profile) {
      if (!this.available) return null;
      try {
        return await this._chat([
          { role: 'system', content: 'أنت مساعد مبيعات محترف يكتب ردود واتساب قصيرة (سطرين كحد أقصى) بالعربية العامية المهذبة أو بلغة العميل. لا تبالغ ولا تعد بشيء غير موجود.' },
          { role: 'user', content: `الرسالة الأصلية للحملة: """${campaignTemplate}"""\nملف العميل: ${JSON.stringify(profile || {})}\nرد العميل: """${incomingText}"""\nاقترح ردًا مناسبًا:` },
        ], 200);
      } catch (e) { return null; }
    }

    /** تحسين نص حملة: أقصر + أوضح + CTA أقوى */
    async improveTemplate(text) {
      if (!this.available) return null;
      try {
        return await this._chat([
          { role: 'system', content: 'أعد صياغة نص حملة واتساب تسويقية ليكون أقصر 30%% وأكثر إقناعًا مع الحفاظ على المتغيرات {{...}} كما هي وحرفيًا.' },
          { role: 'user', content: text }
        ], 400);
      } catch (e) { return null; }
    }

    /** حارس ذكي: هل يستحسن الإرسال لهذا العميل الآن؟ (توقيت/اهتمام) */
    async shouldContact(contact, historySummary) {
      if (!this.available) return { go: true, reason: 'offline-default' };
      try {
        const out = await this._chat([
          { role: 'system', content: 'محلر قرار outreach. أعد JSON: {"go":true|false,"reason":"..."}' },
          { role: 'user', content: `العميل: ${JSON.stringify(contact)}\nسجل التفاعل: ${historySummary || 'جديد'}\nهل مراسلته الآن ذكية؟` },
        ], 80);
        const m = out.match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : { go: true, reason: 'parse-fail' };
      } catch (e) { return { go: true, reason: 'error-default' }; }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { AIAgent, DEFAULTS };
  global.WAO = global.WAO || {};
  global.WAO.ai = { AIAgent, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
