/* ============================================================
   WA Outreach Pro — Content Script Entry: يربط كل الوحدات
   ============================================================ */
(function () {
  'use strict';
  const W = window.WAO;
  if (!W || !W.safety) return;

  // منع التكرار لو الصفحة أعادت الحقن
  if (document.getElementById('wao-panel')) return;

  const app = {};

  app.engine = new W.engine.Engine({
    safety: W.safety,
    wa: W.wa,
    onEvent: ev => { if (app.ui) app.ui.onEvent(ev); broadcast(ev); }
  });

  app.ai = new W.ai.AIAgent();
  app.watchdog = new W.watchdog.Watchdog({
    wa: W.wa, safety: W.safety, engine: app.engine, ai: app.ai,
    onEvent: ev => { if (app.ui) app.ui.onEvent(ev); }
  });

  function broadcast(ev) {
    try {
      chrome.runtime.sendMessage({ type: 'wao-event', payload: { ...ev, running: app.engine.running, stats: app.engine.stats() } });
    } catch (e) { /* popup مقفول */ }
  }

  // حفظ/استرجاع الحالة من storage
  app.persist = () => {
    try {
      chrome.storage.local.set({
        wao_state: {
          template: app.engine.template,
          queue: app.engine.queue,
          guard: app.engine.dumpState(),
          settings: app.engine.settings,
          ai: app.ai.cfg
        }
      });
    } catch (e) {}
  };

  function restore(cb) {
    try {
      chrome.storage.local.get(['wao_state'], (r) => {
        const s = r && r.wao_state;
        if (s) {
          if (s.template) app.engine.template = s.template;
          if (Array.isArray(s.queue)) app.engine.queue = s.queue;
          if (s.guard) app.engine.loadState(s.guard);
          if (s.settings) app.engine.updateSettings(s.settings);
          if (s.ai) app.ai.updateConfig(s.ai);
        }
        cb();
      });
    } catch (e) { cb(); }
  }

  function boot() {
    restore(() => {
      app.ui = W.ui.buildUI(app);
      app.ui.renderQueue();
      app.watchdog.start();
      // حفظ دوري للحارس حتى لو المستخدم قفل اللسان
      setInterval(app.persist, 15000);
      // أوامر من الـ popup
      try {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg.type === 'wao-cmd') {
            if (msg.cmd === 'pause') app.engine.pause('من النافذة المنبثقة');
            if (msg.cmd === 'estop') app.engine.emergencyStop('أمر مستخدم من النافذة');
            if (msg.cmd === 'stats-ping') chrome.runtime.sendMessage({ type: 'wao-stats', stats: app.engine.stats() });
          }
        });
      } catch (e) {}
    });
  }

  // ننتظر واتساب ويب يجهز قبل بناء اللوحة
  W.wa.waitReady(60000).then(boot).catch(() => {
    setTimeout(boot, 8000); // حتى لو لسه على شاشة QR — اللوحة تظهر وتشتغل بعدين
  });
})();
