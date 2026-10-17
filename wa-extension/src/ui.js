/* ============================================================
   WA Outreach Pro — اللوحة الداخلية فوق واتساب ويب (RTL عربي)
   5 تبويبات: حملة | جهات | سجل | AI | إعدادات
   ============================================================ */
(function (global) {
  'use strict';

  function buildUI(app) {
    const { engine, ai, watchdog, safety } = app;

    // حاوية اللوحة
    const root = document.createElement('div');
    root.id = 'wao-panel';
    root.innerHTML = `
      <div class="wao-head">
        <span class="wao-title">🚀 WA Outreach Pro</span>
        <span class="wao-badge" id="wao-state">متوقف</span>
        <button class="wao-min" id="wao-min" title="تصغير">—</button>
      </div>
      <div class="wao-tabs">
        <button data-tab="campaign" class="active">حملة</button>
        <button data-tab="contacts">جهات</button>
        <button data-tab="log">سجل</button>
        <button data-tab="ai">AI 🤖</button>
        <button data-tab="settings">إعدادات</button>
      </div>
      <div class="wao-body">

        <section data-pane="campaign">
          <label>نص الرسالة — استخدم <code>{{name}}</code> ومتغيرات CSV زي <code>{{city}}</code></label>
          <textarea id="wao-template" rows="6" placeholder="مرحبًا {{name}}، عندنا عرض خاص في {{city}}..."></textarea>
          <div class="wao-row">
            <button id="wao-start" class="primary">▶ ابدأ الحملة</button>
            <button id="wao-pause">⏸ إيقاف مؤقت</button>
            <button id="wao-stop" class="danger">⏹ إنهاء الجلسة</button>
          </div>
          <div class="wao-stats" id="wao-stats"></div>
        </section>

        <section data-pane="contacts" hidden>
          <label>ألصق CSV: phone,name,col1,col2...</label>
          <textarea id="wao-csv" rows="8" placeholder="+201000000000,أحمد,القاهرة\n+966500000000,سارة,الرياض"></textarea>
          <button id="wao-import" class="primary">استيراد</button>
          <hr/>
          <label>أو جهة واحدة:</label>
          <input id="wao-one-phone" placeholder="رقم بصيغة دولية +20..." />
          <input id="wao-one-name" placeholder="الاسم" />
          <button id="wao-add-one">إضافة</button>
          <div id="wao-qlist"></div>
        </section>

        <section data-pane="log" hidden>
          <div id="wao-loglist"></div>
        </section>

        <section data-pane="ai" hidden>
          <label><input type="checkbox" id="wao-ai-on"/> فعّل الوكيل الذكي</label>
          <label>API Key (يُحفظ محليًا في متصفحك فقط)</label>
          <input type="password" id="wao-ai-key" placeholder="sk-..." />
          <label>Base URL</label>
          <input id="wao-ai-url" placeholder="https://api.openai.com/v1" />
          <label>Model</label>
          <input id="wao-ai-model" placeholder="gpt-4o-mini" />
          <div class="wao-row">
            <button id="wao-ai-save" class="primary">حفظ</button>
            <button id="wao-ai-improve">✨ تحسين نص الحملة بالـ AI</button>
          </div>
          <div id="wao-ai-status"></div>
          <h4>آخر الردود المصنّفة</h4>
          <div id="wao-replies"></div>
        </section>

        <section data-pane="settings" hidden>
          <div class="wao-grid">
            <label>حد يومي <input type="number" id="s-dailyCap"/></label>
            <label>أقصى جلسة <input type="number" id="s-sessionMax"/></label>
            <label>أدنى فترة (ث) <input type="number" id="s-minGap"/></label>
            <label>أقصى فترة (ث) <input type="number" id="s-maxGap"/></label>
            <label>سرعة كتابة ms/حرف (min) <input type="number" id="s-typeMin"/></label>
            <label>سرعة كتابة ms/حرف (max) <input type="number" id="s-typeMax"/></label>
            <label>استراحة كل N رسائل <input type="number" id="s-pauseEvery"/></label>
            <label>نافذة dedup (ساعة) <input type="number" id="s-dedupH"/></label>
          </div>
          <button id="wao-save-settings" class="primary">حفظ الإعدادات</button>
          <p class="wao-note">💡 القيم الافتراضية مضبوطة على أوضاع anti-ban آمنة. غير أقل بس.</p>
        </section>
      </div>`;
    document.body.appendChild(root);

    const $ = (sel) => root.querySelector(sel);

    // ---- تبويبات ----
    root.querySelectorAll('.wao-tabs button').forEach(b => {
      b.onclick = () => {
        root.querySelectorAll('.wao-tabs button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        root.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
      };
    });
    $('#wao-min').onclick = () => root.classList.toggle('wao-collapsed');

    // ---- أحداث المحرك → السجل والستات ----
    function onEvent(ev) {
      const li = document.createElement('div');
      li.className = 'wao-ev wao-' + ev.type;
      li.textContent = new Date().toLocaleTimeString('ar-EG') + ' — ' + ev.text;
      const box = $('#wao-loglist');
      box.prepend(li);
      while (box.children.length > 200) box.removeChild(box.lastChild);
      renderStats();
      if (ev.type === 'sent' && watchdog) setTimeout(() => watchdog.recordAck(), 6000);
    }

    function renderStats() {
      const s = engine.stats();
      $('#wao-stats').innerHTML = `
        <b>${s.sent_today}/${s.effective_cap}</b> اليوم (السقف الصارم ${s.hard_cap}) ·
        🔥 تسخين: يوم ${s.active_days} ·
        ⏳ بالطابور: ${s.queued} ·
        🛑 منسحبين: ${s.opted_out}`;
      const st = $('#wao-state');
      st.textContent = s.estopped ? '⛔ E-STOP' : (s.running ? '▶ شغال' : 'متوقف');
      st.className = 'wao-badge ' + (s.estopped ? 'red' : s.running ? 'green' : '');
    }

    // ---- حملة ----
    $('#wao-template').value = engine.template || '';
    $('#wao-template').oninput = e => { engine.template = e.target.value; app.persist(); };
    $('#wao-start').onclick = () => { try { engine.start(); } catch (err) { alert(err.message); } };
    $('#wao-pause').onclick = () => engine.pause('أمر مستخدم');
    $('#wao-stop').onclick = () => { engine.clearQueue(); engine.pause('تم إنهاء الجلسة وتنظيف الطابور'); };

    // ---- جهات ----
    $('#wao-import').onclick = () => {
      const n = engine.importCsv($('#wao-csv').value);
      $('#wao-csv').value = '';
      renderQueue();
      alert(`تم استيراد ${n} جهة ✅`);
      app.persist();
    };
    $('#wao-add-one').onclick = () => {
      engine.addContacts([{ phone: $('#wao-one-phone').value, name: $('#wao-one-name').value }]);
      $('#wao-one-phone').value = ''; $('#wao-one-name').value = '';
      renderQueue(); app.persist();
    };
    function renderQueue() {
      const box = $('#wao-qlist');
      box.innerHTML = '<h4>الطابور (' + engine.queue.length + ')</h4>' +
        engine.queue.slice(0, 50).map(c => `<div class="wao-q">${c.phone} — ${c.name || '-'}</div>`).join('');
    }

    // ---- AI ----
    $('#wao-ai-save').onclick = () => {
      ai.updateConfig({
        enabled: $('#wao-ai-on').checked,
        apiKey: $('#wao-ai-key').value.trim(),
        baseUrl: $('#wao-ai-url').value.trim() || 'https://api.openai.com/v1',
        model: $('#wao-ai-model').value.trim() || 'gpt-4o-mini'
      });
      $('#wao-ai-status').textContent = ai.available ? '✅ الوكيل متاح' : '⚠️ الوكيل متوقف (offline classification شغال على أي حال)';
      app.persist();
    };
    $('#wao-ai-improve').onclick = async () => {
      const cur = engine.template;
      if (!cur.trim()) return alert('اكتب نص الحملة الأول');
      $('#wao-ai-status').textContent = '⏳ يحرر...';
      const out = await ai.improveTemplate(cur);
      if (out) {
        engine.template = out; $('#wao-template').value = out;
        $('#wao-ai-status').textContent = '✨ تم التحسين';
      } else {
        $('#wao-ai-status').textContent = '❌ فعّل الـ AI أولًا بمفتاح صحيح';
      }
      app.persist();
    };
    function renderReplies() {
      const box = $('#wao-replies');
      box.innerHTML = watchdog.replies.slice(-15).reverse().map(r =>
        `<div class="wao-r r-${r.label}"><b>${r.label}</b> [${r.source}] — ${r.text.slice(0, 70)}</div>`).join('');
    }
    setInterval(renderReplies, 3000);

    // ---- إعدادات ----
    const map = {
      's-dailyCap': ['dailyCap', v => v],
      's-sessionMax': ['sessionMax', v => v],
      's-minGap': ['minGapMs', v => v * 1000],
      's-maxGap': ['maxGapMs', v => v * 1000],
      's-typeMin': ['typingPerCharMs', null],
      's-typeMax': ['typingPerCharMs', null],
      's-pauseEvery': ['microPauseEvery', v => v],
      's-dedupH': ['dedupWindowMs', v => v * 3600 * 1000]
    };
    function fillSettings() {
      const s = engine.settings;
      $('#s-dailyCap').value = s.dailyCap;
      $('#s-sessionMax').value = s.sessionMax;
      $('#s-minGap').value = Math.round(s.minGapMs / 1000);
      $('#s-maxGap').value = Math.round(s.maxGapMs / 1000);
      $('#s-typeMin').value = s.typingPerCharMs[0];
      $('#s-typeMax').value = s.typingPerCharMs[1];
      $('#s-pauseEvery').value = s.microPauseEvery;
      $('#s-dedupH').value = Math.round(s.dedupWindowMs / 3600000);
    }
    $('#wao-save-settings').onclick = () => {
      const patch = {
        dailyCap: +$('#s-dailyCap').value || 80,
        sessionMax: +$('#s-sessionMax').value || 25,
        minGapMs: (+$('#s-minGap').value || 45) * 1000,
        maxGapMs: (+$('#s-maxGap').value || 120) * 1000,
        typingPerCharMs: [+$('#s-typeMin').value || 45, +$('#s-typeMax').value || 110],
        microPauseEvery: +$('#s-pauseEvery').value || 10,
        dedupWindowMs: (+$('#s-dedupH').value || 24) * 3600 * 1000
      };
      engine.updateSettings(patch);
      fillSettings();
      alert('تم الحفظ ✅');
      app.persist();
    };
    fillSettings();
    renderStats();

    return { onEvent, renderQueue, renderStats, root };
  }

  global.WAO = global.WAO || {};
  global.WAO.ui = { buildUI };
})(typeof window !== 'undefined' ? window : globalThis);
