'use strict';
class BookingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new BookingError(status, message); };
const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value) ? value : fail(400, '잘못된 식별자입니다.');
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value) || (required && !value.trim())) fail(400, '입력 내용을 확인해주세요.');
  return value.trim();
}
function money(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) fail(400, '요금은 0원 이상 정수로 입력해주세요.');
  return value;
}
function date(value) {
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) fail(400, '날짜를 확인해주세요.');
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(value)) fail(400, '대여·반납 시간을 확인해주세요.');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms + 9 * 3600000).toISOString().slice(0, 16) !== value.slice(0, 16)) fail(400, '유효하지 않은 날짜입니다.');
  return ms;
}
function validateVehicle(input) {
  const id = key(input.id), name = text(input.name, 80, true), category = text(input.category || '', 30);
  if (!['available', 'unavailable'].includes(input.status)) fail(400, '예약 가능 상태를 확인해주세요.');
  if (typeof input.example !== 'boolean') fail(400, '예시 요금 여부를 선택해주세요.');
  const r = input.rates || {};
  const rates = Object.fromEntries(['daily', 'monthly', 'weekendDaily', 'seasonDaily', 'insuranceDaily', 'insuranceMonthly'].map(k => [k, money(r[k])]));
  if (!rates.daily || !rates.monthly) fail(400, '일일·월 요금을 입력해주세요.');
  const seasons = Array.isArray(input.seasons) ? input.seasons : [];
  if (seasons.length > 12) fail(400, '성수기 구간은 최대 12개입니다.');
  const normalizedSeasons = seasons.map(s => { const start = date(s.start), end = date(s.end); if (end < start) fail(400, '성수기 종료일을 확인해주세요.'); return { start, end }; });
  const options = Array.isArray(input.options) ? input.options : [];
  if (options.length > 12) fail(400, '옵션은 최대 12개입니다.');
  const normalizedOptions = options.map(o => { const id = key(o.id); if (!['once', 'daily'].includes(o.unit)) fail(400, '옵션 단위를 확인해주세요.'); return { id, name: text(o.name, 50, true), unit: o.unit, price: money(o.price) }; });
  if (new Set(normalizedOptions.map(o => o.id)).size !== options.length) fail(400, '중복된 옵션입니다.');
  let photoUrl = '';
  if (input.photoUrl) {
    let url; try { url = new URL(text(input.photoUrl, 1500)); } catch { fail(400, '사진 주소를 확인해주세요.'); }
    if (url.protocol !== 'https:' || url.username || url.password) fail(400, '사진 주소는 HTTPS 주소를 사용해주세요.');
    photoUrl = url.href;
  }
  return { id, name, category, status: input.status, example: input.example, rates, seasons: normalizedSeasons, options: normalizedOptions, photoUrl, photo: input.photo === true };
}
function request(input, now = Date.now()) {
  const vehicleId = key(input.vehicleId), mode = input.mode;
  if (!['daily', 'monthly'].includes(mode)) fail(400, '대여 형태를 선택해주세요.');
  const start = instant(input.start), end = instant(input.end);
  if (start < now || end <= start || end - start > 180 * 86400000 || start - now > 365 * 86400000) fail(400, '대여 기간은 미래의 1시간~180일로 선택해주세요.');
  if (end - start < 3600000) fail(400, '최소 대여 시간은 1시간입니다.');
  const days = Math.ceil((end - start) / 86400000);
  if (mode === 'monthly' && days < 30) fail(400, '월렌트는 최소 30일입니다.');
  if (typeof input.insurance !== 'boolean' || !Array.isArray(input.optionIds) || input.optionIds.length > 12) fail(400, '보험 및 옵션을 확인해주세요.');
  const optionIds = [...new Set(input.optionIds.map(key))];
  return { vehicleId, mode, start: input.start, end: input.end, startMs: start, endMs: end, days, insurance: input.insurance, optionIds };
}
function quote(vehicle, input, now) {
  if (!vehicle || vehicle.deleted || vehicle.status !== 'available') fail(409, '현재 예약 가능한 차량이 아닙니다.');
  const q = request(input, now), r = vehicle.rates;
  let rental = 0;
  if (q.mode === 'monthly') rental = Math.round(r.monthly * q.days / 30);
  else for (let i = 0; i < q.days; i++) {
    const kst = new Date(q.startMs + i * 86400000 + 9 * 3600000), day = kst.toISOString().slice(0, 10);
    const weekend = [0, 6].includes(kst.getUTCDay());
    const season = (vehicle.seasons || []).some(s => day >= s.start && day <= s.end);
    rental += Math.max(r.daily, weekend ? r.weekendDaily : 0, season ? r.seasonDaily : 0);
  }
  const insurance = !q.insurance ? 0 : q.mode === 'monthly' ? Math.round(r.insuranceMonthly * q.days / 30) : r.insuranceDaily * q.days;
  let options = 0;
  for (const id of q.optionIds) { const o = (vehicle.options || []).find(o => o.id === id); if (!o) fail(400, '선택한 옵션이 변경됐습니다.'); options += o.price * (o.unit === 'daily' ? q.days : 1); }
  const total = rental + insurance + options;
  if (!Number.isSafeInteger(total) || total > 1000000000) fail(400, '전화 상담이 필요한 금액입니다.');
  return { ...q, rental, insuranceCost: insurance, optionsCost: options, total, example: vehicle.example, revision: vehicle.revision || 0, vehicleName: vehicle.name, policy: '24시간 단위 올림 · 월렌트 30일 기준 일할 계산 · 주말/성수기는 높은 일요금 적용 · 관리자 확인 후 확정' };
}
const overlaps = (a, b) => a.startMs < b.endMs && b.startMs < a.endMs;
function available(state, q, except) {
  return !Object.entries(state.bookings || {}).some(([id, b]) => id !== except && b.vehicleId === q.vehicleId && ['pending', 'confirmed'].includes(b.status) && overlaps(q, b));
}
function customer(input) {
  const name = text(input.name, 60, true), phone = text(input.phone, 20, true).replace(/[ -]/g, ''), memo = text(input.memo || '', 500);
  if (!/^01[016789]\d{7,8}$/.test(phone)) fail(400, '휴대전화 번호를 확인해주세요.');
  if (input.consent !== true || input.consentVersion !== '2026-10-booking-v1') fail(400, '개인정보 수집·이용에 동의해주세요.');
  return { name, phone, memo, consentVersion: input.consentVersion };
}
function publicVehicle(v) {
  return { id: v.id, name: v.name, category: v.category, rates: v.rates, seasons: v.seasons || [], options: v.options || [], example: v.example, revision: v.revision || 0, photo: v.photo === true, photoUrl: v.photoUrl || '' };
}
module.exports = { BookingError, fail, key, text, date, validateVehicle, request, quote, available, customer, publicVehicle };
