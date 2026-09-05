'use strict';

const prisma = require('../db/prisma');

/** The term flagged isCurrent=true. Several intents (enrollment, fees,
 * revenue) are meaningless without "this term" — this is the one place that
 * decides what "now" means academically, so every intent agrees. */
async function getCurrentTerm() {
  return prisma.term.findFirst({
    where: { isCurrent: true, deletedAt: null },
    include: { academicSession: true },
  });
}

async function getCurrentAcademicSession() {
  const term = await getCurrentTerm();
  return term ? term.academicSession : null;
}

module.exports = { getCurrentTerm, getCurrentAcademicSession };
