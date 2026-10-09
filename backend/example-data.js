'use strict';
// Synthetic catalog, never seeded into production automatically.
const { validateVehicle } = require('./domain');
module.exports = [
  ['sample-compact', '예시 차량 · 소형', '소형', 50000, 500000],
  ['sample-sedan', '예시 차량 · 중형', '중형', 60000, 600000],
  ['sample-suv', '예시 차량 · SUV', 'SUV', 80000, 800000]
].map(([id, name, category, daily, monthly]) => ({ ...validateVehicle({ id, name, category, status: 'available', example: true,
  rates: { daily, monthly, weekendDaily: daily + 10000, seasonDaily: daily + 20000, insuranceDaily: 10000, insuranceMonthly: 50000 },
  seasons: [{ start: '2026-12-24', end: '2026-12-31' }], options: []
}), revision: 1 }));
