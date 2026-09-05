'use strict';

const prisma = require('../../db/prisma');
const { can } = require('../../rbac/permissionEngine');
const { today, sumKobo, koboToNaira } = require('../analytics');

/** A composed digest, not a single-table query. The tool itself only
 * requires 'reports.view' to be called at all, but each section additionally
 * checks the permission it actually needs and is omitted (labeled, not
 * silently dropped) if the signed-in role doesn't hold it — a Secretary with
 * reports.view but no finance.view gets a digest without revenue figures,
 * rather than either an error or numbers they shouldn't see. */
module.exports = {
  description: "Generates a short digest of today's activity across the school (payments, attendance, new admissions, low stock, staff on leave), scoped to what the caller's role can see. Use for 'generate a report for today's activities' or 'daily activity report'.",
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredPermission: 'reports.view',

  async run(session, scope) {
    const date = today();
    const sections = {};

    if (can(session, 'finance.view')) {
      const payments = await prisma.payment.findMany({ where: { paidOn: date, reversed: false, deletedAt: null } });
      sections.payments = { count: payments.length, totalNaira: koboToNaira(sumKobo(payments)) };
    } else {
      sections.payments = { omitted: 'insufficient permission (finance.view)' };
    }

    if (can(session, 'attendance.view')) {
      const records = await prisma.attendanceRecord.findMany({ where: { register: { date, deletedAt: null } } });
      const counts = { PRESENT: 0, ABSENT: 0, LATE: 0 };
      for (const r of records) counts[r.mark]++;
      sections.attendance = counts;
    } else {
      sections.attendance = { omitted: 'insufficient permission (attendance.view)' };
    }

    if (can(session, 'admissions.view')) {
      const newApplications = await prisma.application.count({ where: { submittedOn: date, deletedAt: null } });
      sections.admissions = { newApplicationsToday: newApplications };
    } else {
      sections.admissions = { omitted: 'insufficient permission (admissions.view)' };
    }

    if (can(session, 'inventory.view')) {
      const items = await prisma.inventoryItem.findMany({ where: { deletedAt: null, status: 'ACTIVE' } });
      sections.inventory = { lowItemCount: items.filter(i => i.quantity <= i.reorderLevel).length };
    } else {
      sections.inventory = { omitted: 'insufficient permission (inventory.view)' };
    }

    if (can(session, 'hr.view')) {
      const onLeave = await prisma.leaveRequest.count({
        where: { leaveStatus: 'APPROVED', deletedAt: null, fromDate: { lte: date } },
      });
      sections.hr = { approximateStaffOnLeave: onLeave };
    } else {
      sections.hr = { omitted: 'insufficient permission (hr.view)' };
    }

    return { date: date.toISOString().slice(0, 10), scope: scope.kind, sections };
  },
};
