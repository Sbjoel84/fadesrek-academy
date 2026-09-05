'use strict';

// The closed set of things the AI can do. Every entry here becomes one
// Anthropic tool; Claude may only ever select a name from this registry and
// supply arguments matching its inputSchema — it never sees a database
// connection, a Prisma client, or anything resembling SQL. This list is the
// single place "what can the AI query" is decided.

const registry = {
  enrollment_count: require('./enrollmentCount'),
  todays_attendance: require('./todaysAttendance'),
  fees_owed: require('./feesOwed'),
  payments_today: require('./paymentsToday'),
  revenue_report: require('./revenueReport'),
  staff_absences: require('./staffAbsences'),
  low_inventory: require('./lowInventory'),
  pending_admissions: require('./pendingAdmissions'),
  daily_activity_report: require('./dailyActivityReport'),
};

module.exports = registry;
