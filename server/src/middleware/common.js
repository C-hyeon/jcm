'use strict';
const rateLimit = require('express-rate-limit');
const { HttpError } = require('../lib/httpError');
const { requestToday } = require('../lib/dates');
const { log } = require('../lib/logger');

/** zod 스키마 검증. 결과는 req.valid 에 담는다 */
const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const r = schema.safeParse(req[source] ?? {});
    if (!r.success) {
      const issue = r.error.issues[0];
      return next(new HttpError(400, 'VALIDATION_ERROR', issue.message || '입력값을 확인해 주세요.', { path: issue.path.join('.') }));
    }
    req.valid = r.data;
    next();
  };

const limitHandler = (_req, res) =>
  res.status(429).json({ code: 'RATE_LIMITED', message: '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.' });

// 사용자당 분당 60회 (명세 3.5). 서버리스 환경에서는 인스턴스별로 집계되므로 필요 시 외부 저장소로 교체.
const userLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: (req) => `u:${req.user?.uid}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});
// 비로그인 공개 API: IP 기준(학교 실습실 NAT를 고려해 조금 넉넉히)
const ipLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler });

function today(req, _res, next) {
  req.today = requestToday(req);
  next();
}

function httpsRedirect(req, res, next) {
  if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
}

function notFound(_req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', '요청한 기능을 찾을 수 없습니다.'));
}

// 오류 메시지에 스택 트레이스·내부 경로를 노출하지 않는다(명세 3.8)
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err.type === 'entity.too.large') {
    return res.status(400).json({ code: 'PAYLOAD_TOO_LARGE', message: '요청 내용이 너무 큽니다(100KB 이하). 메모 길이를 줄여 주세요.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'INVALID_JSON', message: '요청 형식이 올바르지 않습니다.' });
  }
  if (err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  log('server.error', { path: req.path, message: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') });
  res.status(500).json({ code: 'INTERNAL', message: '일시적인 서버 오류입니다. 잠시 후 다시 시도해 주세요.' });
}

module.exports = { validate, userLimiter, ipLimiter, today, httpsRedirect, notFound, errorHandler };
