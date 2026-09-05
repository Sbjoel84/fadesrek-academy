'use strict';

const express = require('express');
const prisma = require('../db/prisma');
const { requireSession } = require('../auth/session');
const { requirePermission } = require('../lib/requirePermission');
const { sumKobo, koboToNaira, groupCount } = require('../ai/analytics');
const { getCurrentTerm } = require('../lib/academicCalendar');
const { badRequest, notFound } = require('../lib/httpErrors');
const { toCsv, toXlsx, toPdfTable } = require('../lib/exporters');

const router = express.Router();

// Read-only aggregate endpoints, built the same way the AI intents already
// compute these numbers (server/ai/intents/*) — reused here under the
// `reports` module's own permission instead of each module's, since
// "give me the picture across the school" is its own access grant
// (PRINCIPAL, VICE_PRINCIPAL, BURSAR, HR_MANAGER all hold reports.view
// without necessarily holding every underlying module's .view).
//
// Each report is a plain computeXxx() function returning
// { columns, rows, ...summary } — `columns`/`rows` is the tabular shape
// /:report/export formats to CSV/XLSX/PDF; `...summary` is extra
// dashboard-only detail (breakdowns, totals) the JSON route also returns.
// One computation, two consumers, so "view" and "export" can never disagree
// with each other.

async function computeEnrollmentSummary() {
  const students = await prisma.student.findMany({
    where: { deletedAt: null },
    include: { enrollments: { orderBy: { createdAt: 'desc' }, take: 1, include: { class: true } } },
  });
  const columns = [
    { key: 'admissionNo', label: 'Admission No' }, { key: 'name', label: 'Name' },
    { key: 'gender', label: 'Gender' }, { key: 'class', label: 'Class' },
    { key: 'lifecycleStatus', label: 'Status' }, { key: 'boarder', label: 'Boarder' },
  ];
  const rows = students.map(s => ({
    admissionNo: s.admissionNo, name: `${s.firstName} ${s.lastName}`, gender: s.gender,
    class: s.enrollments[0] ? `${s.enrollments[0].class.level} ${s.enrollments[0].class.arm}` : '—',
    lifecycleStatus: s.lifecycleStatus, boarder: s.boarder ? 'Yes' : 'No',
  }));
  return {
    columns, rows,
    total: students.length,
    byGender: groupCount(students, s => s.gender),
    byLifecycleStatus: groupCount(students, s => s.lifecycleStatus),
    boarders: students.filter(s => s.boarder).length,
  };
}

async function computeFeesSummary() {
  const term = await getCurrentTerm();
  if (!term) throw badRequest('no_current_term');
  const invoices = await prisma.invoice.findMany({
    where: { termId: term.id, deletedAt: null },
    include: { lines: true, payments: { where: { reversed: false } }, student: { select: { firstName: true, lastName: true, admissionNo: true } } },
  });
  const invoicedKobo = invoices.reduce((sum, inv) => sum + sumKobo(inv.lines), 0n);
  const paidKobo = invoices.reduce((sum, inv) => sum + sumKobo(inv.payments), 0n);
  const columns = [
    { key: 'admissionNo', label: 'Admission No' }, { key: 'name', label: 'Name' },
    { key: 'invoicedNaira', label: 'Invoiced (₦)' }, { key: 'paidNaira', label: 'Paid (₦)' }, { key: 'outstandingNaira', label: 'Outstanding (₦)' },
  ];
  const rows = invoices.map(inv => {
    const inv_ = sumKobo(inv.lines), paid_ = sumKobo(inv.payments);
    return {
      admissionNo: inv.student.admissionNo, name: `${inv.student.firstName} ${inv.student.lastName}`,
      invoicedNaira: koboToNaira(inv_), paidNaira: koboToNaira(paid_), outstandingNaira: koboToNaira(inv_ - paid_),
    };
  });
  return {
    columns, rows, term: term.name, invoiceCount: invoices.length,
    invoicedNaira: koboToNaira(invoicedKobo), paidNaira: koboToNaira(paidKobo), outstandingNaira: koboToNaira(invoicedKobo - paidKobo),
  };
}

async function computeAttendanceSummary(req) {
  const date = req.query.date ? new Date(req.query.date) : new Date(new Date().toISOString().slice(0, 10));
  const registers = await prisma.attendanceRegister.findMany({
    where: { date, deletedAt: null },
    include: { records: true, class: true },
  });
  const records = registers.flatMap(r => r.records);
  const columns = [
    { key: 'class', label: 'Class' }, { key: 'marked', label: 'Marked' },
    { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'late', label: 'Late' },
  ];
  const rows = registers.map(r => ({
    class: `${r.class.level} ${r.class.arm}`, marked: r.isDraft ? 'No' : 'Yes',
    present: r.records.filter(x => x.mark === 'PRESENT').length,
    absent: r.records.filter(x => x.mark === 'ABSENT').length,
    late: r.records.filter(x => x.mark === 'LATE').length,
  }));
  return {
    columns, rows, date: date.toISOString().slice(0, 10),
    registersMarked: registers.filter(r => !r.isDraft).length, registersTotal: registers.length,
    byMark: groupCount(records, r => r.mark),
  };
}

