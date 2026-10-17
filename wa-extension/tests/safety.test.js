const { test } = require('node:test');
const assert = require('node:assert');
const safety = require('../src/safety.js');

test('opt-out عربي وإنجليزي', () => {
  assert.strictEqual(safety.isOptOut('إيقاف'), true);
  assert.strictEqual(safety.isOptOut('أوقف الرسائل من فضلك.'), true);
  assert.strictEqual(safety.isOptOut('Stop'), true);
  assert.strictEqual(safety.isOptOut('stop now'), true);
  assert.strictEqual(safety.isOptOut('please unsubscribe, thanks'), true);
  assert.strictEqual(safety.isOptOut('لا أريد استلام رسائل'), true);
  assert.strictEqual(safety.isOptOut('بلاش بعتلي تاني'), true);
});

test('رسائل عادية مش opt-out', () => {
  assert.strictEqual(safety.isOptOut('كام السعر؟'), false);
  assert.strictEqual(safety.isOptOut('تمام ابعتلي التفاصيل'), false);
  assert.strictEqual(safety.isOptOut('stopped working yesterday'), false); // stop ككلمة مستقلة فقط
});

test('تطبيع الأرقام', () => {
  assert.strictEqual(safety.normPhone('+20 100 000 0000'), '201000000000');
  assert.strictEqual(safety.normPhone('00966-50-000-0000'), '966500000000'); // بادئة دولية 00 تُزال
  assert.strictEqual(safety.normPhone('123'), null);
  assert.strictEqual(safety.normPhone('a+b+c+d+e'), null);
});

test('Guard: حد يومي + تسخين', () => {
  const g = new safety.Guard({ dailyCap: 80, warmupStep: 20 });
  assert.strictEqual(g.effectiveCap(), 20); // يوم 1
  for (let i = 0; i < 20; i++) g.recordSend('2' + String(100000000 + i));
  const blocked = g.check('299999999999');
  assert.strictEqual(blocked.allow, false);
  assert.strictEqual(blocked.reason, 'daily_cap');
  // يوم جديد → سقف أعلى
  g.state.activeDays = 5;
  g.state.sentToday = 0;
  assert.strictEqual(g.effectiveCap(), 80);
});

test('Guard: dedup نافذة 24h', () => {
  const g = new safety.Guard({ dailyCap: 80 });
  const now = Date.now();
  g.recordSend('201000000001', now);
  assert.strictEqual(g.check('201000000001', now + 3600 * 1000).reason, 'dedup');
  assert.strictEqual(g.check('201000000001', now + 25 * 3600 * 1000).allow, true);
});

test('Guard: حظر opt-out دائم', () => {
  const g = new safety.Guard();
  g.block('201000000009');
  const r = g.check('201000000009');
  assert.strictEqual(r.allow, false);
  assert.strictEqual(r.reason, 'opted_out');
  g.unblock('201000000009');
  assert.strictEqual(g.check('201000000009').allow, true);
});
