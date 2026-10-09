'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { merge } = require('../../scripts/merge-database-rules.cjs');
test('private namespaces preserve existing fleet rules and reject inherited root grants', () => {
  const existing = { rules: { '.read': false, '.write': false, companies: { '$company': { '.read': 'auth != null', '.write': 'auth != null' } } } };
  const result = merge(existing); assert.deepEqual(result.rules.companies, existing.rules.companies); assert.equal(result.rules.rentalBookingPrivate['.read'], false); assert.equal(existing.rules.rentalBookingPrivate, undefined);
  assert.throws(() => merge({ rules: { '.read': 'auth != null' } }), /Root access/);
  assert.throws(() => merge({ rules: { '$anything': {} } }), /wildcard/);
});
