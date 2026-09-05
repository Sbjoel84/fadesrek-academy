'use strict';

const prisma = require('../db/prisma');

/** Thin wrapper over the existing (role-addressed) Notification model —
 * reused as-is rather than inventing a parallel "AI alert" table. Pass
 * `roleKey: null` for a broadcast notice. */
async function notifyRole({ roleKey, title, body, createdById }) {
  let roleId = null;
  if (roleKey) {
    const role = await prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) return; // unknown role key — nothing to address this to
    roleId = role.id;
  }
  await prisma.notification.create({ data: { roleId, title, body, createdById } });
}

module.exports = { notifyRole };
