'use strict';

const express = require('express');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

mountSimpleCrud(router, '/slots', {
  model: 'timetableSlot',
  module: 'timetable',
  fields: ['classId', 'day', 'periodId', 'subjectId', 'staffId'],
  where: req => (req.query.classId ? { classId: req.query.classId } : {}),
});

module.exports = router;
