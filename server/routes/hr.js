'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { pick } = require('../lib/pick');
const { coerceDates } = require('../lib/dates');
const { forCreate, forUpdate, forDelete } = require('../lib/stamps');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, conflict } = require('../lib/httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');

const router = express.Router();

const LEAVE_FIELDS = ['staffId', 'leaveType', 'fromDate', 'days', 'reason'];

router.get('/leave-requests', requireSession, requirePermission('hr.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = {
      deletedAt: null,
      ...(req.query.staffId ? { staffId: req.query.staffId } : {}),
      ...(req.query.leaveStatus ? { leaveStatus: req.query.leaveStatus } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.leaveRequest.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.leaveRequest.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/leave-requests', requireSession, requirePermission('hr.create'), async (req, res, next) => {
  try {
    const row = await prisma.leaveRequest.create({ data: { ...coerceDates(pick(req.body, LEAVE_FIELDS), ['fromDate']), ...forCreate(req.session) } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

async function transition(req, res, next, leaveStatus, permission) {
  try {
    const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    if (existing.leaveStatus !== 'PENDING') throw conflict('not_pending');
    const row = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { leaveStatus, ...forUpdate(req.session), version: { increment: 1 } },
    });
    await writeAuditEntry({ session: req.session, action: `hr.leave_request.${leaveStatus.toLowerCase()}`, detail: { id: row.id } });
    res.json(row);
  } catch (err) { next(err); }
}

router.patch('/leave-requests/:id/approve', requireSession, requirePermission('hr.approve'), (req, res, next) => transition(req, res, next, 'APPROVED'));
router.patch('/leave-requests/:id/decline', requireSession, requirePermission('hr.reject'), (req, res, next) => transition(req, res, next, 'DECLINED'));

router.delete('/leave-requests/:id', requireSession, requirePermission('hr.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.leaveRequest.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
