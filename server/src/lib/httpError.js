'use strict';
// 오류 응답은 {code, message} 공통 형식(명세 3.5 네트워크 인터페이스)
class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, ah };
