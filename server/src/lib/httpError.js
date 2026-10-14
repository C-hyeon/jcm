'use strict';

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
