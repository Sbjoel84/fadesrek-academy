'use strict';

const { conflict } = require('./httpErrors');

/** Optimistic-concurrency check against the schema's `version` column (see
 * the schema header: the service layer is where this is meant to be
 * enforced, since Prisma has no built-in middleware for it). Not a strict
 * atomic compare-and-swap — a findUnique-then-update — but enough to catch
 * the case the column exists for: two people editing the same record a
 * request apart. */
function checkVersion(existing, body) {
  if (typeof body.version !== 'number') {
    throw conflict('version_required', 'A version field is required to update this record.');
  }
  if (body.version !== existing.version) {
    throw conflict('stale_version', 'This record was changed by someone else — reload and try again.');
  }
}

module.exports = { checkVersion };
