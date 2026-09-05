'use strict';

const crypto = require('crypto');
const prisma = require('../db/prisma');

const COOKIE_NAME = process.env.COOKIE_NAME || 'sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const hashToken = raw => crypto.createHash('sha256').update(raw).digest('hex');

/** Mints a session row (reusing the schema's existing Session model — no new
 * session-store dependency needed) and returns the raw token to set as a
 * cookie. Only the SHA-256 hash of the token is ever persisted, so a leaked
 * database dump doesn't hand out live sessions. ipAddress/userAgent are a
 * snapshot of the request that logged in — the login-history/device-list
 * feature's whole reason for existing. */
async function createSession(userId, { ipAddress, userAgent } = {}) {
  const raw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt, ipAddress, userAgent: userAgent?.slice(0, 255) },
  });
  return { raw, expiresAt, sessionId: session.id };
}

async function revokeSession(raw) {
  if (!raw) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Resolves a raw cookie token to an authorization context: who they are,
 * what role, and the flattened set of `module.action` permission strings
 * that role actually holds *in the database* right now — never taken from
 * the static catalogue at request time, so a permission edit in Postgres
 * takes effect on the next request with no code deploy. */
async function resolveSession(raw) {
  if (!raw) return null;

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;

  const permissions = new Set(user.role.permissions.map(rp => rp.permission.key));

  return {
    sessionId: session.id,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    roleKey: user.role.key,
    permissions,
    // Which person record (if any) this login is attached to — resolveScope
    // already reads these itself from the DB for authorization, but the
    // frontend legitimately needs to know its own ids too (e.g. a class
    // teacher's portal needs to know *which* class without guessing).
    staffId: user.staffId,
    studentId: user.studentId,
    guardianId: user.guardianId,
    homeroomClassId: user.homeroomClassId,
  };
}

function requireSession(req, res, next) {
  const raw = req.cookies?.[COOKIE_NAME];
  resolveSession(raw)
    .then(session => {
      if (!session) return res.status(401).json({ error: 'not_authenticated' });
      req.session = session;
      next();
    })
    .catch(next);
}

module.exports = { COOKIE_NAME, createSession, revokeSession, resolveSession, requireSession };
