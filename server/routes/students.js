'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { pick } = require('../lib/pick');
const { coerceDates, toDate } = require('../lib/dates');
const { forCreate, forUpdate, forDelete, forRestore } = require('../lib/stamps');
const { parsePagination, searchClause, meta } = require('../lib/pagination');
const { checkVersion } = require('../lib/version');
const { notFound, badRequest } = require('../lib/httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');
const { getCurrentAcademicSession } = require('../lib/academicCalendar');
const { actingStaffId } = require('../lib/actingStaff');

const router = express.Router();

const STUDENT_FIELDS = ['admissionNo', 'firstName', 'lastName', 'gender', 'dob', 'boarder', 'usesTransport', 'enrolledOn', 'lifecycleStatus'];
const GUARDIAN_FIELDS = ['firstName', 'lastName', 'phone', 'email'];

/** Scope filtering shared by every list/get below — GLOBAL sees everyone,
 * everything else is narrowed to whatever resolveScope resolved for this
 * session (a class's roll, a parent's own children, a student's own
 * record). Mirrors exactly what the AI intents already do. */
async function scopedStudentIdFilter(session) {
  const scope = await resolveScope(session);
  return scopeToStudentIds(scope);
}

// ---------------------------------------------------------------- students --

router.get('/', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopedStudentIdFilter(req.session);
    const where = {
      deletedAt: req.query.includeDeleted ? undefined : null,
      ...searchClause(req.query.q, ['firstName', 'lastName', 'admissionNo']),
      ...(ids ? { id: { in: ids } } : {}),
      ...(req.query.lifecycleStatus ? { lifecycleStatus: req.query.lifecycleStatus } : {}),
      ...(req.query.classId ? { enrollments: { some: { classId: req.query.classId, deletedAt: null } } } : {}),
    };
    // Current class + primary guardian, inlined here so the list view can
    // render without an N+1 detail fetch per row — GET /:id below still
    // carries the fuller include (recent enrollment history, medical
    // profile) a single student's own page needs.
    const listInclude = {
      enrollments: { where: { deletedAt: null }, include: { class: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      guardians: { where: { isPrimary: true }, include: { guardian: true }, take: 1 },
    };
    const [data, total] = await Promise.all([
      prisma.student.findMany({ where, skip, take, orderBy: { lastName: 'asc' }, include: listInclude }),
      prisma.student.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.get('/:id', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const ids = await scopedStudentIdFilter(req.session);
    if (ids && !ids.includes(req.params.id)) throw notFound();
    const row = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: {
        guardians: { include: { guardian: true } },
        enrollments: { include: { class: true, academicSession: true }, orderBy: { createdAt: 'desc' }, take: 5 },
        medicalProfile: true,
      },
    });
    if (!row || row.deletedAt) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const row = await prisma.student.create({ data: { ...coerceDates(pick(req.body, STUDENT_FIELDS), ['dob', 'enrolledOn']), ...forCreate(req.session) } });
    await prisma.studentTimelineEvent.create({
      data: { studentId: row.id, category: 'ENROLLMENT', title: 'Admitted', occurredOn: row.enrolledOn, createdById: req.session.userId },
    });
    await writeAuditEntry({ session: req.session, action: 'students.student.created', detail: { id: row.id, admissionNo: row.admissionNo } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/:id', requireSession, requirePermission('students.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    checkVersion(existing, req.body);
    const row = await prisma.student.update({
      where: { id: req.params.id },
      data: { ...coerceDates(pick(req.body, STUDENT_FIELDS), ['dob', 'enrolledOn']), ...forUpdate(req.session), version: { increment: 1 } },
    });
    await writeAuditEntry({ session: req.session, action: 'students.student.updated', detail: { id: row.id } });
    res.json(row);
  } catch (err) { next(err); }
});

router.delete('/:id', requireSession, requirePermission('students.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.student.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    await writeAuditEntry({ session: req.session, action: 'students.student.deleted', detail: { id: row.id } });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/:id/restore', requireSession, requirePermission('students.restore'), async (req, res, next) => {
  try {
    const existing = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!existing || !existing.deletedAt) throw notFound();
    const row = await prisma.student.update({ where: { id: req.params.id }, data: forRestore(req.session) });
    await writeAuditEntry({ session: req.session, action: 'students.student.restored', detail: { id: row.id } });
    res.json(row);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- guardians --

router.get('/guardians/all', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { deletedAt: null, ...searchClause(req.query.q, ['firstName', 'lastName', 'phone', 'email']) };
    const [data, total] = await Promise.all([
      prisma.guardian.findMany({ where, skip, take, orderBy: { lastName: 'asc' } }),
      prisma.guardian.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/guardians', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const row = await prisma.guardian.create({ data: { ...pick(req.body, GUARDIAN_FIELDS), ...forCreate(req.session) } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/guardians/:id', requireSession, requirePermission('students.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.guardian.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    checkVersion(existing, req.body);
    const row = await prisma.guardian.update({
      where: { id: req.params.id },
      data: { ...pick(req.body, GUARDIAN_FIELDS), ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/:studentId/guardians', requireSession, requirePermission('students.edit'), async (req, res, next) => {
  try {
    const { guardianId, relationship, isPrimary } = req.body || {};
    if (!guardianId || !relationship) throw badRequest('guardian_and_relationship_required');
    const row = await prisma.studentGuardian.create({
      data: { studentId: req.params.studentId, guardianId, relationship, isPrimary: isPrimary ?? true },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.delete('/:studentId/guardians/:guardianId', requireSession, requirePermission('students.edit'), async (req, res, next) => {
  try {
    await prisma.studentGuardian.delete({
      where: { studentId_guardianId: { studentId: req.params.studentId, guardianId: req.params.guardianId } },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// -------------------------------------------------------------- enrollments --

router.get('/:studentId/enrollments', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const rows = await prisma.studentEnrollment.findMany({
      where: { studentId: req.params.studentId, deletedAt: null },
      include: { class: true, academicSession: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:studentId/enrollments', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const { classId, academicSessionId } = req.body || {};
    if (!classId || !academicSessionId) throw badRequest('class_and_session_required');
    const row = await prisma.studentEnrollment.create({
      data: { studentId: req.params.studentId, classId, academicSessionId, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ----------------------------------------------------------------- lifecycle --
// Promotion, graduation, transfer and withdrawal all pair a decision record
// with a change to Student.lifecycleStatus (and, for promotion, a new
// enrollment) — always in one transaction, so the two never disagree.

router.post('/:id/promote', requireSession, requirePermission('students.approve'), async (req, res, next) => {
  try {
    const { fromEnrollmentId, toClassId, outcome, remarks, decidedOn } = req.body || {};
    if (!fromEnrollmentId || !outcome || !decidedOn) throw badRequest('fromEnrollmentId_outcome_decidedOn_required');
    const fromEnrollment = await prisma.studentEnrollment.findUnique({ where: { id: fromEnrollmentId } });
    if (!fromEnrollment || fromEnrollment.studentId !== req.params.id) throw notFound();

    const result = await prisma.$transaction(async tx => {
      let toEnrollment = null;
      if (outcome !== 'REPEATED' && toClassId) {
        toEnrollment = await tx.studentEnrollment.create({
          data: {
            studentId: req.params.id,
            classId: toClassId,
            academicSessionId: fromEnrollment.academicSessionId,
            ...forCreate(req.session),
          },
        });
      }
      const decision = await tx.promotionDecision.create({
        data: {
          studentId: req.params.id,
          fromEnrollmentId,
          toEnrollmentId: toEnrollment?.id ?? null,
          outcome,
          remarks,
          decidedOn: toDate(decidedOn),
          ...forCreate(req.session),
        },
      });
      await tx.studentTimelineEvent.create({
        data: { studentId: req.params.id, category: 'LIFECYCLE', title: `Promotion: ${outcome}`, description: remarks, occurredOn: toDate(decidedOn), createdById: req.session.userId },
      });
      return decision;
    });

    await writeAuditEntry({ session: req.session, action: 'students.student.promoted', detail: { studentId: req.params.id, outcome } });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/:id/graduate', requireSession, requirePermission('students.approve'), async (req, res, next) => {
  try {
    const { classId, graduatedOn, remarks } = req.body || {};
    if (!classId || !graduatedOn) throw badRequest('classId_and_graduatedOn_required');
    const academicSession = await getCurrentAcademicSession();
    if (!academicSession) throw badRequest('no_current_academic_session');

    const result = await prisma.$transaction(async tx => {
      const record = await tx.graduationRecord.create({
        data: { studentId: req.params.id, classId, academicSessionId: academicSession.id, graduatedOn: toDate(graduatedOn), remarks, ...forCreate(req.session) },
      });
      await tx.student.update({ where: { id: req.params.id }, data: { lifecycleStatus: 'GRADUATED', updatedById: req.session.userId } });
      await tx.studentTimelineEvent.create({
        data: { studentId: req.params.id, category: 'LIFECYCLE', title: 'Graduated', description: remarks, occurredOn: toDate(graduatedOn), createdById: req.session.userId },
      });
      return record;
    });

    await writeAuditEntry({ session: req.session, action: 'students.student.graduated', detail: { studentId: req.params.id } });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.post('/:id/transfer', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const { direction, otherSchoolName, reason, requestedOn } = req.body || {};
    if (!direction || !otherSchoolName || !requestedOn) throw badRequest('direction_school_requestedOn_required');
    const row = await prisma.transferRecord.create({
      data: { studentId: req.params.id, direction, otherSchoolName, reason, requestedOn: toDate(requestedOn), ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/transfers/:id', requireSession, requirePermission('students.approve'), async (req, res, next) => {
  try {
    const existing = await prisma.transferRecord.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const { transferStatus, effectiveOn } = req.body || {};
    const result = await prisma.$transaction(async tx => {
      const record = await tx.transferRecord.update({
        where: { id: req.params.id },
        data: { transferStatus, effectiveOn: toDate(effectiveOn), ...forUpdate(req.session), version: { increment: 1 } },
      });
      if (transferStatus === 'COMPLETED' && existing.direction === 'OUTGOING') {
        await tx.student.update({ where: { id: existing.studentId }, data: { lifecycleStatus: 'TRANSFERRED', updatedById: req.session.userId } });
        await tx.studentTimelineEvent.create({
          data: { studentId: existing.studentId, category: 'LIFECYCLE', title: 'Transferred out', occurredOn: toDate(effectiveOn) || new Date(), createdById: req.session.userId },
        });
      }
      return record;
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/:id/withdraw', requireSession, requirePermission('students.approve'), async (req, res, next) => {
  try {
    const { reason, detail, withdrawnOn, refundKobo } = req.body || {};
    if (!reason || !withdrawnOn) throw badRequest('reason_and_withdrawnOn_required');
    const result = await prisma.$transaction(async tx => {
      const record = await tx.withdrawalRecord.create({
        data: { studentId: req.params.id, reason, detail, withdrawnOn: toDate(withdrawnOn), refundKobo: refundKobo ?? 0, ...forCreate(req.session) },
      });
      await tx.student.update({ where: { id: req.params.id }, data: { lifecycleStatus: 'WITHDRAWN', updatedById: req.session.userId } });
      await tx.studentTimelineEvent.create({
        data: { studentId: req.params.id, category: 'LIFECYCLE', title: 'Withdrawn', description: detail, occurredOn: toDate(withdrawnOn), createdById: req.session.userId },
      });
      return record;
    });
    await writeAuditEntry({ session: req.session, action: 'students.student.withdrawn', detail: { studentId: req.params.id, reason } });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ----------------------------------------------------------- certificates --

router.get('/:id/certificates', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const rows = await prisma.certificate.findMany({ where: { studentId: req.params.id, deletedAt: null }, orderBy: { issuedOn: 'desc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/certificates', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const { certificateType, serialNo, issuedOn, fileAssetId } = req.body || {};
    if (!certificateType || !serialNo || !issuedOn) throw badRequest('certificateType_serialNo_issuedOn_required');
    const row = await prisma.certificate.create({
      data: { studentId: req.params.id, certificateType, serialNo, issuedOn: toDate(issuedOn), fileAssetId, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/certificates/:id/revoke', requireSession, requirePermission('students.approve'), async (req, res, next) => {
  try {
    const existing = await prisma.certificate.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.certificate.update({
      where: { id: req.params.id },
      data: { revoked: true, ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------ documents --

router.get('/:id/documents', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const rows = await prisma.studentDocument.findMany({
      where: { studentId: req.params.id, deletedAt: null },
      include: { fileAsset: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/documents', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const { category, fileAssetId } = req.body || {};
    if (!category || !fileAssetId) throw badRequest('category_and_fileAssetId_required');
    const row = await prisma.studentDocument.create({
      data: { studentId: req.params.id, category, fileAssetId, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.patch('/documents/:id/verify', requireSession, requirePermission('students.approve'), async (req, res, next) => {
  try {
    const existing = await prisma.studentDocument.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const staffId = await actingStaffId(req.session);
    const row = await prisma.studentDocument.update({
      where: { id: req.params.id },
      data: { verifiedById: staffId, verifiedOn: new Date(), ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

// ----------------------------------------------------------------- biometrics --

router.get('/:id/biometrics', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const rows = await prisma.biometricRecord.findMany({ where: { studentId: req.params.id, deletedAt: null } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/biometrics', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const { type, templateRef, enrolledOn, deviceId } = req.body || {};
    if (!type || !templateRef || !enrolledOn) throw badRequest('type_templateRef_enrolledOn_required');
    const row = await prisma.biometricRecord.create({
      data: { studentId: req.params.id, type, templateRef, enrolledOn: toDate(enrolledOn), deviceId, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------- timeline --

router.get('/:id/timeline', requireSession, requirePermission('students.view'), async (req, res, next) => {
  try {
    const rows = await prisma.studentTimelineEvent.findMany({ where: { studentId: req.params.id }, orderBy: { occurredOn: 'desc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/:id/timeline', requireSession, requirePermission('students.create'), async (req, res, next) => {
  try {
    const { category, title, description, occurredOn } = req.body || {};
    if (!category || !title || !occurredOn) throw badRequest('category_title_occurredOn_required');
    const row = await prisma.studentTimelineEvent.create({
      data: { studentId: req.params.id, category, title, description, occurredOn: toDate(occurredOn), createdById: req.session.userId },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

module.exports = router;
