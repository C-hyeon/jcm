'use strict';
// 관리자 권한 부여/해제
require('dotenv').config();
const { auth, db } = require('../src/config/firebase');

(async () => {
  const email = process.argv[2];
  const remove = process.argv.includes('--remove');
  if (!email) {
    console.error('사용법: node scripts/setAdmin.js <email> [--remove]');
    process.exit(1);
  }
  const user = await auth().getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  if (remove) delete claims.admin;
  else claims.admin = true;
  await auth().setCustomUserClaims(user.uid, claims);
  await db().collection('users').doc(user.uid).set({ role: remove ? 'user' : 'admin' }, { merge: true });
  await auth().revokeRefreshTokens(user.uid);
  console.log(`${email} 관리자 권한 ${remove ? '해제' : '부여'} 완료 (다시 로그인해야 적용됩니다)`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
