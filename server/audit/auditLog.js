'use strict';

const prisma = require('../db/prisma');

/** Thin wrapper over the existing (append-only) AuditLog model. `detail` is
 * a short human-readable JSON summary, not a raw data dump — the full turn
 * (question, params, raw result) belongs on AiMessage, which is what
 * conversation history and the feedback loop actually read from. */
async function writeAuditEntry({ session, action, detail }) {
  await prisma.auditLog.create({
    data: {
      actorId: session.userId,
      actorName: session.displayName,
      roleKey: session.roleKey,
      action,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
    },
  });
}

module.exports = { writeAuditEntry };
