'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { forCreate, forDelete } = require('../lib/stamps');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest } = require('../lib/httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');
const { actingStaffId } = require('../lib/actingStaff');

const router = express.Router();

router.get('/registers', requireSession, requirePermission('attendance.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = {
      deletedAt: null,
      ...(req.query.classId ? { classId: req.query.classId } : {}),
      ...(req.query.date ? { date: new Date(req.query.date) } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.attendanceRegister.findMany({ where, skip, take, orderBy: { date: 'desc' } }),
      prisma.attendanceRegister.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.get('/registers/:id', requireSession, requirePermission('attendance.view'), async (req, res, next) => {
  try {
    const row = await prisma.attendanceRegister.findUnique({
      where: { id: req.params.id },
      include: { records: { include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } } } },
    });
    if (!row || row.deletedAt) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

/** Find-or-create is the natural shape here — a register is keyed uniquely
 * by [classId, date], so "open today's register" is idempotent. */
router.post('/registers', requireSession, requirePermission('attendance.create'), async (req, res, next) => {
  try {
    const { classId, date } = req.body || {};
    if (!classId || !date) throw badRequest('classId_and_date_required');
    const row = await prisma.attendanceRegister.upsert({
      where: { classId_date: { classId, date: new Date(date) } },
      update: {},
      create: { classId, date: new Date(date), ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

/** The one action the whole module exists for: bulk-set every student's
 * mark for a register in one call and close it out (isDraft: false). */
router.post('/registers/:id/mark', requireSession, requirePermission('attendance.create'), async (req, res, next) => {
  try {
    const { records } = req.body || {};
    if (!Array.isArray(records) || !records.length) throw badRequest('records_array_required');
    for (const r of records) {
      if (!r.studentId || !['PRESENT', 'ABSENT', 'LATE'].includes(r.mark)) throw badRequest('invalid_record', `Each record needs studentId and a valid mark: ${JSON.stringify(r)}`);
    }

    const register = await prisma.attendanceRegister.findUnique({ where: { id: req.params.id } });
    if (!register || register.deletedAt) throw notFound();

    const staffId = await actingStaffId(req.session);

    await prisma.$transaction([
      ...records.map(r => prisma.attendanceRecord.upsert({
        where: { registerId_studentId: { registerId: req.params.id, studentId: r.studentId } },
        update: { mark: r.mark },
        create: { registerId: req.params.id, studentId: r.studentId, mark: r.mark },
      })),
      prisma.attendanceRegister.update({
        where: { id: req.params.id },
        data: { isDraft: false, markedById: staffId, markedAt: new Date(), updatedById: req.session.userId, version: { increment: 1 } },
      }),
    ]);

    await writeAuditEntry({ session: req.session, action: 'attendance.register.marked', detail: { registerId: req.params.id, count: records.length } });
    const updated = await prisma.attendanceRegister.findUnique({ where: { id: req.params.id }, include: { records: true } });
    res.json(updated);
  } catch (err) { next(err); }
});

/** A student's attendance history over time — nothing else answers this;
 * every other route here is register-first (one class, one day), not
 * student-first. Scope-checked so a parent/student can only ever pull
 * their own. */
router.get('/records', requireSession, requirePermission('attendance.view'), async (req, res, next) => {
  try {
    const { studentId, from, to } = req.query;
    if (!studentId) throw badRequest('studentId_required');
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(studentId)) throw notFound();

    const rows = await prisma.attendanceRecord.findMany({
      where: {
        studentId,
        register: {
          deletedAt: null,
          ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
        },
      },
      include: { register: { select: { date: true, classId: true } } },
      orderBy: { register: { date: 'desc' } },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.delete('/registers/:id', requireSession, requirePermission('attendance.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.attendanceRegister.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.attendanceRegister.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
