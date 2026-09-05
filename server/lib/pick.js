'use strict';

/** Whitelists request-body fields before they reach Prisma — a client
 * request body must never be passed straight through, since it could carry
 * id/version/deletedAt/*ById columns the server alone is allowed to set. */
function pick(obj, fields) {
  const out = {};
  if (!obj) return out;
  for (const field of fields) {
    if (obj[field] !== undefined) out[field] = obj[field];
  }
  return out;
}

module.exports = { pick };
