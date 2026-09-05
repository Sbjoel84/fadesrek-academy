'use strict';

const express = require('express');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

// The RBAC catalogue grants staff.edit at the module level only (no
// field-level ACL exists anywhere else in this codebase either — see
// permissionEngine.js) — so salary/bank fields aren't split out behind a
// separate permission here; whoever holds staff.edit can already touch all
// of it, same as every other module.
mountSimpleCrud(router, '/', {
  model: 'staff',
  module: 'staff',
  fields: ['staffNo', 'firstName', 'lastName', 'gender', 'position', 'department', 'trcn', 'phone',
    'salaryGradeId', 'bank', 'accountNo', 'pfa', 'annualRentKobo'],
  searchFields: ['firstName', 'lastName', 'staffNo'],
  orderBy: { lastName: 'asc' },
  where: req => (req.query.department ? { department: req.query.department } : {}),
});

module.exports = router;
