'use strict';

const express = require('express');
const crypto = require('crypto');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { assertPermission } = require('../rbac/permissionEngine');
const { pick } = require('../lib/pick');
const { coerceDates, toDate } = require('../lib/dates');
const { forCreate, forUpdate, forDelete, forRestore } = require('../lib/stamps');
const { parsePagination, searchClause, meta } = require('../lib/pagination');
const { checkVersion } = require('../lib/version');
const { notFound, badRequest } = require('../lib/httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');

const router = express.Router();

const APPLICATION_FIELDS = ['firstName', 'lastName', 'gender', 'dob', 'applyingFor', 'guardianName', 'guardianPhone', 'previousSchool', 'examScore', 'feePaid'];
const STAGE_ORDER = ['SUBMITTED', 'PAYMENT_CONFIRMED', 'UNDER_REVIEW', 'SHORTLISTED', 'EXAM_TAKEN', 'INTERVIEWED', 'OFFERED', 'ENROLLED', 'REJECTED'];

async function nextRef() {
  const year = new Date().getFullYear();
  const count = await prisma.application.count({ where: { ref: { startsWith: `FA/ADM/${year}/` } } });
  return `FA/ADM/${year}/${String(count + 1).padStart(4, '0')}`;
}

// ------------------------------------------------------------- public intake --
// A prospective family submits this with no session — the school's whole
// front door for admissions.

router.post('/public', async (req, res, next) => {
  try {
    const { firstName, lastName, gender, dob, applyingFor, guardianName, guardianPhone, previousSchool } = req.body || {};
    if (!firstName || !lastName || !gender || !dob || !applyingFor || !guardianName || !guardianPhone) {
      throw badRequest('missing_required_fields');
    }
    const row = await prisma.application.create({
      data: {
        ref: await nextRef(),
        firstName, lastName, gender, dob: toDate(dob), applyingFor, guardianName, guardianPhone, previousSchool,
        submittedOn: new Date(),
        status: 'ACTIVE',
      },
    });
    res.status(201).json({ ref: row.ref, id: row.id });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------- admin CRUD --

router.get('/', requireSession, requirePermission('admissions.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = {
      deletedAt: req.query.includeDeleted ? undefined : null,
      ...searchClause(req.query.q, ['firstName', 'lastName', 'ref', 'guardianName']),
      ...(req.query.stage ? { stage: req.query.stage } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.application.findMany({ where, skip, take, orderBy: { submittedOn: 'desc' } }),
      prisma.application.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.get('/:id', requireSession, requirePermission('admissions.view'), async (req, res, next) => {
  try {
    const row = await prisma.application.findUnique({ where: { id: req.params.id }, include: { cbtAttempts: true } });
    if (!row || row.deletedAt) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/', requireSession, requirePermission('admissions.create'), async (req, res, next) => {
  try {
    const { firstName, lastName, gender, dob, applyingFor, guardianName, guardianPhone } = req.body || {};
    if (!firstName || !lastName || !gender || !dob || !applyingFor || !guardianName || !guardianPhone) {
      throw badRequest('missing_required_fields');
    }
    const row = await prisma.application.create({
      data: {
        ref: await nextRef(),
        ...coerceDates(pick(req.body, APPLICATION_FIELDS), ['dob']),
        submittedOn: toDate(req.body.submittedOn) || new Date(),
        ...forCreate(req.session),
      },
    });
    await writeAuditEntry({ session: req.session, action: 'admissions.application.created', detail: { id: row.id, ref: row.ref } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/:id', requireSession, requirePermission('admissions.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    checkVersion(existing, req.body);
    const row = await prisma.application.update({
      where: { id: req.params.id },
      data: { ...coerceDates(pick(req.body, APPLICATION_FIELDS), ['dob']), ...forUpdate(req.session), version: { increment: 1 } },
    });
    await writeAuditEntry({ session: req.session, action: 'admissions.application.updated', detail: { id: row.id } });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/:id', requireSession, requirePermission('admissions.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.application.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/:id/restore', requireSession, requirePermission('admissions.restore'), async (req, res, next) => {
  try {
    const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
    if (!existing || !existing.deletedAt) throw notFound();
    const row = await prisma.application.update({ where: { id: req.params.id }, data: forRestore(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

// -------------------------------------------------------- stage transitions --
// REJECTED can happen from any stage (admissions.reject); every other move
// requires admissions.approve. Moving to ENROLLED, given a class + session,
// creates the actual Student record — the point where an applicant becomes
// a student.

router.patch('/:id/stage', requireSession, async (req, res, next) => {
  try {
    const { stage, classId, academicSessionId } = req.body || {};
    if (!STAGE_ORDER.includes(stage)) throw badRequest('invalid_stage');

    assertPermission(req.session, stage === 'REJECTED' ? 'admissions.reject' : 'admissions.approve');

    const existing = await prisma.application.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();

    if (stage === 'ENROLLED') {
      if (!classId || !academicSessionId) throw badRequest('classId_and_academicSessionId_required_to_enroll');
      const result = await prisma.$transaction(async tx => {
        const application = await tx.application.update({
          where: { id: req.params.id },
          data: { stage, ...forUpdate(req.session), version: { increment: 1 } },
        });
        const student = await tx.student.create({
          data: {
            admissionNo: `FA/${new Date().getFullYear()}/${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
            firstName: application.firstName,
            lastName: application.lastName,
            gender: application.gender,
            dob: application.dob,
            enrolledOn: new Date(),
            ...forCreate(req.session),
          },
        });
        const enrollment = await tx.studentEnrollment.create({
          data: { studentId: student.id, classId, academicSessionId, ...forCreate(req.session) },
        });
        await tx.studentTimelineEvent.create({
          data: { studentId: student.id, category: 'ENROLLMENT', title: 'Admitted from application', occurredOn: new Date(), createdById: req.session.userId },
        });
        return { application, student, enrollment };
      });
      await writeAuditEntry({ session: req.session, action: 'admissions.application.enrolled', detail: { id: req.params.id, studentId: result.student.id } });
      return res.json(result);
    }

    const row = await prisma.application.update({
      where: { id: req.params.id },
      data: { stage, ...forUpdate(req.session), version: { increment: 1 } },
    });
    await writeAuditEntry({ session: req.session, action: 'admissions.application.stage_changed', detail: { id: row.id, stage } });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
