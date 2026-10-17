const { test } = require('node:test');
const assert = require('node:assert');
const safety = require('../src/safety.js');
const { Engine } = require('../src/engine.js');

/** wa adapter وهمي يسجل الاستدعاءات بدل DOM */
function fakeWa() {
  const calls = [];
  return {
    calls,
    async ensureChat(p) { calls.push(['chat', p]); },
    async typeHuman(t, ms) { calls.push(['type', t.length]); },
    async pressSend() { calls.push(['send']); }
  };
}

test('renderTemplate يستبدل المتغيرات', () => {
  const e = new Engine({ safety });
  e.template = 'مرحبًا {{name}}، عرض في {{city}}';
  assert.strictEqual(e.renderTemplate({ name: 'أحمد', vars: { city: 'القاهرة' } }), 'مرحبًا أحمد، عرض في القاهرة');
});

test('addContacts ينظف ويزيل التكرار', () => {
  const e = new Engine({ safety });
  const n = e.addContacts([
    { phone: '+20 100 000 0001', name: 'أ' },
    { phone: '201000000001', name: 'مكرر' },
    { phone: 'bad', name: 'x' },
    { phone: '+966500000002', name: 'ب' }
  ]);
  assert.strictEqual(n, 2);
  assert.strictEqual(e.queue[0].phone, '201000000001');
});

test('importCsv يحوّل الأعمدة لمتغيرات', () => {
  const e = new Engine({ safety });
  const n = e.importCsv('phone,name,city\n+201000000005,خالد,جدة');
  assert.strictEqual(n, 1);
  assert.strictEqual(e.queue[0].vars.city, 'جدة');
});

test('start بدون قالب أو جهات يفشل بأمان', () => {
  const e = new Engine({ safety, wa: fakeWa() });
  assert.strictEqual(e.start(), false);
  e.template = 'hi {{name}}';
  assert.strictEqual(e.start(), false);
});

test('دورة إرسال كاملة مع فترات قصيرة للاختبار', async () => {
  const wa = fakeWa();
  const events = [];
  const e = new Engine({
    safety, wa,
    settings: { minGapMs: 10, maxGapMs: 30, typingPerCharMs: [1, 2], sessionMax: 5, microPauseEvery: 100 },
    onEvent: ev => events.push(ev.type)
  });
  e._firstDelayMs = 5;
  e.template = 'مرحبًا {{name}}';
  e.addContacts([{ phone: '201000000010', name: 'س' }, { phone: '201000000011', name: 'ص' }]);
  assert.strictEqual(e.start(), true);
  await new Promise(r => setTimeout(r, 1200));
  e.pause('end');
  assert.ok(events.includes('sent'), 'events: ' + events.join(','));
  assert.strictEqual(e.guard.stats().sent_today, 2);
  assert.strictEqual(wa.calls.filter(c => c[0] === 'send').length, 2);
});

test('daily_cap يعيد الاتصال للطابور ويوقف', async () => {
  const wa = fakeWa();
  const events = [];
  const e = new Engine({
    safety, wa,
    settings: { dailyCap: 80, warmupStep: 1, minGapMs: 10, maxGapMs: 20, typingPerCharMs: [1, 2] },
    onEvent: ev => events.push(ev.type)
  });
  e._firstDelayMs = 5;
  e.template = 'x';
  e.addContacts([{ phone: '201000000020' }, { phone: '201000000021' }]);
  e.start();
  await new Promise(r => setTimeout(r, 800));
  // يوم 1 سقفه 1 رسالة → الثانية ترجع للطابور والحملة تتوقف بـ pause
  assert.strictEqual(e.running, false);
  assert.strictEqual(e.queue.length, 1);
  assert.ok(events.includes('pause'));
});

test('dedup يتخطى الرقم المكرر近期', async () => {
  const wa = fakeWa();
  const events = [];
  const e = new Engine({
    safety, wa,
    settings: { minGapMs: 5, maxGapMs: 15, typingPerCharMs: [1, 2], dedupWindowMs: 60 * 1000 },
    onEvent: ev => events.push(ev.type)
  });
  e.template = 'x';
  e._firstDelayMs = 5;
  e.guard.recordSend('201000000030'); // أُرسل قبل قليل من حملة أخرى
  e.addContacts([{ phone: '201000000030' }]);
  e.start();
  await new Promise(r => setTimeout(r, 400));
  assert.ok(events.includes('skip'), 'events: ' + events.join(','));
});
