'use strict';

const prisma = require('../../db/prisma');
const { getCurrentTerm } = require('../../lib/academicCalendar');
const { today, sumKobo, koboToNaira, groupCount } = require('../analytics');
const { projectNextPeriod } = require('../predictions');

async function getPeriodRange(period, term) {
  if (period === 'today') {
    const t = today();
    return { from: t, to: t, label: 'today' };
  }
  if (period === 'this_session') {
    const terms = await prisma.term.findMany({
      where: { academicSessionId: term.academicSessionId, deletedAt: null },
      orderBy: { sequence: 'asc' },
    });
    return {
      from: terms[0].startsOn,
      to: terms[terms.length - 1].endsOn,
      label: term.academicSession.name,
    };
  }
  return { from: term.startsOn, to: term.endsOn, label: term.name }; // this_term (default)
}

/** Sums non-reversed payments received in [from, to] inclusive. */
async function revenueBetween(from, to) {
  const payments = await prisma.payment.findMany({
    where: { paidOn: { gte: from, lte: to }, reversed: false, deletedAt: null },
  });
  return { total: sumKobo(payments), payments };
}

module.exports = {
  description: "Generates a revenue report (total collected, breakdown by payment method) for a period, with a simple trend projection. Use for 'generate a revenue report'.",
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: ['today', 'this_term', 'this_session'], description: 'Reporting period, defaults to this_term' },
    },
    additionalProperties: false,
  },
  requiredPermission: 'finance.view',

  async run(session, scope, params = {}) {
    const term = await getCurrentTerm();
    if (!term) return { error: 'no_current_term', message: 'No academic term is marked as current.' };

    const period = params.period || 'this_term';
    const range = await getPeriodRange(period, term);
    const { total, payments } = await revenueBetween(range.from, range.to);

    const byMethodCounts = groupCount(payments, p => p.method);
    const byMethodNaira = {};
    for (const p of payments) {
      byMethodNaira[p.method] = (byMethodNaira[p.method] || 0) + koboToNaira(p.amountKobo);
    }

    // Trend: sum revenue across the last few terms (up to and including the
    // current one) and project the next, purely as a labeled heuristic.
    let forecast = null;
    if (period === 'this_term') {
      const allTerms = await prisma.term.findMany({
        where: { deletedAt: null },
        orderBy: [{ academicSession: { name: 'asc' } }, { sequence: 'asc' }],
        include: { academicSession: true },
      });
      const idx = allTerms.findIndex(t => t.id === term.id);
      const window = idx >= 0 ? allTerms.slice(Math.max(0, idx - 3), idx + 1) : [];
      const series = [];
      for (const t of window) {
        const { total: termTotal } = await revenueBetween(t.startsOn, t.endsOn);
        series.push({ label: t.name, value: koboToNaira(termTotal) });
      }
      forecast = projectNextPeriod(series);
    }

    return {
      period: range.label,
      totalNaira: koboToNaira(total),
      paymentCount: payments.length,
      byMethod: { counts: byMethodCounts, naira: byMethodNaira },
      forecastNextPeriod: forecast, // null unless enough history; always labeled non-ML when present
    };
  },
};
