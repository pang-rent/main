'use strict';
// Offline merge only. This script never connects to or deploys a database.
const fs = require('node:fs'), path = require('node:path');
function merge(input) {
  const result = structuredClone(input), rules = result.rules;
  if (!rules || typeof rules !== 'object') throw Error('Expected a Firebase rules JSON object');
  for (const k of ['.read', '.write']) if (rules[k] !== undefined && rules[k] !== false) throw Error('Root access must be denied; child rules cannot revoke inherited permission. Review existing rules before proceeding.');
  if (Object.keys(rules).some(k => k.startsWith('$'))) throw Error('Root wildcard rules need manual security review before adding private namespaces.');
  for (const key of ['rentalBookingPrivate', 'rentalBookingPhotos', 'rentalBookingRate']) {
    if (rules[key] && (rules[key]['.read'] !== false || rules[key]['.write'] !== false)) throw Error('Existing private namespace requires review: ' + key);
    rules[key] = { ...(rules[key] || {}), '.read': false, '.write': false, ...(key === 'rentalBookingRate' ? { '.indexOn': ['expiresAt'] } : {}) };
  }
  return result;
}
if (require.main === module) {
  const [, , source, output] = process.argv;
  if (!source || !output || path.resolve(source) === path.resolve(output)) throw Error('Usage: node scripts/merge-database-rules.cjs EXISTING.json NEW.json (different paths required)');
  fs.writeFileSync(output, JSON.stringify(merge(JSON.parse(fs.readFileSync(source, 'utf8'))), null, 2) + '\n');
  console.log('Merged rules written locally. Review the diff; no deployment performed.');
}
module.exports = { merge };