async function computePayrollSummary(req) {
  const run = req.query.month
    ? await prisma.payrollRun.findUnique({ where: { month: new Date(req.query.month) } })
    : await prisma.payrollRun.findFirst({ where: { deletedAt: null }, orderBy: { month: 'desc' } });
  if (!run) throw badRequest('no_payroll_run_found');
  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: run.id, deletedAt: null },
    include: { staff: { select: { firstName: true, lastName: true, staffNo: true } } },
  });
  const columns = [
    { key: 'staffNo', label: 'Staff No' }, { key: 'name', label: 'Name' },
    { key: 'grossNaira', label: 'Gross (₦)' }, { key: 'netNaira', label: 'Net (₦)' },
  ];
  const rows = payslips.map(p => ({
    staffNo: p.staff.staffNo, name: `${p.staff.firstName} ${p.staff.lastName}`,
    grossNaira: koboToNaira(p.grossKobo), netNaira: koboToNaira(p.netPayKobo),
  }));
  return {
    columns, rows, month: run.month, status: run.runStatus, staffCount: run.staffCount,
    grossNaira: koboToNaira(run.grossTotalKobo), netNaira: koboToNaira(run.netTotalKobo),
  };
}

/** Ported directly from the mock PAGES.reports (script.js) — class
 * performance and subject performance, for the current term, off real
 * Score/Student/SchoolClass/Subject data. Subject performance is
 * dashboard-only (JSON); the exportable table is class performance, one row
 * per class — a single-table export stays simple to reason about. */
async function computeAcademicReport() {
  const term = await getCurrentTerm();
  if (!term) throw badRequest('no_current_term');

  const classes = await prisma.schoolClass.findMany({ where: { deletedAt: null } });
  const enrollments = await prisma.studentEnrollment.findMany({
    where: { academicSessionId: term.academicSessionId, deletedAt: null },
    select: { studentId: true, classId: true },
  });
  const scores = await prisma.score.findMany({ where: { termId: term.id, deletedAt: null }, include: { subject: true } });

  const totalsByStudent = new Map();
  for (const s of scores) totalsByStudent.set(s.studentId, (totalsByStudent.get(s.studentId) || 0) + s.value);
  const subjectsByStudent = new Map();
  for (const s of scores) {
    if (!subjectsByStudent.has(s.studentId)) subjectsByStudent.set(s.studentId, new Set());
    subjectsByStudent.get(s.studentId).add(s.subjectId);
  }
  const avgByStudent = new Map();
  for (const [studentId, total] of totalsByStudent) {
    const count = subjectsByStudent.get(studentId)?.size || 1;
    avgByStudent.set(studentId, total / count);
  }

  const byClass = classes.map(c => {
    const studentIds = enrollments.filter(e => e.classId === c.id).map(e => e.studentId);
    const avgs = studentIds.map(id => avgByStudent.get(id) || 0);
    const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0;
    const passing = avgs.filter(a => a >= 50).length;
    return { class: `${c.level} ${c.arm}`, count: studentIds.length, average: Math.round(avg * 10) / 10, passing, passRate: studentIds.length ? Math.round(passing / studentIds.length * 100) : 0 };
  });

  const bySubjectMap = new Map();
  for (const s of scores) {
    const key = s.subjectId;
    if (!bySubjectMap.has(key)) bySubjectMap.set(key, { name: s.subject.name, code: s.subject.code, total: 0, count: 0, passing: 0 });
    const acc = bySubjectMap.get(key);
    acc.total += s.value; acc.count += 1; if (s.value >= 40) acc.passing += 1;
  }
  const subjectPerformance = [...bySubjectMap.values()]
    .map(a => ({ name: a.name, code: a.code, average: Math.round(a.total / a.count * 10) / 10, passRate: Math.round(a.passing / a.count * 100), entries: a.count }))
    .sort((a, b) => b.average - a.average);

  return {
    columns: [
      { key: 'class', label: 'Class' }, { key: 'count', label: 'Students' }, { key: 'average', label: 'Average' },
      { key: 'passing', label: 'Passing' }, { key: 'passRate', label: 'Pass rate %' },
    ],
    rows: byClass,
    term: term.name, subjectPerformance,
  };
}

