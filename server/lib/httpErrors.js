'use strict';

/** A typed error the centralised handler in index.js knows how to turn into
 * a status code + JSON body, the same way it already special-cases
 * PermissionError. `payload` is spread into the response alongside `error`. */
class HttpError extends Error {
  constructor(statusCode, code, message, payload) {
    super(message || code);
    this.statusCode = statusCode;
    this.code = code;
    this.payload = payload || {};
  }
}

const badRequest = (code, message, payload) => new HttpError(400, code, message, payload);
const notFound = (code = 'not_found', message) => new HttpError(404, code, message);
const conflict = (code, message) => new HttpError(409, code, message);

module.exports = { HttpError, badRequest, notFound, conflict };
