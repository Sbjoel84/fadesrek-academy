'use strict';

const express = require('express');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

mountSimpleCrud(router, '/hostels', {
  model: 'hostel',
  module: 'hostel',
  fields: ['name', 'gender', 'rooms', 'bedsPerRoom'],
  searchFields: ['name'],
});

// [hostelId, roomLabel, bedLabel] uniqueness is enforced by the schema
// itself — a duplicate allocation surfaces as a Prisma P2002, which the
// centralised error handler falls through to a 500 for today; good enough
// for this pass since a real bed-double-booking is a rare operator error,
// not a routine client-facing validation case.
mountSimpleCrud(router, '/allocations', {
  model: 'hostelAllocation',
  module: 'hostel',
  fields: ['studentId', 'hostelId', 'roomLabel', 'bedLabel'],
  where: req => (req.query.studentId ? { studentId: req.query.studentId } : {}),
});

module.exports = router;
