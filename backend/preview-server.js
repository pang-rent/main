'use strict';
// Local preview: fake auth and sample data, no connection to Firebase or real customers.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { handler } = require('./http'), { service } = require('./service'), { fail } = require('./domain');
const root = path.resolve(__dirname, '..'), states = new Map(), photos = new Map(); let lock = Promise.resolve();
const example = require('./example-data');
states.set('c_jangsung01', { schema: 1, vehicles: Object.fromEntries(example.map(v => [v.id, v])), bookings: {} });
const store = {
  async read(c) { return structuredClone(states.get(c) || {}); },
  async transact(c, mutate) { const work = lock.then(() => { const value = mutate(structuredClone(states.get(c) || { schema: 1 })); states.set(c, value); return structuredClone(value); }); lock = work.catch(() => {}); return work; },
  async photo(c, id) { return photos.get(c + ':' + id); }, async savePhoto(c, id, value) { photos.set(c + ':' + id, value); }
};
const api = service(store);
const backend = handler({ api, store, origins: ['http://127.0.0.1:8878'], companies: ['c_jangsung01'],
  verifyAdmin: async req => { if (req.get('Authorization') !== 'Bearer preview-admin') fail(403, '관리자만 사용할 수 있습니다.'); return 'preview-admin'; },
  verifyApp: async req => { if (req.get('X-Firebase-AppCheck') !== 'preview-only') fail(403, '보안 확인 실패'); }, rateLimit: async () => {} });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:8878');
  if (u.pathname === '/ai-preview') {
    for await (const chunk of req) {} // synthetic reply; never forwards customer data to a model
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ reply: '예시 차량 · 소형은 일 50,000원의 예시 요금입니다. 날짜별 요금은 예약 화면에서 확인해주세요.', recommendations: [example[0]] })); return;
  }
  if (u.pathname === '/chat.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(root, 'chat.html'), 'utf8').replace('https://aiconsult-613571323567.asia-northeast3.run.app', '/ai-preview')); return;
  }
  if (u.pathname.startsWith('/api/')) {
    let bytes = 0, chunks = []; for await (const chunk of req) { bytes += chunk.length; if (bytes > 450000) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    let body = {}; try { if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString()); } catch { res.writeHead(400); res.end(); return; }
    const wrapped = { path: u.pathname.slice(4), query: Object.fromEntries(u.searchParams), body, method: req.method, get: h => req.headers[h.toLowerCase()], ip: req.socket.remoteAddress };
    const response = { set: (h, v) => res.setHeader(h, v), status: n => { res.statusCode = n; return response; }, json: v => res.end(JSON.stringify(v)), send: v => res.end(v) };
    await backend(wrapped, response); return;
  }
  if (u.pathname === '/responsive-preview.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const view = { home: '/', admin: '/admin-preview.html' }[u.searchParams.get('view')] || '/booking.html?vehicle=sample-sedan';
    res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>예약 반응형 검증</title><body style="margin:20px;font-family:system-ui;background:#eef2f6"><h1>가상 자료 · 반응형 검증</h1>' + [320,390,768,1280].map(width => '<section style="margin:20px 0"><h2>' + width + 'px</h2><iframe id="mobile' + width + '" title="' + width + 'px 예약 화면" src="' + view + '" style="width:' + width + 'px;height:1000px;border:1px solid #bbb"></iframe></section>').join('') + '</body></html>'); return;
  }
  if (u.pathname === '/booking-config.js') { res.setHeader('Content-Type', 'application/javascript'); res.end("window.RENTAL_CONFIG={companyId:'c_jangsung01',api:'/api',preview:true};"); return; }
  if (u.pathname === '/admin-preview.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="booking-admin.css"><script src="booking-config.js"></script><script src="booking-admin.js" defer></script><body><main class="booking-wrap"><h1>관리자 예약·차량 관리 시안</h1><p class="booking-note">가상 자료 · 이 브라우저에서만 확인합니다. 실제 계정·예약·고객 데이터와 연결되지 않습니다.</p><button class="booking-primary" onclick="openRentalBookingAdmin()">예약·차량 관리 열기</button></main><script>window.COMPANY_ID="c_jangsung01";window.COMPANY_ROLE="owner";window._auth={auth:{currentUser:{getIdToken:async()=>"preview-admin"}}};</script>'); return;
  }
  const file = path.resolve(root, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
  if (!file.startsWith(root + path.sep) || /[\\/]backend[\\/]|[\\/]\.git[\\/]/.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8'); res.end(fs.readFileSync(file));
});
server.listen(8878, '127.0.0.1', () => console.log('Synthetic preview http://127.0.0.1:8878/'));
