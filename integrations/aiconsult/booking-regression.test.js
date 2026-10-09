'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const S = require('./index');
test('existing inquiry push preserves legacy and native delivery without duplicate tokens', async () => {
  const payloads = [], messaging = { sendEachForMulticast: async p => { payloads.push(p); } };
  await require('./inquiry-push').sendInquiryPush(messaging, { a: { pushToken: 'legacy', nativePushTokens: { native: { platform: 'android-native', token: 'native' } } }, b: { pushToken: 'native' } }, 'c_example', 'test_message', '가상 상담');
  assert.equal(payloads.length, 2); assert.equal(payloads[0].notification.body, '가상 상담'); assert.deepEqual(payloads[1].tokens, ['native']); assert.equal(payloads[1].data.kind, 'inquiry'); assert.equal(payloads[1].notification, undefined);
});
test('existing AI inquiry saves once, pushes once and exposes only catalog recommendations', async () => {
  let inquiry = null, chats = 0, fetchedPrompt = '';
  const cars = { public: { id: 'sample', name: '가상 차량', category: '소형', status: 'available', rates: { daily: 50000, monthly: 500000 }, example: true, customer: { secret: 'private' } } };
  const ref = path => ({ child: name => ref(path + '/' + name), once: async () => ({ val: () => path.endsWith('/aiSettings') ? { grokKey: 'synthetic-test-key' } : path.endsWith('/profile') ? {} : path.endsWith('/vehicles') ? cars : path.includes('/inquiries/') ? inquiry : {} }), update: async value => { inquiry = { ...inquiry, ...value }; }, push: async () => { chats++; } });
  S.deps.db = { ref }; S.deps.messaging = null; S.deps.now = () => Date.parse('2026-10-09T09:00:00+09:00'); S._hits.clear();
  S.deps.fetch = async (_, init) => { fetchedPrompt = init.body; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '예시 차량을 추천합니다. <<VEHICLES {"ids":["sample","forged"]}>> <<INQUIRY {"name":"가상 고객","phone":"01000000000","kind":"단기렌트","car":"가상 차량","period":"가상 일정"}>>' } }] }) }; };
  async function invoke() { const result = {}; const res = { set: () => {}, status: n => { result.status = n; return res; }, json: body => { result.body = body; }, send: () => {} }; await S.handle({ method: 'POST', get: () => 'https://pang-rent.github.io', headers: {}, ip: 'test', body: { companyId: 'c_example', sessionId: 'session_test', messages: [{ role: 'user', text: '예시 차량 상담' }] } }, res); return result; }
  const a = await invoke(); assert.equal(a.body.firstSubmit, true); assert.equal(chats, 1); assert.equal(a.body.recommendations.length, 1); assert(!a.body.reply.includes('<<')); assert(!fetchedPrompt.includes('private')); assert.equal(inquiry.source, 'homepage');
  const b = await invoke(); assert.equal(b.body.firstSubmit, false); assert.equal(chats, 1);
  assert(S.newcarMonthly(S.NEWCAR_RATES_DEFAULT, 30000000, 48, 26, 0) > 0);
});
