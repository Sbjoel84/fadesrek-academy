'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { forCreate, forUpdate, forDelete } = require('../lib/stamps');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest, conflict } = require('../lib/httpErrors');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

// ------------------------------------------------------------------- scores --

router.get('/scores', requireSession, requirePermission('examinations.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(req.query.subjectId ? { subjectId: req.query.subjectId } : {}),
      ...(req.query.termId ? { termId: req.query.termId } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.score.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      prisma.score.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

/** Upsert on the schema's own unique key — recording a score for a student
 * is idempotent per (student, subject, component, term), never a duplicate
 * row that needs reconciling later. */
router.post('/scores', requireSession, requirePermission('examinations.edit'), async (req, res, next) => {
  try {
    const { studentId, subjectId, componentId, academicSessionId, termId, value } = req.body || {};
    if (!studentId || !subjectId || !componentId || !academicSessionId || !termId || typeof value !== 'number') {
      throw badRequest('missing_required_fields');
    }
    const row = await prisma.score.upsert({
      where: { studentId_subjectId_componentId_termId: { studentId, subjectId, componentId, termId } },
      update: { value, ...forUpdate(req.session), version: { increment: 1 } },
      create: { studentId, subjectId, componentId, academicSessionId, termId, value, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.delete('/scores/:id', requireSession, requirePermission('examinations.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.score.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.score.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------- CBT --

mountSimpleCrud(router, '/cbt-exams', {
  model: 'cbtExam',
  module: 'examinations',
  fields: ['subjectCode', 'questionCount', 'durationMins', 'shuffle'],
  searchFields: ['subjectCode'],
});

router.get('/cbt-exams/:examId/questions', requireSession, requirePermission('examinations.view'), async (req, res, next) => {
  try {
    const rows = await prisma.cbtQuestion.findMany({
      where: { examId: req.params.examId, deletedAt: null },
      include: { options: true },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

/** A question and its options are authored together — never a bare
 * question with no answer key. */
router.post('/cbt-exams/:examId/questions', requireSession, requirePermission('examinations.create'), async (req, res, next) => {
  try {
    const { stem, options } = req.body || {};
    if (!stem || !Array.isArray(options) || options.length < 2) throw badRequest('stem_and_at_least_two_options_required');
    if (!options.some(o => o.isCorrect)) throw badRequest('at_least_one_correct_option_required');
    const row = await prisma.cbtQuestion.create({
      data: {
        examId: req.params.examId,
        stem,
        ...forCreate(req.session),
        options: { create: options.map((o, i) => ({ sequence: i + 1, text: o.text, isCorrect: !!o.isCorrect })) },
      },
      include: { options: true },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

/** Starts a timed attempt — freezes question order for the duration of the
 * sitting (see the schema's own note on CbtAttempt.questionOrder) and is
 * scope-checked so a STUDENT session can only ever start its own attempt. */
router.post('/cbt-exams/:examId/attempts', requireSession, requirePermission('examinations.view'), async (req, res, next) => {
  try {
    const { studentId, applicationId } = req.body || {};
    if (!studentId && !applicationId) throw badRequest('studentId_or_applicationId_required');

    if (studentId) {
      const ids = await scopeToStudentIds(await resolveScope(req.session));
      if (ids && !ids.includes(studentId)) throw notFound();
    }

    const exam = await prisma.cbtExam.findUnique({ where: { id: req.params.examId }, include: { questions: { select: { id: true } } } });
    if (!exam || exam.deletedAt) throw notFound();

    let order = exam.questions.map(q => q.id);
    if (exam.shuffle) order = order.sort(() => Math.random() - 0.5);

    const startedAt = new Date();
    const deadline = new Date(startedAt.getTime() + exam.durationMins * 60000);
    const row = await prisma.cbtAttempt.create({
      data: {
        examId: exam.id,
        candidateKind: studentId ? 'STUDENT' : 'APPLICANT',
        studentId: studentId || null,
        applicationId: applicationId || null,
        questionOrder: order,
        startedAt,
        deadline,
        ...forCreate(req.session),
      },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

/** Auto-grades against CbtQuestionOption.isCorrect — the score is always
 * computed server-side from the answer key, never trusted from the client. */
router.post('/cbt-attempts/:id/submit', requireSession, requirePermission('examinations.view'), async (req, res, next) => {
  try {
    const { answers } = req.body || {}; // [{ questionId, optionId }]
    if (!Array.isArray(answers)) throw badRequest('answers_array_required');

    const attempt = await prisma.cbtAttempt.findUnique({ where: { id: req.params.id } });
    if (!attempt || attempt.deletedAt) throw notFound();
    if (attempt.attemptStatus === 'GRADED') throw conflict('already_graded');

    if (attempt.studentId) {
      const ids = await scopeToStudentIds(await resolveScope(req.session));
      if (ids && !ids.includes(attempt.studentId)) throw notFound();
    }

    const correctOptions = await prisma.cbtQuestionOption.findMany({
      where: { questionId: { in: attempt.questionOrder }, isCorrect: true },
      select: { id: true, questionId: true },
    });
    const correctByQuestion = new Map(correctOptions.map(o => [o.questionId, o.id]));

    let score = 0;
    for (const a of answers) {
      if (correctByQuestion.get(a.questionId) === a.optionId) score += 1;
    }
    const percent = Math.round((score / attempt.questionOrder.length) * 100);

    const row = await prisma.cbtAttempt.update({
      where: { id: req.params.id },
      data: { submittedAt: new Date(), score, percent, attemptStatus: 'GRADED', ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/cbt-attempts', requireSession, requirePermission('examinations.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.examId ? { examId: req.query.examId } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.cbtAttempt.findMany({ where, skip, take, orderBy: { startedAt: 'desc' } }),
      prisma.cbtAttempt.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

// -------------------------------------------------------------- report card --

/** One aggregate read for the printable report card: scores, class
 * position, attendance rate and fee balance for one student/term, plus any
 * teacher remarks on file — composed the same way the AI intents already
 * read across tables (e.g. server/ai/intents/feesOwed.js), scope-checked so
 * a parent can only ever pull their own child's. */
router.get('/report-card', requireSession, requirePermission('examinations.view'), async (req, res, next) => {
  try {
    const { studentId, termId } = req.query;
    if (!studentId || !termId) throw badRequest('studentId_and_termId_required');
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    if (ids && !ids.includes(studentId)) throw notFound();

    const term = await prisma.term.findUnique({ where: { id: termId } });
    if (!term) throw notFound();
    const student = await prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.deletedAt) throw notFound();

    const enrollment = await prisma.studentEnrollment.findUnique({
      where: { studentId_academicSessionId: { studentId, academicSessionId: term.academicSessionId } },
      include: { class: true },
    });

    const scores = await prisma.score.findMany({
      where: { studentId, termId, deletedAt: null },
      include: { subject: true, component: true },
    });

    let classPosition = null;
    let classSize = null;
    let attendanceRate = null;

    if (enrollment) {
      const classmates = await prisma.studentEnrollment.findMany({
        where: { classId: enrollment.classId, academicSessionId: term.academicSessionId, deletedAt: null },
        select: { studentId: true },
      });
      const classmateIds = classmates.map(c => c.studentId);
      classSize = classmateIds.length;
      const classScores = await prisma.score.findMany({ where: { studentId: { in: classmateIds }, termId, deletedAt: null } });
      const totals = new Map();
      for (const s of classScores) totals.set(s.studentId, (totals.get(s.studentId) || 0) + s.value);
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      const idx = ranked.findIndex(([id]) => id === studentId);
      classPosition = idx === -1 ? null : idx + 1;

      const registers = await prisma.attendanceRegister.findMany({
        where: { classId: enrollment.classId, deletedAt: null, isDraft: false, date: { gte: term.startsOn, lte: term.endsOn } },
        select: { id: true },
      });
      if (registers.length) {
        const records = await prisma.attendanceRecord.findMany({
          where: { studentId, registerId: { in: registers.map(r => r.id) } },
        });
        const present = records.filter(r => r.mark !== 'ABSENT').length;
        attendanceRate = Math.round((present / registers.length) * 100);
      }
    }

    const invoice = await prisma.invoice.findUnique({
      where: { studentId_academicSessionId_termId: { studentId, academicSessionId: term.academicSessionId, termId } },
      include: { lines: true, payments: { where: { reversed: false } } },
    });
    let feeBalanceKobo = null;
    if (invoice) {
      const invoiced = invoice.lines.reduce((t, l) => t + l.amountKobo, 0n);
      const paid = invoice.payments.reduce((t, p) => t + p.amountKobo, 0n);
      feeBalanceKobo = invoiced - paid;
    }

    const remarks = await prisma.remark.findMany({
      where: { studentId, termId, deletedAt: null },
      include: { staff: { select: { firstName: true, lastName: true, position: true } } },
    });

    res.json({
      student: { id: student.id, firstName: student.firstName, lastName: student.lastName, admissionNo: student.admissionNo },
      term: { id: term.id, name: term.name },
      class: enrollment ? { id: enrollment.class.id, level: enrollment.class.level, arm: enrollment.class.arm } : null,
      scores,
      classPosition,
      classSize,
      attendanceRate,
      feeBalanceKobo,
      remarks,
    });
  } catch (err) { next(err); }
});

module.exports = router;
