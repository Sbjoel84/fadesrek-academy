'use strict';

// Small aggregation helpers shared by the intents. Money is stored in kobo
// as BigInt throughout the schema (never a float) — these are the only
// places that convert it to a JS Number, and only for display, never for
// anything that gets written back to the database.

/** Sums a BigInt `amountKobo`-shaped field across a list of rows. */
function sumKobo(rows, field = 'amountKobo') {
  return rows.reduce((total, row) => total + (row[field] ?? 0n), 0n);
}

function koboToNaira(kobo) {
  return Number(kobo) / 100;
}

function formatNaira(kobo) {
  const naira = typeof kobo === 'bigint' ? koboToNaira(kobo) : kobo;
  return '₦' + naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function groupCount(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(counts);
}

function percentage(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal place
}

/** Local (server) calendar day, matching the @db.Date columns in the schema
 * (which store a date with no time component). Using UTC midnight keeps
 * this consistent regardless of the server's local timezone. */
function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysAgo(n, from = today()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

module.exports = { sumKobo, koboToNaira, formatNaira, groupCount, percentage, today, daysAgo, addDays };
