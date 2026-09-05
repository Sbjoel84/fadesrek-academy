'use strict';

// Rule-based suggestions, not a learned model — each function is a plain
// threshold/heuristic over data an intent already fetched. Kept separate
// from the intents themselves so "what counts as worth flagging" lives in
// one place instead of being inlined into every query.

function lowInventoryRecommendations(items) {
  if (!items.length) return [];
  const critical = items.filter(i => i.quantity === 0);
  const recs = [];
  if (critical.length) {
    recs.push(`${critical.length} item(s) are completely out of stock: ${critical.map(i => i.name).join(', ')} — reorder immediately.`);
  }
  const low = items.filter(i => i.quantity > 0);
  if (low.length) {
    recs.push(`${low.length} item(s) are at or below their reorder level and should be restocked soon.`);
  }
  return recs;
}

function feesOwedRecommendations(debtors, totalOutstandingNaira) {
  if (!debtors.length) return [];
  const recs = [`${debtors.length} student(s) have outstanding balances totalling ₦${totalOutstandingNaira.toLocaleString('en-NG')}.`];
  if (debtors.length > 5) {
    recs.push('Consider sending a bulk fee-reminder notice to guardians rather than following up individually.');
  }
  return recs;
}

function staffAbsenceRecommendations(absentCount, totalStaff) {
  if (!totalStaff) return [];
  const rate = absentCount / totalStaff;
  if (rate >= 0.15) {
    return [`${absentCount} of ${totalStaff} staff are on leave today (${Math.round(rate * 100)}%) — check timetable coverage for their classes.`];
  }
  return [];
}

module.exports = { lowInventoryRecommendations, feesOwedRecommendations, staffAbsenceRecommendations };
