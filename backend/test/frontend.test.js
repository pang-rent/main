'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom'), { handler } = require('../http'), { service } = require('../service');
const root = path.resolve(__dirname, '../..');
function fixture() {
  let state = { vehicles: Object.fromEntries(require('../example-data').map(v => [v.id, structuredClone(v)])), bookings: {} };
  const store = { read: async () => structuredClone(state), transact: async (_, f) => { state = f(structuredClone(state)); return structuredClone(state); } };
  const api = service(store), h = handler({ api, store, origins: [], companies: ['c_jangsung01'], rateLimit: async () => {}, verifyAdmin: async () => 'fake-admin', verifyApp: async () => {} });
  const fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://127.0.0.1:8878'), result = { status: 200 };
    const req = { path: u.pathname.replace(/^\/api/, ''), query: Object.fromEntries(u.searchParams), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : {}, get: () => undefined };
    const res = { set: () => {}, status: n => { result.status = n; return res; }, json: body => { result.body = body; }, send: () => {} }; await h(req, res);
    return { ok: result.status < 400, json: async () => result.body };
  };
  return { fetch, store };
}
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('UI did not reach expected state'); }
function dom(html, fetch) { const d = new JSDOM(html, { url: 'http://127.0.0.1:8878/booking.html', runScripts: 'outside-only' }); d.window.fetch = fetch; d.window.RENTAL_CONFIG = { api: '/api', companyId: 'c_jangsung01', preview: true }; return d; }
test('customer form updates server quote, enforces consent and creates pending reservation', async () => {
  const f = fixture(), d = dom(fs.readFileSync(path.join(root, 'booking.html'), 'utf8'), f.fetch), w = d.window, doc = w.document;
  try {
    w.eval(fs.readFileSync(path.join(root, 'booking.js'), 'utf8')); await until(() => doc.querySelector('#vehicle').options.length === 4);
    const change = (id, value) => { const el = doc.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
    change('vehicle', 'sample-compact'); await until(() => !doc.querySelector('#submit').disabled);
    const first = doc.querySelector('#total').textContent;
    doc.querySelector('#insurance').checked = true; doc.querySelector('#insurance').dispatchEvent(new w.Event('change', { bubbles: true })); await until(() => !doc.querySelector('#submit').disabled);
    assert.notEqual(doc.querySelector('#total').textContent, first);
    doc.querySelector('#customerName').value = '가상 고객'; doc.querySelector('#customerPhone').value = '01000000000';
    doc.querySelector('#bookingForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await until(() => doc.querySelector('#result').textContent.includes('동의'));
    assert.equal(Object.keys((await f.store.read()).bookings).length, 0);
    doc.querySelector('#consent').checked = true; doc.querySelector('#bookingForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await until(() => doc.querySelector('#result').textContent.includes('접수번호'));
    const rows = Object.values((await f.store.read()).bookings); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'pending'); assert(doc.querySelector('#vehicle').disabled);
  } finally { w.close(); }
});
test('admin component edits rates/availability and clears private data when closed', async () => {
  const f = fixture(), d = dom('<body></body>', f.fetch), w = d.window, doc = w.document;
  try {
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.COMPANY_ID = 'c_jangsung01'; w.COMPANY_ROLE = 'owner'; w._auth = { auth: { currentUser: { uid: 'fake-admin', getIdToken: async () => 'fake-token' } } };
    w.eval(fs.readFileSync(path.join(root, 'booking-admin.js'), 'utf8')); await w.openRentalBookingAdmin();
    doc.querySelector('#vehicleTab').click(); await until(() => doc.querySelectorAll('#bookingVehicleList article').length === 3);
    doc.querySelector('#bookingVehicleList button').click(); await until(() => !doc.querySelector('#adminVehicleForm').hidden);
    doc.querySelector('#bv_daily').value = '88000'; doc.querySelector('#bv_status').value = 'unavailable'; doc.querySelector('#adminVehicleForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await until(() => doc.querySelector('#adminVehicleForm').hidden); const v = (await f.store.read()).vehicles['sample-compact']; assert.equal(v.rates.daily, 88000); assert.equal(v.status, 'unavailable');
    doc.querySelector('.booking-admin-head button').click(); assert.equal(doc.querySelector('#bookingVehicleList').textContent, ''); assert.equal(doc.querySelector('#bookingAdminList').textContent, '');
  } finally { w.close(); }
});
test('existing homepage chat overlay and original sections survive with two entry actions', () => {
  const d = dom(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), async () => ({ ok: false })), w = d.window, doc = w.document;
  try {
    for (const script of doc.querySelectorAll('script:not([src])')) w.eval(script.textContent);
    assert(doc.querySelector('a[href="./booking.html"]')); assert(doc.querySelector('#lineup')); assert(doc.querySelector('#chatFrame'));
    w.openChat(); assert(doc.querySelector('#chatSheet').classList.contains('open')); assert(doc.querySelector('#chatFrame').src.includes('c=c_jangsung01'));
    doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert(!doc.querySelector('#chatSheet').classList.contains('open'));
  } finally { w.close(); }
});
