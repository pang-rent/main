'use strict';
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { databaseStore } = require('../store'), { service } = require('../service');
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9012') throw Error('Emulator only: refusing non-local database');
const namespace = 'demo-pang-booking-default-rtdb';
const app = initializeApp({ projectId: 'demo-pang-booking', databaseURL: 'https://' + namespace + '.firebaseio.com' });
const db = getDatabase(app), store = databaseStore(db), api = service(store);
(async () => {
  try {
    const v = require('../example-data')[0]; await api.saveVehicle('example', v, 'emulator-admin');
    const empty = { ...v, id: 'empty-options', seasons: [], options: [] }; await api.saveVehicle('example', empty, 'emulator-admin');
    const day = new Date(Date.now() + 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    const p = { vehicleId: v.id, mode: 'daily', start: day + 'T10:00:00+09:00', end: day + 'T12:00:00+09:00', insurance: false, optionIds: [] };
    const q = await api.estimate('example', p), request = { ...p, expectedTotal: q.total, expectedRevision: q.revision, customer: { name: '가상 고객', phone: '01012345678', consent: true, consentVersion: '2026-10-booking-v1' } };
    await api.estimate('example', { ...p, vehicleId: empty.id });
    const publicEmpty = (await api.catalog('example')).find(v => v.id === empty.id); assert.deepEqual(publicEmpty.options, []); assert.deepEqual(publicEmpty.seasons, []);
    const results = await Promise.allSettled(['a', 'b'].map(requestId => api.submit('example', { ...request, requestId })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(Object.keys((await store.read('example')).bookings).length, 1);
    const winner = results[0].status === 'fulfilled' ? 'a' : 'b';
    const again = await api.submit('example', { ...request, requestId: winner }); assert.equal(again.reference, results.find(r => r.status === 'fulfilled').value.reference);
    assert.equal(Object.keys((await store.read('other')).bookings || {}).length, 0);
    for (const path of ['rentalBookingPrivate/example', 'rentalBookingPhotos/example', 'rentalBookingRate']) {
      const res = await fetch('http://127.0.0.1:9012/' + path + '.json?ns=' + namespace); assert.equal(res.status, 401, path + ' should deny anonymous reads');
      const write = await fetch('http://127.0.0.1:9012/' + path + '.json?ns=' + namespace, { method: 'PUT', body: JSON.stringify({ injected: true }) }); assert.equal(write.status, 401, path + ' should deny direct writes');
    }
    console.log('PASS real RTDB transactions: one concurrent winner, idempotency, tenant isolation, private-path read/write denial');
  } finally { await deleteApp(app); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
