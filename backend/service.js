'use strict';
const { createHash, randomUUID } = require('node:crypto');
const D = require('./domain');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function service(store, now = Date.now) {
  const catalog = async company => Object.values(store.readVehicles ? await store.readVehicles(company) : (await store.read(company)).vehicles || {}).filter(v => !v.deleted && v.status === 'available').map(D.publicVehicle);
  async function estimate(company, input) {
    const state = await store.read(company), q = D.quote(state.vehicles?.[input.vehicleId], input, now());
    if (!D.available(state, q)) D.fail(409, '선택한 시간에 이미 예약 요청이 있습니다. 다른 날짜를 선택해주세요.');
    return q;
  }
  async function submit(company, input) {
    const id = D.key(input.requestId), c = D.customer(input.customer || {}), qInput = D.request(input, now());
    const signature = fingerprint({ q: qInput, customer: c });
    const reference = randomUUID(), at = now();
    const state = await store.transact(company, state => {
      state.bookings ||= {}; const old = state.bookings[id];
      if (old) { if (old.signature !== signature) D.fail(409, '동일한 요청 번호로 다른 예약을 보낼 수 없습니다.'); return state; }
      const q = D.quote(state.vehicles?.[qInput.vehicleId], input, at);
      if (input.expectedTotal !== q.total || input.expectedRevision !== q.revision) D.fail(409, '요금이 변경됐습니다. 예상 요금을 다시 확인해주세요.');
      if (!D.available(state, q)) D.fail(409, '다른 고객이 먼저 예약을 신청했습니다. 다른 날짜를 선택해주세요.');
      if (Object.keys(state.bookings).length >= 10000) D.fail(503, '온라인 예약 접수가 잠시 중지되었습니다. 전화로 문의해주세요.');
      state.bookings[id] = { id, reference, ...q, customer: { ...c, consentAt: at }, signature, status: 'pending', createdAt: at, updatedAt: at, events: [{ status: 'pending', at }] };
      return state;
    });
    const b = state.bookings?.[id]; if (!b) D.fail(503, '예약을 저장하지 못했습니다. 다시 시도해주세요.');
    return { reference: b.reference, status: b.status, total: b.total, example: b.example };
  }
  async function saveVehicle(company, input, actor) {
    const v = D.validateVehicle(input), at = now();
    return store.transact(company, state => {
      state.vehicles ||= {}; const old = state.vehicles[v.id];
      if (old && old.revision !== input.expectedRevision) D.fail(409, '다른 관리자가 차량을 수정했습니다. 다시 불러와주세요.');
      if (!old && Object.keys(state.vehicles).length >= 200) D.fail(400, '차량은 최대 200대까지 등록할 수 있습니다.');
      state.vehicles[v.id] = { ...v, revision: (old?.revision || 0) + 1, updatedBy: actor, updatedAt: at, deleted: false };
      return state;
    });
  }
  async function deleteVehicle(company, id, revision, actor) {
    return store.transact(company, state => {
      const v = state.vehicles?.[id]; if (!v || v.deleted) D.fail(404, '차량을 찾을 수 없습니다.');
      if (v.revision !== revision) D.fail(409, '차량 정보가 변경됐습니다.');
      if (Object.values(state.bookings || {}).some(b => b.vehicleId === id && ['pending', 'confirmed'].includes(b.status) && b.endMs > now())) D.fail(409, '진행 중인 예약이 있어 삭제할 수 없습니다. 예약 불가 상태로 바꿔주세요.');
      v.deleted = true; v.status = 'unavailable'; v.revision++; v.updatedBy = actor; v.updatedAt = now(); return state;
    });
  }
  async function setStatus(company, id, status, expected, actor) {
    if (!['confirmed', 'cancelled'].includes(status)) D.fail(400, '확정 또는 취소 상태를 선택해주세요.');
    return store.transact(company, state => {
      const b = state.bookings?.[id]; if (!b) D.fail(404, '예약을 찾을 수 없습니다.');
      if (b.status !== expected) D.fail(409, '예약 상태가 이미 변경됐습니다. 새로고침해주세요.');
      if (b.status === status) return state;
      if (b.status === 'cancelled') D.fail(409, '취소된 예약은 새로 신청해야 합니다.');
      if (status === 'confirmed') {
        const v = state.vehicles?.[b.vehicleId];
        if (!v || v.deleted || v.status !== 'available' || b.endMs <= now() || !D.available(state, b, id)) D.fail(409, '차량 또는 일정 상태를 다시 확인해주세요.');
      }
      b.status = status; b.updatedAt = now(); b.events.push({ status, at: b.updatedAt, actor }); return state;
    });
  }
  return { catalog, estimate, submit, saveVehicle, deleteVehicle, setStatus };
}
module.exports = { service };
