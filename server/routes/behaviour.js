'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { pick } = require('../lib/pick');
const { coerceDates } = require('../lib/dates');
const { forCreate, forUpdate, forDelete } = require('../lib/stamps');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest } = require('../lib/httpErrors');
const { actingStaffId } = require('../lib/actingStaff');

const router = express.Router();

const FIELDS = ['studentId', 'occurredOn', 'category', 'severity', 'description', 'actionTaken'];

router.get('/', requireSession, requirePermission('behaviour.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(req.query.category ? { category: req.query.category } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.behaviourIncident.findMany({ where, skip, take, orderBy: { occurredOn: 'desc' } }),
      prisma.behaviourIncident.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/', requireSession, requirePermission('behaviour.create'), async (req, res, next) => {
  try {
    if (!req.body?.studentId || !req.body?.occurredOn || !req.body?.category || !req.body?.description) {
      throw badRequest('studentId_occurredOn_category_description_required');
    }
    const staffId = await actingStaffId(req.session);
    const row = await prisma.behaviourIncident.create({
      data: { ...coerceDates(pick(req.body, FIELDS), ['occurredOn']), reportedById: staffId, ...forCreate(req.session) },
    });
    await prisma.studentTimelineEvent.create({
      data: { studentId: row.studentId, category: 'BEHAVIOUR', title: `${row.category} incident`, description: row.description, occurredOn: row.occurredOn, createdById: req.session.userId },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

/** A demerit needing sign-off — matches CLASS_TEACHER's grant
 * (behaviour: view, create, approve). */
router.patch('/:id/approve', requireSession, requirePermission('behaviour.approve'), async (req, res, next) => {
  try {
    const existing = await prisma.behaviourIncident.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.behaviourIncident.update({
      where: { id: req.params.id },
      data: { actionTaken: req.body?.actionTaken ?? existing.actionTaken, ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/:id', requireSession, requirePermission('behaviour.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.behaviourIncident.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.behaviourIncident.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
