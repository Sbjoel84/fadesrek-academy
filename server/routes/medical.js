'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { pick } = require('../lib/pick');
const { forCreate, forUpdate } = require('../lib/stamps');
const { toDate } = require('../lib/dates');
const { notFound, badRequest } = require('../lib/httpErrors');
const { actingStaffId } = require('../lib/actingStaff');

const router = express.Router();

const PROFILE_FIELDS = ['bloodGroup', 'genotype', 'allergies', 'conditions', 'physicianName', 'physicianPhone',
  'emergencyContactName', 'emergencyContactPhone', 'insuranceProvider', 'insuranceNo'];

// One profile per student — upsert, not a list, matching the schema's own
// framing ("the static health profile, not an event log").
router.get('/profiles/:studentId', requireSession, requirePermission('medical.view'), async (req, res, next) => {
  try {
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(req.params.studentId)) throw notFound();
    const row = await prisma.studentMedicalProfile.findUnique({ where: { studentId: req.params.studentId } });
    if (!row || row.deletedAt) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

router.put('/profiles/:studentId', requireSession, requirePermission('medical.edit'), async (req, res, next) => {
  try {
    const data = pick(req.body, PROFILE_FIELDS);
    const row = await prisma.studentMedicalProfile.upsert({
      where: { studentId: req.params.studentId },
      update: { ...data, ...forUpdate(req.session), version: { increment: 1 } },
      create: { studentId: req.params.studentId, ...data, ...forCreate(req.session) },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/visits', requireSession, requirePermission('medical.view'), async (req, res, next) => {
  try {
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const rows = await prisma.medicalVisit.findMany({ where, orderBy: { visitedOn: 'desc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/visits', requireSession, requirePermission('medical.create'), async (req, res, next) => {
  try {
    const { studentId, visitedOn, reason, treatment, notes } = req.body || {};
    if (!studentId || !visitedOn || !reason) throw badRequest('studentId_visitedOn_reason_required');
    const staffId = await actingStaffId(req.session);
    const visitedOnDate = toDate(visitedOn);
    const row = await prisma.medicalVisit.create({
      data: { studentId, visitedOn: visitedOnDate, reason, treatment, notes, recordedById: staffId, ...forCreate(req.session) },
    });
    await prisma.studentTimelineEvent.create({
      data: { studentId, category: 'MEDICAL', title: 'Medical visit', description: reason, occurredOn: visitedOnDate, createdById: req.session.userId },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

module.exports = router;
