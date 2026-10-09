'use strict';
(async function () {
  const cfg = window.RENTAL_CONFIG, $ = id => document.getElementById(id), money = n => Number(n).toLocaleString('ko-KR') + '원';
  let vehicles = [], quote = null, sequence = 0, timer, submitting = false, securityReady = false, requestId = crypto.randomUUID();
  async function api(path, body, appToken) {
    const res = await fetch(cfg.api + path + '?company=' + encodeURIComponent(cfg.companyId), { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(appToken ? { 'X-Firebase-AppCheck': appToken } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || '연결에 실패했습니다.'); return data;
  }
  let getAppToken;
  async function security(config) {
    if (cfg.preview === true && /^https?:\/\/(127\.0\.0\.1|localhost):/.test(location.origin)) { securityReady = true; return async () => 'preview-only'; }
    if (!config.firebase || !config.recaptchaSiteKey) { $('result').textContent = '온라인 예약 보안 설정이 준비 중입니다. 요금 확인 후 전화로 문의해주세요.'; return async () => { throw new Error('온라인 예약 보안 설정이 준비 중입니다. 전화로 문의해주세요.'); }; }
    const [{ initializeApp }, { initializeAppCheck, ReCaptchaV3Provider, getToken }] = await Promise.all([import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'), import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-check.js')]);
    const check = initializeAppCheck(initializeApp(config.firebase, 'pang-rental-booking'), { provider: new ReCaptchaV3Provider(config.recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
    securityReady = true;
    return async () => (await getToken(check, false)).token;
  }
  function input() { return { vehicleId: $('vehicle').value, mode: document.querySelector('[name=mode]:checked').value, start: $('start').value + ':00+09:00', end: $('end').value + ':00+09:00', insurance: $('insurance').checked, optionIds: [...document.querySelectorAll('[name=option]:checked')].map(x => x.value) }; }
  function updateVehicle() {
    const v = vehicles.find(v => v.id === $('vehicle').value); $('vehicleInfo').replaceChildren(); $('options').replaceChildren();
    if (!v) return;
    if (v.photo || v.photoUrl) { const img = new Image(); img.alt = v.name; img.referrerPolicy = 'no-referrer'; img.src = v.photo ? cfg.api + '/photo/' + encodeURIComponent(v.id) + '?company=' + encodeURIComponent(cfg.companyId) + '&v=' + v.revision : v.photoUrl; $('vehicleInfo').append(img); }
    const note = document.createElement('span'); note.textContent = `${v.category} · 일 ${money(v.rates.daily)} / 월 ${money(v.rates.monthly)}${v.example ? ' · 예시 요금' : ''}`; $('vehicleInfo').append(note);
    for (const o of v.options) { const label = document.createElement('label'); label.className = 'booking-check'; const box = document.createElement('input'); box.type = 'checkbox'; box.name = 'option'; box.value = o.id; label.append(box, document.createTextNode(o.name + ' ' + money(o.price) + (o.unit === 'daily' ? '/일' : '/회'))); $('options').append(label); }
  }
  function invalidate() { quote = null; $('submit').disabled = true; $('total').textContent = '—'; $('breakdown').hidden = true; $('example').hidden = true; }
  async function calculate() {
    const seq = ++sequence; invalidate();
    if (!$('vehicle').value || !$('start').value || !$('end').value) return;
    $('quoteStatus').textContent = '예상 요금 확인 중…';
    try { const q = await api('/quote', input()); if (seq !== sequence) return; quote = q;
      $('quoteStatus').textContent = q.days + '일 · ' + q.vehicleName; $('total').textContent = money(q.total); $('example').hidden = !q.example;
      const dl = document.createElement('dl'); for (const [label, n] of [['대여 요금', q.rental], ['보험료', q.insuranceCost], ['옵션', q.optionsCost]]) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = money(n); dl.append(dt, dd); } $('breakdown').replaceChildren(dl); $('breakdown').hidden = false; $('submit').disabled = submitting || !securityReady;
    } catch (error) { if (seq === sequence) $('quoteStatus').textContent = error.message; }
  }
  $('bookingForm').addEventListener('change', e => { if (e.target.id === 'vehicle') updateVehicle(); if (['vehicle', 'start', 'end', 'insurance'].includes(e.target.id) || ['mode', 'option'].includes(e.target.name)) { sequence++; invalidate(); clearTimeout(timer); timer = setTimeout(calculate, 350); } });
  $('bookingForm').addEventListener('submit', async e => {
    e.preventDefault(); if (!quote || submitting) return; submitting = true; $('submit').disabled = true; $('result').textContent = '접수 중…';
    try {
      const token = await getAppToken(); const d = await api('/bookings', { ...input(), requestId, expectedTotal: quote.total, expectedRevision: quote.revision, customer: { name: $('customerName').value, phone: $('customerPhone').value, memo: $('memo').value, consent: $('consent').checked, consentVersion: '2026-10-booking-v1' } }, token);
      $('result').textContent = `예약 신청이 접수됐습니다. 접수번호 ${d.reference}. 담당자가 확인 후 연락드립니다. 아직 예약 확정 상태는 아닙니다.`;
      $('submit').textContent = '예약 신청 접수 완료'; $('bookingForm').querySelectorAll('input,select,textarea').forEach(x => x.disabled = true); quote = null;
    } catch (error) { $('result').textContent = error.message; } finally { submitting = false; $('submit').disabled = !quote; }
  });
  try {
    const data = await api('/catalog'); vehicles = data.vehicles; getAppToken = await security(data.config || {});
    $('previewNotice').hidden = !cfg.preview; $('vehicle').replaceChildren(new Option('차량을 선택해주세요', ''));
    for (const v of vehicles) $('vehicle').append(new Option(v.name + (v.example ? ' (예시 요금)' : ''), v.id));
    if (!vehicles.length) $('quoteStatus').textContent = '온라인 차량 등록을 준비 중입니다. 전화로 문의해주세요.';
    const params = new URLSearchParams(location.search); if (vehicles.some(v => v.id === params.get('vehicle'))) { $('vehicle').value = params.get('vehicle'); updateVehicle(); }
    const tomorrow = new Date(Date.now() + 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    $('start').min = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16); $('start').value = tomorrow + 'T10:00'; $('end').value = new Date(Date.parse(tomorrow + 'T10:00:00+09:00') + 86400000 + 9 * 3600000).toISOString().slice(0, 16); if ($('vehicle').value) calculate();
  } catch (error) { $('vehicle').replaceChildren(new Option('온라인 예약 준비 중', '')); $('quoteStatus').textContent = error.message; }
})();
