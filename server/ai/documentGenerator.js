'use strict';

// Turns a raw intent result into a report-shaped object the frontend can
// render/print with the same idioms as the rest of the app (the "reports"
// module already carries a print permission). This is deliberately a fixed
// shape, not a template engine — {title, generatedAt, summary, table?,
// recommendations?} covers every intent in the registry today.

const TITLES = {
  enrollment_count: 'Enrollment Report',
  todays_attendance: "Today's Attendance",
  fees_owed: 'Outstanding Fees',
  payments_today: "Today's Payments",
  revenue_report: 'Revenue Report',
  staff_absences: 'Staff Absences',
  low_inventory: 'Low Inventory',
  pending_admissions: 'Pending Admissions',
  daily_activity_report: "Today's Activity Digest",
};

function toTable(intent, data) {
  if (intent === 'fees_owed' && data.students) {
    return { columns: ['Name', 'Admission No', 'Outstanding'], rows: data.students.map(s => [s.name, s.admissionNo, `₦${s.outstandingNaira.toLocaleString('en-NG')}`]) };
  }
  if (intent === 'payments_today' && data.payments) {
    return { columns: ['Name', 'Admission No', 'Amount', 'Method'], rows: data.payments.map(p => [p.name, p.admissionNo, `₦${p.amountNaira.toLocaleString('en-NG')}`, p.method]) };
  }
  if (intent === 'low_inventory' && data.items) {
    return { columns: ['Item', 'Category', 'Qty', 'Reorder Level'], rows: data.items.map(i => [i.name, i.category, i.quantity, i.reorderLevel]) };
  }
  if (intent === 'staff_absences' && data.staff) {
    return { columns: ['Name', 'Staff No', 'Department', 'Returns'], rows: data.staff.map(s => [s.name, s.staffNo, s.department, s.returnsOn]) };
  }
  return null;
}

function generateDocument(intent, data) {
  return {
    title: TITLES[intent] || 'Report',
    generatedAt: new Date().toISOString(),
    summary: data,
    table: toTable(intent, data),
    recommendations: data.recommendations || null,
  };
}

module.exports = { generateDocument };
