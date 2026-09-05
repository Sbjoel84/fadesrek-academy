'use strict';

const express = require('express');
const { mountSimpleCrud } = require('../lib/simpleCrud');
const { assertValidFileMeta } = require('../lib/fileValidation');

const router = express.Router();

// Metadata only — there's no object-storage integration configured (no
// upload keys in .env), so storageKey/mimeType/sizeBytes are accepted as
// client-supplied fields, exactly as the schema comment describes ("the
// app never stores the file itself in Postgres"). Actual upload handling
// is a distinct piece of work, not part of wiring up this backend.
// validateCreate still sanity-checks the metadata a client claims about a
// file it hasn't actually handed us bytes for — a mime-type allowlist and
// size ceiling, not a malware scan (there's nothing to scan).
mountSimpleCrud(router, '/', {
  model: 'fileAsset',
  module: 'files',
  fields: ['name', 'category', 'storageKey', 'sizeBytes', 'mimeType'],
  searchFields: ['name'],
  where: req => (req.query.category ? { category: req.query.category } : {}),
  validateCreate: assertValidFileMeta,
});

module.exports = router;
