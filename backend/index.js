'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { getAppCheck } = require('firebase-admin/app-check');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { createHash } = require('node:crypto');
const { service } = require('./service');
const { handler } = require('./http');
const D = require('./domain');
const { adminGuard } = require('./admin-auth');
const { databaseStore } = require('./store');
initializeApp();
const db = getDatabase(), store = databaseStore(db);
const verifyAdmin = adminGuard(getAuth(), async (company, uid) => (await db.ref('companies/' + company + '/members/' + uid).get()).val());
async function verifyApp(req) {
  const token = req.get('X-Firebase-AppCheck');
  if (!token) D.fail(403, '예약 보안 확인이 필요합니다. 페이지를 다시 열어주세요.');
  try { await getAppCheck().verifyToken(token); } catch { D.fail(403, '예약 보안 확인에 실패했습니다.'); }
}
async function rateLimit(req, company, kind) {
  const minute = Math.floor(Date.now() / 60000);
  const hash = createHash('sha256').update(company + ':' + minute + ':' + req.ip).digest('hex');
  const result = await db.ref('rentalBookingRate/' + hash).transaction(v => {
    const next = (v?.count || 0) + 1;
    return next > (kind === 'admin' ? 100 : 30) ? undefined : { count: next, expiresAt: Date.now() + 120000 };
  });
  if (!result.committed) D.fail(429, '잠시 후 다시 시도해주세요.');
}
const publicConfig = JSON.parse(process.env.BOOKING_PUBLIC_CONFIG || '{}');
exports.rentalBookingApi = onRequest({ region: 'asia-northeast3', maxInstances: 3, memory: '256MiB', timeoutSeconds: 30 }, handler({
  api: service(store), store, verifyAdmin, verifyApp, rateLimit,
  origins: ['https://pang-rent.github.io', 'https://fleet-board-f2345.web.app', 'https://fleet-board-f2345.firebaseapp.com'],
  companies: (process.env.BOOKING_COMPANIES || 'c_jangsung01').split(','), publicConfig
}));
exports.rentalBookingPrivacyCleanup = onSchedule({ schedule: 'every 24 hours', region: 'asia-northeast3', timeZone: 'Asia/Seoul', maxInstances: 1 }, async () => {
  const companies = (process.env.BOOKING_COMPANIES || 'c_jangsung01').split(','), cutoff = Date.now() - 90 * 86400000;
  for (const company of companies) {
    await store.transact(D.key(company), state => {
      for (const b of Object.values(state.bookings || {})) {
        const ended = b.status === 'cancelled' ? b.updatedAt : b.endMs;
        if (ended < cutoff) { b.customer = { name: '보관기간 종료', phone: '', memo: '', consentVersion: b.customer?.consentVersion || '' }; delete b.signature; b.redacted = true; }
      }
      return state;
    });
  }
  // Bounded batches prevent abuse counters from accumulating indefinitely.
  for (let i = 0; i < 100; i++) {
    const snap = await db.ref('rentalBookingRate').orderByChild('expiresAt').endAt(Date.now()).limitToFirst(500).get();
    if (!snap.exists()) break;
    const changes = {}; snap.forEach(child => { changes[child.key] = null; }); await db.ref('rentalBookingRate').update(changes);
  }
});
