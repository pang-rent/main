'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { service } = require('../service'), { handler } = require('../http');
test('admin date filter excludes unrelated dates; photo API rejects invalid bytes and private signatures stay hidden', async () => {
  let state = { vehicles: { sample: { ...require('../example-data')[0], id: 'sample' } }, bookings: { b: { id: 'b', startMs: Date.parse('2026-10-10T10:00:00+09:00'), endMs: Date.parse('2026-10-11T10:00:00+09:00'), createdAt: 1, customer: { name: '가상', phone: '01000000000' }, signature: 'internal' } } }, photo;
  const store = { read: async () => structuredClone(state), transact: async (_, f) => { state = f(state); return state; }, savePhoto: async (_, id, value) => { photo = value; }, photo: async () => photo };
  const h = handler({ api: service(store), store, origins: [], companies: ['example'], rateLimit: async () => {}, verifyAdmin: async () => 'test', verifyApp: async () => {} });
  async function call(path, method = 'GET', body = {}, date, rawBody) {
    const result = { status: 200, headers: {} }, req = { path, method, body, rawBody, query: { company: 'example', date }, get: () => undefined }, res = { set: (k,v) => { result.headers[k] = v; }, status: n => { result.status = n; return res; }, json: data => { result.data = data; }, send: data => { result.data = data; } }; await h(req,res); return result;
  }
  const a = await call('/admin/bookings', 'GET', {}, '2026-10-10'); assert.equal(a.data.bookings.length, 1); assert.equal(a.data.bookings[0].signature, undefined);
  assert.equal((await call('/admin/bookings', 'GET', {}, '2026-10-12')).data.bookings.length, 0);
  assert.equal((await call('/quote', 'POST', [], undefined)).status, 400);
  assert.equal((await call('/quote', 'POST', {}, undefined, Buffer.alloc(450001))).status, 413);
  assert.equal((await call('/admin/photo', 'POST', { id: 'sample', type: 'image/svg+xml', base64: Buffer.from('<svg></svg>').toString('base64') })).status, 400);
  const bytes = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]);
  assert.equal((await call('/admin/photo', 'POST', { id: 'sample', type: 'image/png', base64: bytes.toString('base64') })).status, 200);
  const p = await call('/photo/sample'); assert.equal(p.headers['Content-Type'], 'image/png'); assert.deepEqual(p.data,bytes);
  state.vehicles.sample.status = 'unavailable'; assert.equal((await call('/photo/sample')).status, 404);
});
