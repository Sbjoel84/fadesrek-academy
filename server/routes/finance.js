'use strict';

const express = require('express');
const crypto = require('crypto');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { resolveScope, scopeToStudentIds } = require('../rbac/permissionEngine');
const { forCreate, forUpdate, forDelete } = require('../lib/stamps');
const { toDate } = require('../lib/dates');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest, conflict } = require('../lib/httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');
const { mountSimpleCrud } = require('../lib/simpleCrud');

const router = express.Router();

mountSimpleCrud(router, '/fee-items', {
  model: 'feeItem',
  module: 'finance',
  fields: ['name', 'amountKobo', 'appliesTo'],
  searchFields: ['name'],
});

mountSimpleCrud(router, '/scholarships', {
  model: 'scholarship',
  module: 'finance',
  fields: ['studentId', 'amountKobo', 'reason', 'awardedOn'],
  dateFields: ['awardedOn'],
  where: req => (req.query.studentId ? { studentId: req.query.studentId } : {}),
});

// ------------------------------------------------------------------ invoices --

router.get('/invoices', requireSession, requirePermission('finance.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(req.query.termId ? { termId: req.query.termId } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.invoice.findMany({ where, skip, take, orderBy: { issuedOn: 'desc' }, include: { lines: true, payments: { where: { reversed: false } } } }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.get('/invoices/:id', requireSession, requirePermission('finance.view'), async (req, res, next) => {
  try {
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const row = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { feeItem: true } }, payments: true, student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    });
    if (!row || row.deletedAt) throw notFound();
    if (ids && !ids.includes(row.studentId)) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

/** Snapshots FeeItem.amountKobo into InvoiceLine at issue time — the
 * schema's own stated intent (InvoiceLine comment: "snapshot ... at issue
 * time"), so a later fee-structure change never rewrites an issued
 * invoice. */
router.post('/invoices', requireSession, requirePermission('finance.create'), async (req, res, next) => {
  try {
    const { studentId, academicSessionId, termId, feeItemIds } = req.body || {};
    if (!studentId || !academicSessionId || !termId || !Array.isArray(feeItemIds) || !feeItemIds.length) {
      throw badRequest('studentId_session_term_feeItemIds_required');
    }
    const feeItems = await prisma.feeItem.findMany({ where: { id: { in: feeItemIds }, deletedAt: null } });
    if (feeItems.length !== feeItemIds.length) throw badRequest('unknown_fee_item');

    const invoice = await prisma.invoice.create({
      data: {
        studentId, academicSessionId, termId,
        issuedOn: new Date(),
        ...forCreate(req.session),
        lines: { create: feeItems.map(f => ({ feeItemId: f.id, amountKobo: f.amountKobo })) },
      },
      include: { lines: true },
    });
    await writeAuditEntry({ session: req.session, action: 'finance.invoice.created', detail: { id: invoice.id, studentId } });
    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

router.delete('/invoices/:id', requireSession, requirePermission('finance.delete'), async (req, res, next) => {
  try {
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.deletedAt) throw notFound();
    const row = await prisma.invoice.update({ where: { id: req.params.id }, data: forDelete(req.session) });
    res.json(row);
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------ payments --

const ACCOUNTS = { BANK_TRANSFER: 'bank', PAYSTACK: 'paystack_clearing', FLUTTERWAVE: 'flutterwave_clearing', CASH: 'cash' };

function generateReference() {
  return `PMT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

router.get('/payments', requireSession, requirePermission('finance.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const ids = await scopeToStudentIds(await resolveScope(req.session));
    const where = {
      deletedAt: null,
      ...(req.query.studentId ? { studentId: req.query.studentId } : {}),
      ...(req.query.invoiceId ? { invoiceId: req.query.invoiceId } : {}),
      ...(ids ? { studentId: { in: ids } } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.payment.findMany({ where, skip, take, orderBy: { paidOn: 'desc' } }),
      prisma.payment.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

/** A Payment is never written alone — it always pairs with a balanced
 * LedgerEntry debit/credit, in the same transaction, per the schema's
 * "double-entry" comment on LedgerEntry. */
router.post('/payments', requireSession, requirePermission('finance.create'), async (req, res, next) => {
  try {
    const { studentId, invoiceId, amountKobo, method, gatewayRef, paidOn } = req.body || {};
    if (!studentId || !amountKobo || !method || !paidOn) throw badRequest('studentId_amountKobo_method_paidOn_required');
    if (!ACCOUNTS[method]) throw badRequest('invalid_method');

    const reference = generateReference();
    const journalRef = `JNL-${reference}`;
    const paidOnDate = toDate(paidOn);

    const result = await prisma.$transaction(async tx => {
      const payment = await tx.payment.create({
        data: { studentId, invoiceId, amountKobo, method, gatewayRef, reference, paidOn: paidOnDate, ...forCreate(req.session) },
      });
      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          journalRef,
          paymentId: payment.id,
          debitAccount: ACCOUNTS[method],
          creditAccount: 'fees_receivable',
          amountKobo,
          postedOn: paidOnDate,
          ...forCreate(req.session),
        },
      });
      return { payment, ledgerEntry };
    });

    await writeAuditEntry({ session: req.session, action: 'finance.payment.recorded', detail: { id: result.payment.id, studentId, amountKobo: amountKobo.toString() } });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

/** A reversal is a compensating ledger entry, never an edit or a delete —
 * the running balance stays reconstructable from history alone. */
router.post('/payments/:id/reverse', requireSession, requirePermission('finance.approve'), async (req, res, next) => {
  try {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment || payment.deletedAt) throw notFound();
    if (payment.reversed) throw conflict('already_reversed');

    const original = await prisma.ledgerEntry.findFirst({ where: { paymentId: payment.id } });

    const result = await prisma.$transaction(async tx => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { reversed: true, ...forUpdate(req.session), version: { increment: 1 } },
      });
      const reversal = await tx.ledgerEntry.create({
        data: {
          journalRef: `${original?.journalRef ?? payment.reference}-REV`,
          paymentId: payment.id,
          debitAccount: original?.creditAccount ?? 'fees_receivable',
          creditAccount: original?.debitAccount ?? ACCOUNTS[payment.method],
          amountKobo: payment.amountKobo,
          postedOn: new Date(),
          ...forCreate(req.session),
        },
      });
      return { payment: updated, reversal };
    });

    await writeAuditEntry({ session: req.session, action: 'finance.payment.reversed', detail: { id: payment.id } });
    res.json(result);
  } catch (err) { next(err); }
});

// -------------------------------------------------------------------- ledger --

router.get('/ledger', requireSession, requirePermission('finance.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { deletedAt: null, ...(req.query.journalRef ? { journalRef: req.query.journalRef } : {}) };
    const [data, total] = await Promise.all([
      prisma.ledgerEntry.findMany({ where, skip, take, orderBy: { postedOn: 'desc' } }),
      prisma.ledgerEntry.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

module.exports = router;
