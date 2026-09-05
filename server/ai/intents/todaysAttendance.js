'use strict';

const prisma = require('../../db/prisma');
const { today } = require('../analytics');

module.exports = {
  description: "Shows today's student attendance: counts of present/absent/late, and who's marked absent. Use for 'show today's attendance'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'attendance.view',

  async run(session, scope) {
    const date = today();

    const registerWhere = { date, deletedAt: null, ...(scope.kind === 'CLASS' ? { classId: scope.classId } : {}) };

    let recordWhere = { register: registerWhere };
    if (scope.kind === 'SELF') recordWhere.studentId = scope.studentId;
    if (scope.kind === 'OWN_RECORDS') recordWhere.studentId = { in: scope.studentIds };

    const records = await prisma.attendanceRecord.findMany({
      where: recordWhere,
      include: { student: { select: { firstName: true, lastName: true, admissionNo: true } } },
    });

    const counts = { PRESENT: 0, ABSENT: 0, LATE: 0 };
    for (const r of records) counts[r.mark]++;

    const absentees = records
      .filter(r => r.mark === 'ABSENT')
      .slice(0, 25)
      .map(r => `${r.student.firstName} ${r.student.lastName} (${r.student.admissionNo})`);

    const registersMarked = await prisma.attendanceRegister.count({ where: { ...registerWhere, isDraft: false } });

    return {
      date: date.toISOString().slice(0, 10),
      totalRecords: records.length,
      counts,
      registersFinalized: registersMarked,
      absentees,
      absenteesTruncated: counts.ABSENT > absentees.length,
    };
  },
};
