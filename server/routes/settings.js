'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { pick } = require('../lib/pick');
const { forCreate, forUpdate, forDelete, forRestore } = require('../lib/stamps');
const { parsePagination, searchClause, meta } = require('../lib/pagination');
const { checkVersion } = require('../lib/version');
const { notFound, badRequest, conflict } = require('../lib/httpErrors');
const { mountSimpleCrud } = require('../lib/simpleCrud');
const { getCurrentTerm } = require('../lib/academicCalendar');

const router = express.Router();

// Not permission-gated beyond requireSession — "what term is it" is basic
// context every signed-in role needs (a parent pulling a report card has no
// business holding settings.view just to find the current term), unlike
// editing the reference tables below.
router.get('/current-term', requireSession, async (req, res, next) => {
  try {
    const term = await getCurrentTerm();
    res.json(term);
  } catch (err) { next(err); }
});

// Same reasoning as /current-term: subject/period names and start times are
// reference data every role needs to render a timetable or a results table
// meaningfully — unlike the reference *tables themselves* (editable below,
// still behind settings.view/edit), reading the plain list isn't sensitive.
router.get('/subjects/lookup', requireSession, async (req, res, next) => {
  try {
    const rows = await prisma.subject.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/periods/lookup', requireSession, async (req, res, next) => {
  try {
    const rows = await prisma.period.findMany({ where: { deletedAt: null }, orderBy: { sequence: 'asc' }, select: { id: true, label: true, from: true, to: true, isBreak: true } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// Same reasoning again — "which classes exist" is reference data Students/
// Admissions/Attendance/etc. all need for a dropdown or a "which class is
// this student in" lookup, and most roles that browse those modules don't
// hold settings.view (Registrar, class/subject teachers, Librarian, ...).
router.get('/classes/lookup', requireSession, async (req, res, next) => {
  try {
    const rows = await prisma.schoolClass.findMany({ where: { deletedAt: null }, orderBy: [{ level: 'asc' }, { arm: 'asc' }], select: { id: true, level: true, arm: true, stream: true, capacity: true } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------- reference data --

mountSimpleCrud(router, '/academic-sessions', { model: 'academicSession', module: 'settings', fields: ['name'], searchFields: ['name'] });
mountSimpleCrud(router, '/terms', {
  model: 'term', module: 'settings',
  fields: ['academicSessionId', 'name', 'sequence', 'startsOn', 'endsOn', 'isCurrent'],
  dateFields: ['startsOn', 'endsOn'],
  where: req => (req.query.academicSessionId ? { academicSessionId: req.query.academicSessionId } : {}),
});
mountSimpleCrud(router, '/classes', { model: 'schoolClass', module: 'settings', fields: ['level', 'arm', 'stream', 'capacity'], searchFields: ['level', 'arm'] });
mountSimpleCrud(router, '/subjects', { model: 'subject', module: 'settings', fields: ['name', 'code', 'isCore', 'isJunior', 'isSenior'], searchFields: ['name', 'code'] });
mountSimpleCrud(router, '/periods', { model: 'period', module: 'settings', fields: ['label', 'from', 'to', 'isBreak', 'sequence'], orderBy: { sequence: 'asc' } });
mountSimpleCrud(router, '/salary-grades', { model: 'salaryGrade', module: 'settings', fields: ['code', 'name', 'grossAnnualKobo'], searchFields: ['code', 'name'] });
mountSimpleCrud(router, '/assessment-components', { model: 'assessmentComponent', module: 'settings', fields: ['key', 'label', 'maxScore'] });
mountSimpleCrud(router, '/grade-bands', { model: 'gradeBand', module: 'settings', fields: ['minPct', 'grade', 'remark'], orderBy: { minPct: 'desc' } });

// junction: which subjects a class offers
router.get('/classes/:classId/subjects', requireSession, requirePermission('settings.view'), async (req, res, next) => {
  try {
    const rows = await prisma.classSubject.findMany({ where: { classId: req.params.classId }, include: { subject: true } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/classes/:classId/subjects', requireSession, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const { subjectId } = req.body || {};
    if (!subjectId) throw badRequest('subjectId_required');
    const row = await prisma.classSubject.create({ data: { classId: req.params.classId, subjectId } });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.delete('/classes/:classId/subjects/:subjectId', requireSession, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    await prisma.classSubject.delete({ where: { classId_subjectId: { classId: req.params.classId, subjectId: req.params.subjectId } } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return next(notFound());
    next(err);
  }
});

// ----------------------------------------------------------------- RBAC read --

router.get('/roles', requireSession, requirePermission('settings.view'), async (req, res, next) => {
  try {
    const rows = await prisma.role.findMany({ where: { deletedAt: null }, include: { permissions: { include: { permission: true } } } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/permissions', requireSession, requirePermission('settings.view'), async (req, res, next) => {
  try {
    const rows = await prisma.permission.findMany({ where: { deletedAt: null }, orderBy: { key: 'asc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// -------------------------------------------------------------- user accounts --
// Login-credential admin — creating a User row is how a Staff/Guardian/
// Student person record gets turned into someone who can sign in. Reuses
// the exact bcrypt pattern auth/routes.js already established.

router.get('/users', requireSession, requirePermission('settings.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { deletedAt: null, ...searchClause(req.query.q, ['username', 'displayName']) };
    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take, orderBy: { displayName: 'asc' },
        select: { id: true, username: true, displayName: true, roleId: true, staffId: true, studentId: true, guardianId: true, homeroomClassId: true, status: true, version: true, createdAt: true },
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/users', requireSession, requirePermission('settings.create'), async (req, res, next) => {
  try {
    const { username, password, displayName, roleId, staffId, studentId, guardianId, homeroomClassId } = req.body || {};
    if (!username || !password || !displayName || !roleId) throw badRequest('username_password_displayName_roleId_required');
    if (password.length < 8) throw badRequest('password_too_short');

    const passwordHash = await bcrypt.hash(password, 10);
    const row = await prisma.user.create({
      data: { username, passwordHash, displayName, roleId, staffId, studentId, guardianId, homeroomClassId, ...forCreate(req.session) },
      select: { id: true, username: true, displayName: true, roleId: true, status: true },
    });
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'P2002') return next(conflict('username_taken'));
    next(err);
  }
});

router.patch('/users/:id', requireSession, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    checkVersion(existing, req.body);
    const row = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...pick(req.body, ['displayName', 'roleId', 'homeroomClassId']), ...forUpdate(req.session), version: { increment: 1 } },
      select: { id: true, username: true, displayName: true, roleId: true, status: true, version: true },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.patch('/users/:id/password', requireSession, requirePermission('settings.edit'), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 8) throw badRequest('password_too_short');
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash, ...forUpdate(req.session), version: { increment: 1 } } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/users/:id', requireSession, requirePermission('settings.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.user.update({ where: { id: req.params.id }, data: forDelete(req.session), select: { id: true, status: true } });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/users/:id/restore', requireSession, requirePermission('settings.restore'), async (req, res, next) => {
  try {
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing || !existing.deletedAt) throw notFound();
    const row = await prisma.user.update({ where: { id: req.params.id }, data: forRestore(req.session), select: { id: true, status: true } });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
