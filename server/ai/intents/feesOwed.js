'use strict';

const prisma = require('../../db/prisma');
const { scopeToStudentIds } = require('../../rbac/permissionEngine');
const { getCurrentTerm } = require('../../lib/academicCalendar');
const { sumKobo, koboToNaira } = require('../analytics');
const { feesOwedRecommendations } = require('../recommendations');

module.exports = {
  description: "Lists students who owe school fees this term (invoiced minus paid, where positive). Use for 'which students owe fees' / 'who has not paid'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'finance.view',

  async run(session, scope) {
    const term = await getCurrentTerm();
    if (!term) return { error: 'no_current_term', message: 'No academic term is marked as current.' };

    const studentIds = await scopeToStudentIds(scope);

    const invoices = await prisma.invoice.findMany({
      where: {
        termId: term.id,
        deletedAt: null,
        ...(studentIds ? { studentId: { in: studentIds } } : {}),
      },
      include: {
        lines: true,
        payments: { where: { reversed: false } },
        student: { select: { firstName: true, lastName: true, admissionNo: true } },
      },
    });

    const debtors = invoices
      .map(inv => {
        const invoiced = sumKobo(inv.lines);
        const paid = sumKobo(inv.payments);
        const outstanding = invoiced - paid;
        return { inv, outstanding };
      })
      .filter(d => d.outstanding > 0n)
      .sort((a, b) => (b.outstanding > a.outstanding ? 1 : -1));

    const totalOutstandingKobo = debtors.reduce((sum, d) => sum + d.outstanding, 0n);
    const list = debtors.slice(0, 25).map(d => ({
      name: `${d.inv.student.firstName} ${d.inv.student.lastName}`,
      admissionNo: d.inv.student.admissionNo,
      outstandingNaira: koboToNaira(d.outstanding),
    }));

    return {
      term: term.name,
      debtorCount: debtors.length,
      totalOutstandingNaira: koboToNaira(totalOutstandingKobo),
      students: list,
      truncated: debtors.length > list.length,
      recommendations: feesOwedRecommendations(debtors, koboToNaira(totalOutstandingKobo)),
    };
  },
};
