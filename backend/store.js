'use strict';
const { fail } = require('./domain');
function databaseStore(db) {
  const root = company => db.ref('rentalBookingPrivate/' + company);
  return {
    async read(company) { return (await root(company).get()).val() || { schema: 1 }; },
    async readVehicles(company) { return (await root(company).child('vehicles').get()).val() || {}; },
    async transact(company, mutate) {
      const ref = root(company);
      await ref.transaction(value => value || { schema: 1 });
      const result = await ref.transaction(value => value == null ? { schema: 1 } : mutate(value));
      if (!result.committed) fail(409, '동시 변경으로 저장하지 못했습니다. 다시 시도해주세요.');
      return result.snapshot.val();
    },
    async photo(company, id) { return (await db.ref('rentalBookingPhotos/' + company + '/' + id).get()).val(); },
    async savePhoto(company, id, value) { await db.ref('rentalBookingPhotos/' + company + '/' + id).set(value); }
  };
}
module.exports = { databaseStore };
