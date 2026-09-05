'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { forCreate, forUpdate } = require('../lib/stamps');
const { toDate } = require('../lib/dates');
const { parsePagination, meta } = require('../lib/pagination');
const { notFound, badRequest, conflict } = require('../lib/httpErrors');
const { writeAuditEntry } = require('../audit/auditLog');

const router = express.Router();

const PAYSLIP_FIELDS = ['staffId', 'grossKobo', 'basicKobo', 'housingKobo', 'transportKobo', 'otherKobo',
  'pensionEmployeeKobo', 'pensionEmployerKobo', 'nhfKobo', 'rentReliefKobo', 'taxableKobo', 'annualTaxKobo', 'netPayKobo'];

function sumField(payslips, field) {
  return payslips.reduce((total, p) => total + BigInt(p[field] ?? 0), 0n);
}

router.get('/runs', requireSession, requirePermission('payroll.view'), async (req, res, next) => {
  try {
    const { page, pageSize, skip, take } = parsePagination(req.query);
    const where = { deletedAt: null };
    const [data, total] = await Promise.all([
      prisma.payrollRun.findMany({ where, skip, take, orderBy: { month: 'desc' } }),
      prisma.payrollRun.count({ where }),
    ]);
    res.json({ data, meta: meta(page, pageSize, total) });
  } catch (err) { next(err); }
});

router.get('/runs/:id', requireSession, requirePermission('payroll.view'), async (req, res, next) => {
  try {
    const row = await prisma.payrollRun.findUnique({
      where: { id: req.params.id },
      include: { payslips: { include: { staff: { select: { firstName: true, lastName: true, staffNo: true } } } } },
    });
    if (!row || row.deletedAt) throw notFound();
    res.json(row);
  } catch (err) { next(err); }
});

/** Payslip lines arrive pre-computed (gross/PAYE/pension/NHF/net per staff)
 * — this endpoint doesn't run a tax engine, it aggregates what it's given
 * into the run's totals server-side, rather than trusting a client-supplied
 * aggregate directly. */
router.post('/runs', requireSession, requirePermission('payroll.create'), async (req, res, next) => {
  try {
    const { month, payslips } = req.body || {};
    if (!month || !Array.isArray(payslips) || !payslips.length) throw badRequest('month_and_payslips_required');

    const run = await prisma.$transaction(async tx => {
      const created = await tx.payrollRun.create({
        data: {
          month: toDate(month),
          grossTotalKobo: sumField(payslips, 'grossKobo'),
          payeTotalKobo: sumField(payslips, 'annualTaxKobo'),
          pensionTotalKobo: sumField(payslips, 'pensionEmployeeKobo'),
          nhfTotalKobo: sumField(payslips, 'nhfKobo'),
          netTotalKobo: sumField(payslips, 'netPayKobo'),
          staffCount: payslips.length,
          ...forCreate(req.session),
        },
      });
      for (const p of payslips) {
        await tx.payslip.create({
          data: {
            payrollRunId: created.id,
            ...Object.fromEntries(PAYSLIP_FIELDS.filter(f => p[f] !== undefined).map(f => [f, p[f]])),
            ...forCreate(req.session),
          },
        });
      }
      return created;
    });

    await writeAuditEntry({ session: req.session, action: 'payroll.run.created', detail: { id: run.id, staffCount: run.staffCount } });
    res.status(201).json(run);
  } catch (err) { next(err); }
});

router.post('/runs/:id/approve', requireSession, requirePermission('payroll.approve'), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run || run.deletedAt) throw notFound();
    if (run.runStatus !== 'AWAITING_APPROVAL') throw conflict('not_awaiting_approval');
    const row = await prisma.payrollRun.update({
      where: { id: req.params.id },
      data: { runStatus: 'APPROVED', approvedOn: new Date(), ...forUpdate(req.session), version: { increment: 1 } },
    });
    await writeAuditEntry({ session: req.session, action: 'payroll.run.approved', detail: { id: row.id } });
    res.json(row);
  } catch (err) { next(err); }
});

router.post('/runs/:id/mark-paid', requireSession, requirePermission('payroll.approve'), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run || run.deletedAt) throw notFound();
    if (run.runStatus !== 'APPROVED') throw conflict('not_approved');
    const row = await prisma.payrollRun.update({
      where: { id: req.params.id },
      data: { runStatus: 'PAID', ...forUpdate(req.session), version: { increment: 1 } },
    });
    res.json(row);
  } catch (err) { next(err); }
});

router.get('/payslips', requireSession, requirePermission('payroll.view'), async (req, res, next) => {
  try {
    const where = { deletedAt: null, ...(req.query.staffId ? { staffId: req.query.staffId } : {}) };
    const rows = await prisma.payslip.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
