'use strict';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Case-insensitive `contains` OR-search across a fixed list of string
 * fields — deliberately not a generic query-builder, just enough for the
 * "search box" every list view needs. */
function searchClause(q, fields) {
  if (!q || !fields || !fields.length) return undefined;
  return { OR: fields.map(field => ({ [field]: { contains: String(q), mode: 'insensitive' } })) };
}

function meta(page, pageSize, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { parsePagination, searchClause, meta };
