'use strict';
// 사용자 소유 데이터는 users/{uid} 하위 컬렉션에 둔다(명세 3.6 도메인 데이터 모델).
const { db } = require('../config/firebase');

const userRef = (uid) => db().collection('users').doc(uid);
const userCol = (uid, name) => userRef(uid).collection(name);
const metaRef = (uid, name) => userRef(uid).collection('meta').doc(name);

/** Firestore 배치 500건 제한을 고려해 나눠 커밋한다. ops: (batch) => void */
async function commitInChunks(ops, size = 450) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = db().batch();
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

module.exports = { userRef, userCol, metaRef, commitInChunks };
