'use strict';
const { fail } = require('./domain');
function adminGuard(auth, memberLookup) {
  return async (req, company) => {
    const token = (req.get('Authorization') || '').match(/^Bearer (.+)$/)?.[1];
    if (!token) fail(401, '관리자 로그인이 필요합니다.');
    let user;
    try { user = await auth.verifyIdToken(token, true); } catch { fail(401, '로그인이 만료되었습니다.'); }
    const member = await memberLookup(company, user.uid);
    if (!member || member.role !== 'owner') fail(403, '이 영업소의 관리자만 사용할 수 있습니다.');
    return user.uid;
  };
}
module.exports = { adminGuard };
