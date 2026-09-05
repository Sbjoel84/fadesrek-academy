'use strict';

const prisma = require('../db/prisma');

/** Several tables record *which staff member* performed an action
 * (AttendanceRegister.markedBy, MedicalVisit.recordedBy, BookLoan.issuedBy,
 * StudentDocument.verifiedBy, BehaviourIncident.reportedBy) as a Staff id —
 * distinct from the User id already on the session. Resolves the signed-in
 * user's linked Staff row, or null if this session isn't a staff login
 * (e.g. an admin role with no Staff record, PARENT, STUDENT). */
async function actingStaffId(session) {
  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { staffId: true } });
  return user?.staffId ?? null;
}

module.exports = { actingStaffId };
