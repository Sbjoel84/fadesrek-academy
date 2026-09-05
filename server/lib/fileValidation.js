'use strict';

const { badRequest } = require('./httpErrors');

// Metadata-only validation — matches the rest of the app's "no object-
// storage integration configured" boundary (see FileAsset's schema
// comment): there are no file bytes to scan here, only the client-supplied
// name/type/size to sanity-check before it's trusted into the database.
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
]);
const MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

function assertValidFileMeta({ mimeType, sizeBytes }) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw badRequest('unsupported_file_type', `${mimeType} is not an accepted file type.`);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) throw badRequest('invalid_file_size');
  if (sizeBytes > MAX_SIZE_BYTES) throw badRequest('file_too_large', 'Files must be 25MB or smaller.');
}

module.exports = { assertValidFileMeta, ALLOWED_MIME_TYPES, MAX_SIZE_BYTES };
