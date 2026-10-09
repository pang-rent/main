'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const D = require('../domain'), { service } = require('../service'), { handler } = require('../http'), { adminGuard } = require('../admin-auth');
const examples = require('../example-data');
const now = Date.parse('2026-10-09T09:00:00+09:00');
const input = () => ({ vehicleId: 'sample-compact', mode: 'daily', start: '2026-10-10T10:00:00+09:00', end: '2026-10-12T10:00:00+09:00', insurance: true, optionIds: [] });
function fixture() {
  let value = { vehicles: Object.fromEntries(examples.map(v => [v.id, structuredClone(v)])), bookings: {} }, lock = Promise.resolve();
  const store = { read: async () => structuredClone(value), transact: async (_, f) => { const work = lock.then(() => { const next = f(structuredClone(value)); value = next; return structuredClone(next); }); lock = work.catch(() => {}); return work; } };
  return { store, api: service(store, () => now) };
}
const customer = () => ({ name: '가상 고객', phone: '01012345678', memo: '', consent: true, consentVersion: '2026-10-booking-v1' });
async function reservation(api, id, overrides = {}) { const p = { ...input(), ...overrides }, q = await api.estimate('example', p); return { ...p, requestId: id, customer: customer(), expectedTotal: q.total, expectedRevision: q.revision }; }
test('weekend/season/insurance/options use authoritative integer totals', () => {
  const v = { ...examples[0], options: [{ id: 'test-option', name: '계산 검증용 옵션', price: 5000, unit: 'daily' }] };
  const selection = { ...input(), optionIds: ['test-option'] }; assert.equal(D.quote(v, selection, now).total, 150000);
  const q = D.quote(v, { ...selection, start: '2026-12-25T10:00:00+09:00', end: '2026-12-26T10:00:00+09:00' }, now); assert.equal(q.total, 85000);
  const monthly = D.quote(v, { ...selection, mode: 'monthly', start: '2026-10-10T10:00:00+09:00', end: '2026-11-09T10:00:00+09:00' }, now); assert.equal(monthly.total, 700000);
});
test('reject invalid calendar dates, reversed/past dates, forged options/keys and fractional prices', () => {
  for (const patch of [{ start: '2026-02-30T10:00:00+09:00' }, { end: '2026-10-10T09:00:00+09:00' }, { optionIds: ['forged'] }]) assert.throws(() => D.quote(examples[0], { ...input(), ...patch }, now));
  assert.throws(() => D.key('__proto__')); assert.throws(() => D.date('2026-99-99'));
  assert.throws(() => D.validateVehicle({ ...examples[0], rates: { ...examples[0].rates, daily: 1.5 } }));
});
test('simultaneous overlap accepts one, retries are idempotent and adjacent periods remain possible', async () => {
  const { api, store } = fixture(), a = await reservation(api, 'a'), b = { ...a, requestId: 'b' };
  const results = await Promise.allSettled([api.submit('example', a), api.submit('example', b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results[0].status === 'fulfilled' ? a : b;
  assert.deepEqual(await api.submit('example', winner), results.find(r => r.status === 'fulfilled').value);
  assert.equal(Object.keys((await store.read()).bookings).length, 1);
  const next = await reservation(api, 'next', { start: input().end, end: '2026-10-13T10:00:00+09:00' }); await api.submit('example', next);
});
test('forged prices, missing consent, changed prices and unavailable inventory cannot be booked', async () => {
  const { api } = fixture(), p = await reservation(api, 'a');
  await assert.rejects(api.submit('example', { ...p, expectedTotal: 1 }), /요금/);
  await assert.rejects(api.submit('example', { ...p, customer: { ...customer(), consent: false } }), /동의/);
  await api.saveVehicle('example', { ...examples[0], expectedRevision: 1, rates: { ...examples[0].rates, daily: 80000 } }, 'owner');
  await assert.rejects(api.submit('example', p), /요금/);
  await api.saveVehicle('example', { ...examples[0], status: 'unavailable', expectedRevision: 2 }, 'owner');
  await assert.rejects(api.estimate('example', input()), /예약 가능한/);
});
test('admin status/delete checks; cancellation frees dates and stale status cannot overwrite', async () => {
  const { api } = fixture(); await api.submit('example', await reservation(api, 'a'));
  await assert.rejects(api.deleteVehicle('example', 'sample-compact', 1, 'owner'), /진행 중/);
  await api.setStatus('example', 'a', 'confirmed', 'pending', 'owner');
  await assert.rejects(api.setStatus('example', 'a', 'cancelled', 'pending', 'owner'), /이미 변경/);
  await api.setStatus('example', 'a', 'cancelled', 'confirmed', 'owner');
  await api.estimate('example', input());
  await assert.rejects(api.setStatus('example', 'a', 'confirmed', 'cancelled', 'owner'), /새로 신청/);
});
test('catalog has no bookings, personal data, actor or internal IDs', async () => {
  const { api } = fixture(); const list = await api.catalog('example');
  assert.deepEqual(Object.keys(list[0]).sort(), ['category','example','id','name','options','photo','photoUrl','rates','revision','seasons'].sort());
});
test('admin guard verifies revoked tokens, current company membership and owner role', async () => {
  const calls = [], auth = { verifyIdToken: async (token, revoked) => { calls.push(revoked); if (token === 'expired') throw Error(); return { uid: token }; } };
  const guard = adminGuard(auth, async (c, uid) => c === 'example' && uid === 'owner' ? { role: 'owner' } : { role: 'staff' });
  const req = token => ({ get: () => token ? 'Bearer ' + token : '' });
  await assert.rejects(guard(req(), 'example'), { status: 401 }); await assert.rejects(guard(req('expired'), 'example'), { status: 401 });
  await assert.rejects(guard(req('staff'), 'example'), { status: 403 }); await assert.rejects(guard(req('owner'), 'another'), { status: 403 });
  assert.equal(await guard(req('owner'), 'example'), 'owner'); assert(calls.every(x => x === true));
});
test('HTTP blocks foreign origins, unauthenticated admin access and missing app verification', async () => {
  const { api, store } = fixture(); let app = false;
  const h = handler({ api, store, origins: ['https://pang-rent.github.io'], companies: ['example'], verifyAdmin: async () => D.fail(403, '관리자 필요'), verifyApp: async () => { if (!app) D.fail(403, '보안 확인 필요'); }, rateLimit: async () => {} });
  async function call(path, origin, method = 'GET', body = {}) { const req = { path, query: { company: 'example' }, method, body, get: k => k === 'Origin' ? origin : undefined }, out = { code: 200, body: null }; const res = { set: () => {}, status: n => { out.code = n; return res; }, json: b => { out.body = b; }, send: () => {} }; await h(req, res); return out; }
  assert.equal((await call('/catalog', 'https://evil.example')).code, 403);
  assert.equal((await call('/admin/bookings', 'https://pang-rent.github.io')).code, 403);
  assert.equal((await call('/bookings', 'https://pang-rent.github.io', 'POST')).code, 403);
  const catalog = await call('/catalog', 'https://pang-rent.github.io'); assert.equal(catalog.code, 200); assert(!JSON.stringify(catalog.body).includes('phone'));
});
