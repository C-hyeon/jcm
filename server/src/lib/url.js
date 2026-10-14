'use strict';
// 자료 URL은 https 스킴만 허용하고, 내부망 주소는 거부.
const PRIVATE_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

function isSafeHttpsUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return false;
    if (!u.hostname || PRIVATE_HOST.test(u.hostname)) return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  const u = new URL(value);
  u.hash = '';
  return u.toString();
}

module.exports = { isSafeHttpsUrl, normalizeUrl };
