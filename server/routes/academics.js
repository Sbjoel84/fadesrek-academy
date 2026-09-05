'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { pick } = require('../lib/pick');
const { coerceDates } = require('../lib/dates');
const { forCreate, forUpdate, forDelete, forRestore } = require('../lib/stamps');
const { parsePagination, meta } = require('../lib/pagination');
const { checkVersion } = require('../lib/version');
const { notFound, badRequest } = require('../lib/httpErrors');
const { assertPermission, can, resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { actingStaffId } = require('../lib/actingStaff');
const { assertValidFileMeta } = require('../lib/fileValidation');

const router = express.Router();

const LESSON_PLAN_FIELDS = ['week', 'classId', 'subjectId', 'staffId', 'topic', 'planStatus'];
const ASSIGNMENT_FIELDS = ['title', 'subjectId', 'classId', 'instructions', 'dueOn'];

// -------------------------------------------------------------- lesson plans --

router.get('/lesson-plans', requireSession, requirePermission('academics.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = {
      deletedAt: null,
      ...(req.query.classId ? { classId: req.query.classId } : {}),
      ...(req.query.staffId ? { staffId: req.query.staffId } : {}),
      ...(req.query.planStatus ? { planStatus: req.query.planStatus } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.lessonPlan.findMany({ where, skip, take, orderBy: { week: 'asc' } }),
      prisma.lessonPlan.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/lesson-plans', requireSession, requirePermission('academics.create'), async (req, res, next) => {
  try {
    const row = await prisma.lessonPlan.create({ data: { ...pick(req.body, LESSON_PLAN_FIELDS), ...forCreate(req.session) } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/lesson-plans/:id', requireSession, requirePermission('academics.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.lessonPlan.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    checkVersion(existing, req.body);
    const row = await prisma.lessonPlan.update({
      where: { id: req.params.id },
      data: { ...pick(req.body, LESSON_PLAN_FIELDS), ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

/** DRAFT -> SUBMITTED is the teacher's own edit permission; -> APPROVED
 * needs academics.approve (a coordinator signing off), matching the
 * catalogue's grant split between TEACHER and ACADEMIC_COORDINATOR. */
router.patch('/lesson-plans/:id/status', requireSession, async (req, res, next) => {
  try {
    const { planStatus } = req.body || {};
    if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(planStatus)) throw badRequest('invalid_plan_status');
    assertPermission(req.session, planStatus === 'APPROVED' ? 'academics.approve' : 'academics.edit');
    const existing = await prisma.lessonPlan.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.lessonPlan.update({
      where: { id: req.params.id },
      data: { planStatus, ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/lesson-plans/:id', requireSession, requirePermission('academics.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.lessonPlan.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.lessonPlan.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/lesson-plans/:id/restore', requireSession, requirePermission('academics.restore'), async (req, res, next) => {
  try {
    const existing = await prisma.lessonPlan.findUnique({ where: { id: req.params.id } });
    if (!existing || !existing.deletedAt) throw notFound();
    const row = await prisma.lessonPlan.update({ where: { id: req.params.id }, data: forRestore(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

// -------------------------------------------------------------- assignments --

router.get('/assignments', requireSession, requirePermission('academics.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { deletedAt: null, ...(req.query.classId ? { classId: req.query.classId } : {}) };
    const [data, total] = await Promise.all([
      prisma.assignment.findMany({ where, skip, take, orderBy: { dueOn: 'desc' } }),
      prisma.assignment.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/assignments', requireSession, requirePermission('academics.create'), async (req, res, next) => {
  try {
    const row = await prisma.assignment.create({ data: { ...coerceDates(pick(req.body, ASSIGNMENT_FIELDS), ['dueOn']), ...forCreate(req.session) } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/assignments/:id', requireSession, requirePermission('academics.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    checkVersion(existing, req.body);
    const row = await prisma.assignment.update({
      where: { id: req.params.id },
      data: { ...coerceDates(pick(req.body, ASSIGNMENT_FIELDS), ['dueOn']), ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/assignments/:id', requireSession, requirePermission('academics.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.assignment.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- submissions --

router.get('/assignments/:assignmentId/submissions', requireSession, requirePermission('academics.view'), async (req, res, next) => {
  try {
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      assignmentId: req.params.assignmentId,
      deletedAt: null,
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const rows = await prisma.assignmentSubmission.findMany({
      where,
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

/** Not gated by academics.create — a STUDENT session only ever holds
 * academics.view (see the catalogue), and "hand in my own homework" is a
 * narrower thing than "create academic content". Anyone who does hold
 * academics.create can log a submission for any student in their scope;
 * anyone else may only submit for themselves. */
router.post('/assignments/:assignmentId/submissions', requireSession, async (req, res, next) => {
  try {
    const { studentId, fileAssetId } = req.body || {};
    if (!studentId) throw badRequest('studentId_required');

    const scope = await resolveScope(req.session);
    const ids = await scopeToStudentIds(scope);
    const isOwnRecord = scope.kind === 'SELF' && ids && ids.includes(studentId);
    if (!can(req.session, 'academics.create') && !isOwnRecord) {
      assertPermission(req.session, 'academics.create');
    }

    const row = await prisma.assignmentSubmission.create({
      data: { assignmentId: req.params.assignmentId, studentId, fileAssetId, submittedAt: new Date(), ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/submissions/:id/grade', requireSession, requirePermission('academics.edit'), async (req, res, next) => {
  try {
    const { grade } = req.body || {};
    if (typeof grade !== 'number') throw badRequest('grade_required');
    const existing = await prisma.assignmentSubmission.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.assignmentSubmission.update({
      where: { id: req.params.id },
      data: { grade, ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------- remarks --
// A teacher's end-of-term remark on a student's record — the actually-
// authored version of the "class teacher's remark" line on a report card.

router.get('/remarks', requireSession, requirePermission('academics.view'), async (req, res, next) => {
  try {
    const { studentId, termId } = req.query;
    if (!studentId) throw badRequest('studentId_required');
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(studentId)) throw notFound();
    const rows = await prisma.remark.findMany({
      where: { studentId, deletedAt: null, ...(termId ? { termId } : {}) },
      include: { staff: { select: { firstName: true, lastName: true, position: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.put('/remarks', requireSession, requirePermission('academics.edit'), async (req, res, next) => {
  try {
    const { studentId, termId, body } = req.body || {};
    if (!studentId || !termId || !body) throw badRequest('studentId_termId_body_required');
    const staffId = await actingStaffId(req.session);
    if (!staffId) throw badRequest('session_has_no_staff_record');

    const row = await prisma.remark.upsert({
      where: { studentId_staffId_termId: { studentId, staffId, termId } },
      update: { body, ...forUpdate(req.session), version: { increment: 1 } },
      create: { studentId, staffId, termId, body, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------ materials --
// Class/subject-linked learning materials — a FileAsset tagged for a
// specific class+subject rather than the generic file manager's untagged
// rows. Metadata only, same boundary as the rest of the files module (no
// object-storage integration configured).

router.get('/materials', requireSession, requirePermission('academics.view'), async (req, res, next) => {
  try {
    const { classId, subjectId } = req.query;
    if (!classId) throw badRequest('classId_required');
    const rows = await prisma.fileAsset.findMany({
      where: { classId, deletedAt: null, category: 'learning_material', ...(subjectId ? { subjectId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/materials', requireSession, requirePermission('academics.create'), async (req, res, next) => {
  try {
    const { classId, subjectId, name, storageKey, sizeBytes, mimeType } = req.body || {};
    if (!classId || !name || !storageKey || !sizeBytes || !mimeType) throw badRequest('missing_required_fields');
    assertValidFileMeta({ mimeType, sizeBytes });
    const row = await prisma.fileAsset.create({
      data: { classId, subjectId, name, storageKey, sizeBytes, mimeType, category: 'learning_material', ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

module.exports = router;