async function computeInventoryReport() {
  const items = await prisma.inventoryItem.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  const columns = [
    { key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'quantity', label: 'Quantity' },
    { key: 'reorderLevel', label: 'Reorder level' }, { key: 'belowReorder', label: 'Below reorder' }, { key: 'valueNaira', label: 'Value (₦)' },
  ];
  const rows = items.map(i => ({
    name: i.name, category: i.category, quantity: i.quantity, reorderLevel: i.reorderLevel,
    belowReorder: i.quantity < i.reorderLevel ? 'Yes' : 'No', valueNaira: koboToNaira(BigInt(i.quantity) * i.unitCostKobo),
  }));
  const totalValueKobo = items.reduce((t, i) => t + BigInt(i.quantity) * i.unitCostKobo, 0n);
  return {
    columns, rows,
    itemCount: items.length, belowReorderCount: items.filter(i => i.quantity < i.reorderLevel).length,
    totalValueNaira: koboToNaira(totalValueKobo),
  };
}

async function computeHrReport() {
  const staff = await prisma.staff.findMany({ where: { deletedAt: null }, select: { department: true } });
  const leaveRequests = await prisma.leaveRequest.findMany({ where: { deletedAt: null }, select: { leaveStatus: true } });
  const byDepartment = groupCount(staff, s => s.department);
  const columns = [{ key: 'department', label: 'Department' }, { key: 'headcount', label: 'Headcount' }];
  const rows = Object.entries(byDepartment).map(([department, headcount]) => ({ department, headcount }));
  return {
    columns, rows,
    staffCount: staff.length, byLeaveStatus: groupCount(leaveRequests, l => l.leaveStatus),
  };
}

async function computeRevenueTrend() {
  const payments = await prisma.payment.findMany({
    where: { deletedAt: null, reversed: false },
    select: { amountKobo: true, paidOn: true },
    orderBy: { paidOn: 'asc' },
  });
  const byMonth = new Map();
  for (const p of payments) {
    const key = p.paidOn.toISOString().slice(0, 7); // "2026-06"
    byMonth.set(key, (byMonth.get(key) || 0n) + p.amountKobo);
  }
  const rows = [...byMonth.entries()].map(([month, kobo]) => ({ month, totalNaira: koboToNaira(kobo) }));
  return { columns: [{ key: 'month', label: 'Month' }, { key: 'totalNaira', label: 'Total (₦)' }], rows };
}

const REPORTS = {
  enrollment: computeEnrollmentSummary,
  fees: computeFeesSummary,
  attendance: computeAttendanceSummary,
  payroll: computePayrollSummary,
  academic: computeAcademicReport,
  inventory: computeInventoryReport,
  hr: computeHrReport,
  'revenue-trend': computeRevenueTrend,
};

router.get('/enrollment-summary', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeEnrollmentSummary()); } catch (err) { next(err); }
});
router.get('/fees-summary', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeFeesSummary()); } catch (err) { next(err); }
});
router.get('/attendance-summary', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeAttendanceSummary(req)); } catch (err) { next(err); }
});
router.get('/payroll-summary', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computePayrollSummary(req)); } catch (err) { next(err); }
});
router.get('/academic-report', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeAcademicReport()); } catch (err) { next(err); }
});
router.get('/inventory-report', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeInventoryReport()); } catch (err) { next(err); }
});
router.get('/hr-report', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeHrReport()); } catch (err) { next(err); }
});
router.get('/revenue-trend', requireSession, requirePermission('reports.view'), async (req, res, next) => {
  try { res.json(await computeRevenueTrend()); } catch (err) { next(err); }
});

/** Same computation as the JSON routes above, formatted to a file instead
 * of a response body. Generated synchronously in the request — fine at this
 * dataset's scale; a whole-school run at real scale belongs on a worker, not
 * blocking an HTTP connection (see the mock UI's own note this replaces). */
router.get('/:report/export', requireSession, requirePermission('reports.export'), async (req, res, next) => {
  try {
    const compute = REPORTS[req.params.report];
    if (!compute) throw notFound('unknown_report');
    const format = (req.query.format || 'csv').toLowerCase();
    const { columns, rows } = await compute(req);
    const filename = `${req.params.report}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(toCsv(columns, rows));
    }
    if (format === 'xlsx') {
      const buffer = await toXlsx(req.params.report, columns, rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }
    if (format === 'pdf') {
      const buffer = await toPdfTable(req.params.report, columns, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      return res.send(buffer);
    }
    throw badRequest('unknown_format');
  } catch (err) { next(err); }
});

module.exports = router;
