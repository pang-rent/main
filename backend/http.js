'use strict';
const D = require('./domain');
function handler({ api, store, verifyAdmin, verifyApp, rateLimit, origins, companies, publicConfig = {} }) {
  return async (req, res) => {
    const origin = req.get('Origin');
    res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
    if (origin && !origins.includes(origin)) return res.status(403).json({ error: '허용되지 않은 사이트입니다.' });
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin'); }
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Firebase-AppCheck');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).send('');
    try {
      const company = D.key(req.query.company);
      if (!companies.includes(company)) D.fail(404, '온라인 예약이 준비되지 않은 영업소입니다.');
      const path = req.path.replace(/\/$/, '') || '/', body = req.body || {};
      if (Number(req.get('Content-Length')) > 450000 || (req.rawBody?.length || 0) > 450000) D.fail(413, '파일 또는 요청이 너무 큽니다.');
      if (typeof body !== 'object' || Array.isArray(body)) D.fail(400, '잘못된 요청 형식입니다.');
      const privateRoute = path.startsWith('/admin/');
      let actor;
      if (privateRoute) actor = await verifyAdmin(req, company);
      await rateLimit(req, company, privateRoute ? 'admin' : 'public');
      if (req.method === 'GET' && path === '/catalog') return res.json({ vehicles: await api.catalog(company), config: publicConfig });
      if (req.method === 'GET' && /^\/photo\/[A-Za-z0-9_-]+$/.test(path)) {
        const id = D.key(path.slice(7));
        if (!(await api.catalog(company)).some(v => v.id === id && v.photo)) D.fail(404, '사진이 없습니다.');
        const photo = await store.photo(company, id);
        if (!photo) D.fail(404, '사진이 없습니다.');
        res.set('Content-Type', photo.type); res.set('Content-Security-Policy', "default-src 'none'");
        return res.send(Buffer.from(photo.base64, 'base64'));
      }
      if (req.method === 'POST' && path === '/quote') return res.json(await api.estimate(company, body));
      if (req.method === 'POST' && path === '/bookings') {
        await verifyApp(req);
        return res.status(201).json(await api.submit(company, body));
      }
      if (req.method === 'GET' && path === '/admin/vehicles') {
        const s = await store.read(company); return res.json({ vehicles: Object.values(s.vehicles || {}).filter(v => !v.deleted) });
      }
      if (req.method === 'POST' && path === '/admin/vehicles') {
        await api.saveVehicle(company, body, actor);
        return res.json({ ok: true });
      }
      if (req.method === 'DELETE' && path === '/admin/vehicles') {
        await api.deleteVehicle(company, D.key(body.id), body.expectedRevision, actor); return res.json({ ok: true });
      }
      if (req.method === 'POST' && path === '/admin/photo') {
        const id = D.key(body.id), bytes = Buffer.from(body.base64 || '', 'base64');
        const type = body.type;
        const magic = type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
          type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : false;
        if (!magic || bytes.length > 300000 || bytes.length < 16) D.fail(400, '사진은 300KB 이하 JPEG·PNG만 가능합니다.');
        const s = await store.read(company); if (!s.vehicles?.[id] || s.vehicles[id].deleted) D.fail(404, '차량을 먼저 저장해주세요.');
        await store.savePhoto(company, id, { type, base64: bytes.toString('base64') });
        await store.transact(company, s => { const v = s.vehicles?.[id]; if (!v || v.deleted) D.fail(409, '차량이 변경됐습니다.'); v.photo = true; v.revision++; return s; });
        return res.json({ ok: true });
      }
      if (req.method === 'GET' && path === '/admin/bookings') {
        const day = req.query.date ? D.date(req.query.date) : null;
        const from = day ? Date.parse(day + 'T00:00:00+09:00') : 0;
        const list = Object.values((await store.read(company)).bookings || {}).filter(b => !day || b.startMs < from + 86400000 && b.endMs > from).sort((a, b) => b.createdAt - a.createdAt);
        return res.json({ bookings: list.map(({ signature, ...b }) => b) });
      }
      if (req.method === 'POST' && path === '/admin/status') {
        await api.setStatus(company, D.key(body.id), body.status, body.expectedStatus, actor); return res.json({ ok: true });
      }
      D.fail(404, '요청한 기능을 찾을 수 없습니다.');
    } catch (error) {
      if (error instanceof D.BookingError) return res.status(error.status).json({ error: error.message });
      // Do not log request bodies, customer data, tokens or database snapshots.
      console.error('booking_api_internal_error');
      return res.status(500).json({ error: '잠시 후 다시 시도해주세요.' });
    }
  };
}
module.exports = { handler };
