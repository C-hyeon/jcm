'use strict';
const { auth } = require('../config/firebase');
const { HttpError } = require('../lib/httpError');
const { log, hashUid } = require('../lib/logger');

function extractToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

// 서명·만료·발급자 검증은 verifyIdToken이 수행. checkRevoked=true로 탈퇴·비활성 계정도 차단.
async function decode(token) {
  const d = await auth().verifyIdToken(token, true);
  return {
    uid: d.uid,
    email: d.email || null,
    admin: d.admin === true,
    authTime: d.auth_time,
    provider: d.firebase?.sign_in_provider || null,
  };
}

function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    log('auth.denied', { status: 401, path: req.path, reason: 'no_token' });
    return next(new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다. 로그인한 뒤 다시 시도해 주세요.'));
  }
  decode(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      log('auth.denied', { status: 401, path: req.path, reason: 'invalid_token' });
      next(new HttpError(401, 'INVALID_TOKEN', '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.'));
    });
}

// 비회원도 쓸 수 있는 기능(자료 허브 등)
function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next();
  decode(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => next());
}

function requireAdmin(req, _res, next) {
  if (!req.user?.admin) {
    log('auth.denied', { status: 403, path: req.path, user: hashUid(req.user?.uid) });
    return next(new HttpError(403, 'FORBIDDEN', '관리자 권한이 있는 계정만 사용할 수 있습니다.'));
  }
  next();
}

// 탈퇴 등 민감 작업은 최근 재인증(기본 5분 이내) 요구
function requireRecentAuth(maxAgeSec = 300) {
  return (req, _res, next) => {
    const now = Math.floor(Date.now() / 1000);
    if (!req.user?.authTime || now - req.user.authTime > maxAgeSec) {
      return next(new HttpError(401, 'REAUTH_REQUIRED', '보안을 위해 비밀번호(또는 Google 계정)를 다시 확인한 뒤 시도해 주세요.'));
    }
    next();
  };
}

module.exports = { requireAuth, optionalAuth, requireAdmin, requireRecentAuth };
