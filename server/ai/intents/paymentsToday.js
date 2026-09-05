'use strict';

const prisma = require('../../db/prisma');
const { scopeToStudentIds } = require('../../rbac/permissionEngine');
const { today, sumKobo, koboToNaira } = require('../analytics');

module.exports = {
  description: "Lists payments received today. Use for 'who paid today'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'finance.view',

  async run(session, scope) {
    const date = today();
    const studentIds = await scopeToStudentIds(scope);

    const payments = await prisma.payment.findMany({
      where: {
        paidOn: date,
        reversed: false,
        deletedAt: null,
        ...(studentIds ? { studentId: { in: studentIds } } : {}),
      },
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      date: date.toISOString().slice(0, 10),
      paymentCount: payments.length,
      totalNaira: koboToNaira(sumKobo(payments)),
      payments: payments.slice(0, 25).map(p => ({
        name: `${p.student.firstName} ${p.student.lastName}`,
        admissionNo: p.student.admissionNo,
        amountNaira: koboToNaira(p.amountKobo),
        method: p.method,
        reference: p.reference,
      })),
      truncated: payments.length > 25,
    };
  },
};
