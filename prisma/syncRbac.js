'use strict';

// Re-syncs Role / Permission / RolePermission from server/rbac/catalogue.js
// against whatever's already in Postgres. Additive only (createMany +
// skipDuplicates against each table's unique key) — safe to run any time
// the catalogue changes, without touching the operational data seed.js also
// creates. Extracted from seed.js's own role/permission/grant block, which
// stays the source of truth for how a first-time seed does this.

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const { ROLES, PERMISSIONS, GRANTS } = require('../server/rbac/catalogue');

const prisma = new PrismaClient();

async function main() {
  console.log('Syncing roles & permissions...');
  await prisma.role.createMany({
    data: Object.entries(ROLES).map(([key, def]) => ({ id: crypto.randomUUID(), key, title: def.title, scope: def.scope })),
    skipDuplicates: true,
  });
  const roleRows = Object.fromEntries((await prisma.role.findMany()).map(r => [r.key, r]));

  await prisma.permission.createMany({
    data: PERMISSIONS.map(key => {
      const [module, action] = key === 'portal.view' ? ['portal', 'view'] : key.split('.');
      return { id: crypto.randomUUID(), key, module, action };
    }),
    skipDuplicates: true,
  });
  const permissionRows = Object.fromEntries((await prisma.permission.findMany()).map(p => [p.key, p]));

  const rolePermissionData = [];
  for (const [roleKey, perms] of Object.entries(GRANTS)) {
    for (const permKey of perms) {
      rolePermissionData.push({ id: crypto.randomUUID(), roleId: roleRows[roleKey].id, permissionId: permissionRows[permKey].id });
    }
  }
  const result = await prisma.rolePermission.createMany({ data: rolePermissionData, skipDuplicates: true });
  console.log(`Sync complete — ${result.count} new grant(s) inserted.`);
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
