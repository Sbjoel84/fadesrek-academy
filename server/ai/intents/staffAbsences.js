'use strict';

const prisma = require('../../db/prisma');
const { today, daysAgo, addDays } = require('../analytics');
const { staffAbsenceRecommendations } = require('../recommendations');

module.exports = {
  description: "Lists staff who are absent today (on approved leave covering today). Use for 'which teachers are absent' / 'who is on leave today'. NOTE: there is no dedicated staff-attendance log in this system — this is approximated from approved leave requests.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'hr.view',

  async run() {
    const date = today();

    // No `toDate` column on LeaveRequest — bounded fetch on fromDate, then
    // compute the actual coverage window (fromDate + days) in JS.
    const candidates = await prisma.leaveRequest.findMany({
      where: {
        leaveStatus: 'APPROVED',
        deletedAt: null,
        fromDate: { lte: date, gte: daysAgo(60, date) },
      },
      include: { staff: { select: { firstName: true, lastName: true, staffNo: true, position: true, department: true } } },
    });

    const onLeaveToday = candidates.filter(lr => addDays(lr.fromDate, lr.days) >= date);
    const totalStaff = await prisma.staff.count({ where: { deletedAt: null, status: 'ACTIVE' } });

    return {
      date: date.toISOString().slice(0, 10),
      assumption: 'Derived from approved leave requests covering today — this system has no separate staff clock-in/attendance log.',
      absentCount: onLeaveToday.length,
      totalStaff,
      staff: onLeaveToday.map(lr => ({
        name: `${lr.staff.firstName} ${lr.staff.lastName}`,
        staffNo: lr.staff.staffNo,
        position: lr.staff.position,
        department: lr.staff.department,
        leaveType: lr.leaveType,
        returnsOn: addDays(lr.fromDate, lr.days).toISOString().slice(0, 10),
      })),
      recommendations: staffAbsenceRecommendations(onLeaveToday.length, totalStaff),
    };
  },
};
