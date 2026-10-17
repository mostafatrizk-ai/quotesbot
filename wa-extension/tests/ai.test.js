const { test } = require('node:test');
const assert = require('node:assert');
const safety = require('../src/safety.js');
global.window = global; // لملفات IIFE تعتمد على global
require('../src/ai.js');
const { AIAgent } = global.WAO.ai;

test('offline classification يعمل بدون مفتاح', () => {
  const a = new AIAgent();
  assert.strictEqual(a.available, false);
  assert.strictEqual(a._keywordClassify('كام السعر؟'), 'interested');
  assert.strictEqual(a._keywordClassify('إيقاف'), 'opt_out');
  assert.strictEqual(a._keywordClassify('ازاي الاشتراك؟'), 'question');
  assert.strictEqual(a._keywordClassify('تمام ماشي'), 'interested');
});

test('classifyReply offline path', async () => {
  const a = new AIAgent();
  const r = await a.classifyReply('لا أريد رسائل شكرا');
  assert.strictEqual(r.label, 'opt_out');
  assert.strictEqual(r.source, 'offline');
});

test('suggestReply/improveTemplate يعيدان null بدون AI', async () => {
  const a = new AIAgent();
  assert.strictEqual(await a.suggestReply('hi', 'tpl', {}), null);
  assert.strictEqual(await a.improveTemplate('text'), null);
});

test('shouldContact default go=true بدون AI', async () => {
  const a = new AIAgent();
  const r = await a.shouldContact({ name: 'x' }, '');
  assert.strictEqual(r.go, true);
});
