'use strict';

const { db } = require('../config/firebase');

const userRef = (uid) => db().collection('users').doc(uid);
const userCol = (uid, name) => userRef(uid).collection(name);
const metaRef = (uid, name) => userRef(uid).collection('meta').doc(name);

async function commitInChunks(ops, size = 450) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = db().batch();
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

module.exports = { userRef, userCol, metaRef, commitInChunks };
