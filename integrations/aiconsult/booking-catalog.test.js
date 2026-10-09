'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { bookingPrompt, extractRecommendations, catalogForAI } = require('./booking-catalog');
test('only valid catalog IDs become booking recommendations and tags never leak', () => {
  const vehicles = [{ id: 'v1', name: '가상 차량', example: true }];
  const r = extractRecommendations('추천드립니다 <<VEHICLES {"ids":["forged","v1","v1"]}>>', vehicles);
  assert.equal(r.reply, '추천드립니다'); assert.deepEqual(r.vehicles, vehicles);
});
test('catalog shared with AI contains only published availability and public rates', async () => {
  const r = await catalogForAI({ ref: () => ({ once: async () => ({ val: () => ({ a: { id: 'a', name: '공개 차량', status: 'available', rates: { daily: 50000 }, plate: '내부번호', memo: '내부메모' }, b: { id: 'b', status: 'unavailable' } }) }) }) }, 'example');
  assert.equal(r.length, 1); assert(!JSON.stringify(r).includes('내부'));
  const prompt = bookingPrompt('[대략 가격 (만원)] fixed price\n기존 상담 기능', r); assert(!prompt.includes('fixed price')); assert(prompt.includes('50000'));
});
