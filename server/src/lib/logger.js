'use strict';
const crypto = require('crypto');

// 로그에는 토큰·비밀번호·요청 본문을 남기지 않는다. 사용자는 해시로만 기록(명세 3.8).
function hashUid(uid) {
  if (!uid) return null;
  const salt = process.env.LOG_HASH_SALT || 'jcm-log';
  return crypto.createHash('sha256').update(salt + uid).digest('hex').slice(0, 16);
}

function log(event, data = {}) {
  if (process.env.NODE_ENV === 'test') return;
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

module.exports = { log, hashUid };
