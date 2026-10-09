'use strict';
(function () {
  const cfg = window.RENTAL_CONFIG, money = n => Number(n).toLocaleString('ko-KR') + '원';
  let dialog, vehicles = [], current = null;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  async function api(path, body, method) {
    const user = window._auth?.auth?.currentUser;
    if (!user || !window.COMPANY_ID) throw new Error('현황판에 먼저 로그인해주세요.');
    const company = window.COMPANY_ID, uid = user.uid;
    const token = await user.getIdToken();
    const res = await fetch(cfg.api + path + (path.includes('?') ? '&' : '?') + 'company=' + encodeURIComponent(window.COMPANY_ID), { method: method || (body ? 'POST' : 'GET'), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || '처리하지 못했습니다.');
    if (window._auth?.auth?.currentUser?.uid !== uid || window.COMPANY_ID !== company || window.COMPANY_ROLE !== 'owner') throw new Error('로그인 상태가 변경됐습니다.');
    return data;
  }
  const $ = id => dialog.querySelector('#' + id);
  function ask(message) {
    return new Promise(resolve => {
      const box = el('dialog', null, 'booking-admin-dialog');
      const body = el('div', null, 'booking-admin-body'); body.append(el('p', message));
      let answered = false;
      const finish = value => { if (answered) return; answered = true; box.close(); box.remove(); resolve(value); };
      for (const [title, value] of [['확인', true], ['돌아가기', false]]) {
        const b = el('button', title); b.type = 'button'; b.onclick = () => finish(value); body.append(b);
      }
      box.append(body); document.body.append(box); box.addEventListener('cancel', e => { e.preventDefault(); finish(false); }); box.showModal();
    });
  }

  async function run(action) { $('bookingAdminError').textContent = ''; try { await action(); } catch (e) { $('bookingAdminError').textContent = e.message; } }
  function button(text, action, cls) { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => run(action); return b; }
  async function loadBookings() {
    const day = $('bookingAdminDate').value;
    const data = await api('/admin/bookings' + (day ? '?date=' + encodeURIComponent(day) : ''));
    if (!dialog.open) return;
    // Customer data is available only through the authenticated backend.
    const list = $('bookingAdminList'); list.replaceChildren();
    if (!data.bookings.length) list.append(el('p', '조회된 예약이 없습니다.'));
    for (const b of data.bookings) {
      const row = el('article', null, 'booking-admin-row');
      row.append(el('strong', b.vehicleName + ' · ' + ({ pending: '확인 대기', confirmed: '확정', cancelled: '취소' }[b.status] || b.status)));
      row.append(el('p', b.start.slice(0, 16).replace('T', ' ') + ' → ' + b.end.slice(0, 16).replace('T', ' ')));
      row.append(el('p', b.customer.name + ' · ' + b.customer.phone + ' · ' + money(b.total) + (b.example ? ' (예시 요금)' : '')));
      if (b.customer.memo) row.append(el('p', b.customer.memo));
      row.append(el('small', '접수번호 ' + b.reference));
      if (b.status === 'pending') row.append(button('예약 확정', async () => { if (!await ask('고객과 요금·일정을 확인한 뒤 확정해주세요. 확정하시겠습니까?')) return; await api('/admin/status', { id: b.id, status: 'confirmed', expectedStatus: b.status }); await loadBookings(); }, 'confirm'));
      if (b.status !== 'cancelled') row.append(button('예약 취소', async () => { if (!await ask('이 예약을 취소하시겠습니까?')) return; await api('/admin/status', { id: b.id, status: 'cancelled', expectedStatus: b.status }); await loadBookings(); }, 'cancel'));
      list.append(row);
    }
  }
  function addSeason(start = '', end = '') {
    const row = el('div', null, 'booking-admin-grid'); const a = el('input'), b = el('input'); a.type = b.type = 'date'; a.value = start; b.value = end; a.setAttribute('aria-label', '성수기 시작'); b.setAttribute('aria-label', '성수기 종료'); row.append(a, b, button('구간 삭제', async () => row.remove())); $('bookingSeasons').append(row);
  }
  function addOption(o = {}) {
    const row = el('div', null, 'booking-admin-grid'); row.dataset.optionId = o.id || crypto.randomUUID();
    const name = el('input'), price = el('input'), unit = el('select'); name.placeholder = '옵션 이름'; name.setAttribute('aria-label', '옵션 이름'); name.value = o.name || ''; price.type = 'number'; price.min = 0; price.placeholder = '옵션 요금 (원)'; price.setAttribute('aria-label', '옵션 요금'); price.value = o.price || 0; unit.append(new Option('예약 1회', 'once'), new Option('1일당', 'daily')); unit.value = o.unit || 'once'; unit.setAttribute('aria-label', '옵션 과금 단위'); row.append(name, price, unit, button('옵션 삭제', async () => row.remove())); $('bookingOptions').append(row);
  }
  function edit(v) {
    current = v || null; $('adminVehicleForm').hidden = false;
    for (const k of ['name', 'category', 'photoUrl']) $('bv_' + k).value = v?.[k] || '';
    for (const k of ['daily', 'monthly', 'weekendDaily', 'seasonDaily', 'insuranceDaily', 'insuranceMonthly']) $('bv_' + k).value = v?.rates[k] || 0;
    $('bv_status').value = v?.status || 'available'; $('bv_example').checked = v ? v.example : true; $('bv_photoFile').value = '';
    $('bookingSeasons').replaceChildren(); for (const s of v?.seasons || []) addSeason(s.start, s.end);
    $('bookingOptions').replaceChildren(); for (const o of v?.options || []) addOption(o);
    $('adminVehicleForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function loadVehicles() {
    vehicles = (await api('/admin/vehicles')).vehicles; if (!dialog.open) return; const list = $('bookingVehicleList'); list.replaceChildren();
    for (const v of vehicles) { const row = el('article', null, 'booking-admin-row'); row.append(el('strong', v.name + ' · ' + (v.status === 'available' ? '예약 가능' : '예약 불가')), el('p', '일 ' + money(v.rates.daily) + ' / 월 ' + money(v.rates.monthly) + (v.example ? ' · 예시 요금' : ''))); row.append(button('차량·요금 수정', async () => edit(v)), button('차량 삭제', async () => { if (!await ask('차량을 삭제하시겠습니까? 진행 중 예약이 있으면 삭제되지 않습니다.')) return; await api('/admin/vehicles', { id: v.id, expectedRevision: v.revision }, 'DELETE'); await loadVehicles(); })); list.append(row); }
  }
  async function photoData(file) {
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10000000) throw new Error('사진은 10MB 이하 JPEG·PNG를 선택해주세요.');
    const bitmap = await createImageBitmap(file), canvas = document.createElement('canvas'), ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height)); canvas.width = Math.round(bitmap.width * ratio); canvas.height = Math.round(bitmap.height * ratio); canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const base64 = canvas.toDataURL('image/jpeg', .65).split(',')[1]; if (base64.length > 400000) throw new Error('사진 용량이 큽니다. 작은 사진을 선택해주세요.'); return { type: 'image/jpeg', base64 };
  }
  async function save(e) {
    e.preventDefault(); await run(async () => {
      const id = current?.id || crypto.randomUUID(), input = { id, expectedRevision: current?.revision, status: $('bv_status').value, example: $('bv_example').checked, photo: current?.photo || false, rates: {}, seasons: [], options: [] };
      for (const k of ['name', 'category', 'photoUrl']) input[k] = $('bv_' + k).value;
      for (const k of ['daily', 'monthly', 'weekendDaily', 'seasonDaily', 'insuranceDaily', 'insuranceMonthly']) input.rates[k] = Number($('bv_' + k).value);
      input.seasons = [...$('bookingSeasons').children].map(row => ({ start: row.querySelectorAll('input')[0].value, end: row.querySelectorAll('input')[1].value }));
      input.options = [...$('bookingOptions').children].map(row => ({ id: row.dataset.optionId, name: row.querySelectorAll('input')[0].value, price: Number(row.querySelectorAll('input')[1].value), unit: row.querySelector('select').value }));
      // Compress/validate before saving so invalid files do not partially create a car.
      const file = $('bv_photoFile').files[0], photo = file ? await photoData(file) : null;
      await api('/admin/vehicles', input);
      if (photo) await api('/admin/photo', { id, ...photo });
      $('adminVehicleForm').hidden = true; await loadVehicles();
    });
  }
  function create() {
    dialog = el('dialog', null, 'booking-admin-dialog'); dialog.id = 'rentalBookingAdmin';
    const head = el('div', null, 'booking-admin-head'); head.append(el('strong', '홈페이지 예약 · 차량 관리'), button('닫기', async () => { dialog.close(); $('bookingAdminList').replaceChildren(); $('bookingVehicleList').replaceChildren(); })); dialog.append(head);
    const body = el('div', null, 'booking-admin-body');
    body.innerHTML = '<p id="bookingAdminError" role="status" class="booking-admin-error"></p><div class="booking-tabs"><button type="button" id="bookingTab">예약 목록</button><button type="button" id="vehicleTab">차량·요금 관리</button></div><section id="bookingListSection"><label>대여 중인 날짜 <input id="bookingAdminDate" type="date"></label><button type="button" id="bookingRefresh">조회 · 새로고침</button><div id="bookingAdminList"></div></section><section id="bookingVehicleSection" hidden><button type="button" id="bookingAddVehicle">＋ 차량 추가</button><div id="bookingVehicleList"></div><form id="adminVehicleForm" class="booking-panel" hidden><h2>차량·요금 수정</h2><div id="vehicleFields" class="booking-admin-grid"></div><label class="booking-check"><input id="bv_example" type="checkbox">예시 요금 (실제 요금 확정 전)</label><h3>성수기 구간</h3><div id="bookingSeasons"></div><button type="button" id="bookingAddSeason">＋ 성수기 구간</button><h3>추가 옵션</h3><div id="bookingOptions"></div><button type="button" id="bookingAddOption">＋ 옵션</button><p>공개 홈페이지용 차량 이름을 사용하세요. 고객 정보·내부 메모·번호판은 사진과 차량 이름에 넣지 마세요.</p><button class="booking-primary" type="submit">차량·요금 저장</button></form></section>';
    dialog.append(body); document.body.append(dialog);
    const fields = [['name', '공개 차량 이름', 'text'], ['category', '차급', 'text'], ['daily', '일일 요금 (원)', 'number'], ['monthly', '30일 월요금 (원)', 'number'], ['weekendDaily', '주말 일요금 (0: 기본요금)', 'number'], ['seasonDaily', '성수기 일요금 (0: 기본요금)', 'number'], ['insuranceDaily', '일 보험료 (원)', 'number'], ['insuranceMonthly', '30일 보험료 (원)', 'number'], ['photoUrl', '차량 사진 HTTPS 주소 (선택)', 'url'], ['photoFile', '또는 사진 파일', 'file']];
    for (const [key, title, type] of fields) { const label = el('label', title), input = el('input'); input.id = 'bv_' + key; input.type = type; if (type === 'number') { input.min = 0; input.required = true; } if (key === 'name') input.required = true; if (type === 'file') input.accept = 'image/jpeg,image/png'; label.append(input); $('vehicleFields').append(label); }
    const label = el('label', '예약 가능 상태'), select = el('select'); select.id = 'bv_status'; select.append(new Option('예약 가능', 'available'), new Option('예약 불가', 'unavailable')); label.append(select); $('vehicleFields').append(label);
    $('bookingTab').onclick = () => { $('bookingListSection').hidden = false; $('bookingVehicleSection').hidden = true; run(loadBookings); };
    $('vehicleTab').onclick = () => { $('bookingListSection').hidden = true; $('bookingVehicleSection').hidden = false; run(loadVehicles); };
    $('bookingRefresh').onclick = () => run(loadBookings); $('bookingAddVehicle').onclick = () => edit(null); $('bookingAddSeason').onclick = () => addSeason(); $('bookingAddOption').onclick = () => addOption(); $('adminVehicleForm').onsubmit = save;
    dialog.addEventListener('close', () => { $('bookingAdminList').replaceChildren(); $('bookingVehicleList').replaceChildren(); current = null; $('adminVehicleForm').reset(); });
  }
  // Keep tokens in the existing auth session; never store them in URLs or persistent storage.
  window.openRentalBookingAdmin = async () => {
    if (window.COMPANY_ROLE !== 'owner') { alert('관리자만 사용할 수 있습니다.'); return; }
    if (!dialog) create(); $('bookingListSection').hidden = false; $('bookingVehicleSection').hidden = true; dialog.showModal(); await run(loadBookings);
  };
})();
