'use strict';

/** Prisma's DateTime/@db.Date columns require a full ISO-8601 datetime —
 * a bare "YYYY-MM-DD" from an HTML date input or a JSON body throws
 * PrismaClientValidationError ("premature end of input"). Every route that
 * accepts a client-supplied date runs it through this first. Leaves
 * undefined/null alone so it composes with `pick()`'s "only if present"
 * whitelisting. */
function toDate(value) {
  return value === undefined || value === null ? value : new Date(value);
}

/** Applies toDate to a fixed set of keys on an already-picked data object —
 * used after pick() so date-typed fields never reach Prisma as bare
 * strings, whether they came from a generic simpleCrud mount or a
 * hand-written route. */
function coerceDates(data, dateFields) {
  const out = { ...data };
  for (const field of dateFields) {
    if (out[field] !== undefined) out[field] = toDate(out[field]);
  }
  return out;
}

module.exports = { toDate, coerceDates };
