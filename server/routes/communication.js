'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { forCreate } = require('../lib/stamps');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest } = require('../lib/httpErrors');
const { actingStaffId } = require('../lib/actingStaff');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

mountSimpleCrud(router, '/notices', {
  model: 'notice',
  module: 'communication',
  fields: ['title', 'body', 'color', 'happensOn', 'publishedOn'],
  dateFields: ['publishedOn'],
  searchFields: ['title'],
  orderBy: { publishedOn: 'desc' },
});

// ------------------------------------------------------------------- threads --
// A conversation about one student between the staff member who opened it
// and that student's guardian — the parent portal's "Messages from the
// school" and the teacher-side equivalent. Scoped the same way every other
// student-linked list is (resolveScope/scopeToStudentIds): a parent only
// ever sees threads about their own children, a class teacher only about
// their own roll.

router.get('/threads', requireSession, requirePermission('communication.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(req.query.staffId ? { staffId: req.query.staffId } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.messageThread.findMany({
        where, skip, take, orderBy: { updatedAt: 'desc' },
        include: { student: { select: { firstName: true, lastName: true, admissionNo: true } }, _count: { select: { messages: true } } },
      }),
      prisma.messageThread.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.get('/threads/:id', requireSession, requirePermission('communication.view'), async (req, res, next) => {
  try {
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const thread = await prisma.messageThread.findUnique({
      where: { id: req.params.id },
      include: {
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { displayName: true, roleId: true } } } },
      },
    });
    if (!thread || thread.deletedAt) throw notFound();
    if (ids && !ids.includes(thread.studentId)) throw notFound();
    res.json(thread);
  } catch (err) { next(err); }
});

router.post('/threads', requireSession, requirePermission('communication.create'), async (req, res, next) => {
  try {
    const { studentId, subject, body } = req.body || {};
    if (!studentId || !subject || !body) throw badRequest('studentId_subject_body_required');

    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(studentId)) throw notFound();

    const link = await prisma.studentGuardian.findFirst({
      where: { studentId },
      orderBy: { isPrimary: 'desc' },
    });
    if (!link) throw badRequest('student_has_no_guardian_on_file');

    const staffId = await actingStaffId(req.session);
    if (!staffId) throw badRequest('session_has_no_staff_record');

    const thread = await prisma.$transaction(async tx => {
      const created = await tx.messageThread.create({
        data: { studentId, staffId, guardianId: link.guardianId, subject, ...forCreate(req.session) },
      });
      await tx.message.create({ data: { threadId: created.id, senderId: req.session.userId, body } });
      return created;
    });

    res.status(201).json(thread);
  } catch (err) { next(err); }
});

router.post('/threads/:id/messages', requireSession, requirePermission('communication.create'), async (req, res, next) => {
  try {
    const { body } = req.body || {};
    if (!body) throw badRequest('body_required');

    const thread = await prisma.messageThread.findUnique({ where: { id: req.params.id } });
    if (!thread || thread.deletedAt) throw notFound();
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(thread.studentId)) throw notFound();

    const [message] = await prisma.$transaction([
      prisma.message.create({ data: { threadId: thread.id, senderId: req.session.userId, body } }),
      prisma.messageThread.update({ where: { id: thread.id }, data: { updatedById: req.session.userId } }),
    ]);
    res.status(201).json(message);
  } catch (err) { next(err); }
});

router.patch('/threads/:id/read', requireSession, requirePermission('communication.view'), async (req, res, next) => {
  try {
    const thread = await prisma.messageThread.findUnique({ where: { id: req.params.id } });
    if (!thread || thread.deletedAt) throw notFound();
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(thread.studentId)) throw notFound();

    await prisma.message.updateMany({
      where: { threadId: thread.id, readAt: null, senderId: { not: req.session.userId } },
      data: { readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
