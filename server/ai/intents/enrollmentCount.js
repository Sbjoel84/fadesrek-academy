'use strict';

const prisma = require('../../db/prisma');
const { scopeToStudentIds } = require('../../rbac/permissionEngine');
const { getCurrentTerm } = require('../../lib/academicCalendar');
const { groupCount } = require('../analytics');

module.exports = {
  description: "Counts students enrolled this term, broken down by class. Use for questions like 'how many students enrolled this term'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'students.view',

  async run(session, scope) {
    const term = await getCurrentTerm();
    if (!term) return { error: 'no_current_term', message: 'No academic term is marked as current.' };

    const studentIds = await scopeToStudentIds(scope);

    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        academicSessionId: term.academicSessionId,
        deletedAt: null,
        status: 'ACTIVE',
        ...(studentIds ? { studentId: { in: studentIds } } : {}),
      },
      include: { class: { select: { level: true, arm: true } } },
    });

    const byClass = groupCount(enrollments, e => `${e.class.level} ${e.class.arm}`);

    return {
      term: term.name,
      academicSession: term.academicSession.name,
      totalEnrolled: enrollments.length,
      byClass,
    };
  },
};
