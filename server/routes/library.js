'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { forCreate, forUpdate } = require('../lib/stamps');
const { toDate } = require('../lib/dates');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest, conflict } = require('../lib/httpErrors');
const { mountSimpleCrud } = require('../lib/simpleCrud');
const { actingStaffId } = require('../lib/actingStaff');

const router = express.Router();

mountSimpleCrud(router, '/books', {
  model: 'book',
  module: 'library',
  fields: ['title', 'author', 'category', 'copies'],
  searchFields: ['title', 'author'],
});

router.get('/loans', requireSession, requirePermission('library.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(req.query.outstanding ? { returnedOn: null } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.bookLoan.findMany({ where, skip, take, orderBy: { borrowedOn: 'desc' }, include: { book: true } }),
      prisma.bookLoan.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.post('/loans', requireSession, requirePermission('library.create'), async (req, res, next) => {
  try {
    const { bookId, studentId, dueOn } = req.body || {};
    if (!bookId || !studentId || !dueOn) throw badRequest('bookId_studentId_dueOn_required');
    const staffId = await actingStaffId(req.session);
    const row = await prisma.bookLoan.create({
      data: { bookId, studentId, dueOn: toDate(dueOn), borrowedOn: new Date(), issuedById: staffId, ...forCreate(req.session) },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

router.post('/loans/:id/return', requireSession, requirePermission('library.edit'), async (req, res, next) => {
  try {
    const existing = await prisma.bookLoan.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    if (existing.returnedOn) throw conflict('already_returned');
    const { fineKobo } = req.body || {};
    const row = await prisma.bookLoan.update({
      where: { id: req.params.id },
      data: { returnedOn: new Date(), fineKobo: fineKobo ?? 0, ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

module.exports = router;
