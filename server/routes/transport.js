'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { badRequest, notFound } = require('../lib/httpErrors');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

mountSimpleCrud(router, '/routes', {
  model: 'transportRoute',
  module: 'transport',
  fields: ['name', 'fareKobo'],
  searchFields: ['name'],
});

router.get('/routes/:routeId/stops', requireSession, requirePermission('transport.view'), async (req, res, next) => {
  try {
    const rows = await prisma.transportStop.findMany({ where: { routeId: req.params.routeId }, orderBy: { sequence: 'asc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/routes/:routeId/stops', requireSession, requirePermission('transport.edit'), async (req, res, next) => {
  try {
    const { name, sequence } = req.body || {};
    if (!name || typeof sequence !== 'number') throw badRequest('name_and_sequence_required');
    const row = await prisma.transportStop.create({ data: { routeId: req.params.routeId, name, sequence } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.delete('/stops/:id', requireSession, requirePermission('transport.edit'), async (req, res, next) => {
  try {
    await prisma.transportStop.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return next(notFound());
    next(err);
  }
});

mountSimpleCrud(router, '/allocations', {
  model: 'transportAllocation',
  module: 'transport',
  fields: ['studentId', 'routeId', 'stopName'],
  where: req => (req.query.studentId ? { studentId: req.query.studentId } : {}),
});

module.exports = router;
