'use strict';

const prisma = require('../db/prisma');
const { ROLES } = require('./catalogue');
const { getCurrentAcademicSession } = require('../lib/academicCalendar');

class PermissionError extends Error {
  constructor(permission) {
    super(`Missing permission: ${permission}`);
    this.name = 'PermissionError';
    this.code = 'permission_denied';
    this.permission = permission;
  }
}

/** session.permissions is a Set<string> attached by auth/session.js, built
 * from the DB (User -> Role -> RolePermission -> Permission) — never from
 * the static catalogue directly. The catalogue is what seeds that table; at
 * request time we trust only what's actually in Postgres for this user. */
function can(session, key) {
  return session.permissions.has(key);
}

function canAny(session, perms) {
  return (Array.isArray(perms) ? perms : [perms]).some(p => can(session, p));
}

function assertPermission(session, key) {
  if (!can(session, key)) throw new PermissionError(key);
}

/** Resolves the *parameters* of a role's scope from live data — never from
 * anything the client sends. GLOBAL sees everything; CLASS is narrowed to
 * the signed-in user's homeroom class; OWN_RECORDS to a guardian's linked
 * children; SELF to the signed-in student's own record. */
async function resolveScope(session) {
  const roleDef = ROLES[session.roleKey];
  if (!roleDef) throw new Error(`Unknown role: ${session.roleKey}`);
  const kind = roleDef.scope;

  if (kind === 'GLOBAL') return { kind: 'GLOBAL' };

  if (kind === 'CLASS') {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { homeroomClassId: true },
    });
    return { kind: 'CLASS', classId: user?.homeroomClassId ?? null };
  }

  if (kind === 'OWN_RECORDS') {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { guardianId: true },
    });
    if (!user?.guardianId) return { kind: 'OWN_RECORDS', studentIds: [] };
    const links = await prisma.studentGuardian.findMany({
      where: { guardianId: user.guardianId },
      select: { studentId: true },
    });
    return { kind: 'OWN_RECORDS', studentIds: links.map(l => l.studentId) };
  }

  if (kind === 'SELF') {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { studentId: true },
    });
    return { kind: 'SELF', studentId: user?.studentId ?? null };
  }

  throw new Error(`Unknown scope kind: ${kind}`);
}

/** Resolves any scope to a concrete list of student ids, or `null` meaning
 * "no filter needed" (GLOBAL). Intents that key off `studentId` (Invoice,
 * Payment, AttendanceRecord, ...) use this directly; intents that already
 * have a `classId` column (AttendanceRegister) should prefer filtering by
 * `scope.classId` themselves instead of expanding to a student list. */
async function scopeToStudentIds(scope) {
  if (scope.kind === 'GLOBAL') return null;
  if (scope.kind === 'SELF') return scope.studentId ? [scope.studentId] : [];
  if (scope.kind === 'OWN_RECORDS') return scope.studentIds;
  if (scope.kind === 'CLASS') {
    if (!scope.classId) return [];
    const session = await getCurrentAcademicSession();
    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        classId: scope.classId,
        deletedAt: null,
        ...(session ? { academicSessionId: session.id } : {}),
      },
      select: { studentId: true },
    });
    return enrollments.map(e => e.studentId);
  }
  throw new Error(`Unknown scope kind: ${scope.kind}`);
}

module.exports = {
  PermissionError,
  can,
  canAny,
  assertPermission,
  resolveScope,
  scopeToStudentIds,
};
